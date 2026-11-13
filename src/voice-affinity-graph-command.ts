import type { ChatInputCommandInteraction } from "discord.js";
import { all } from "./storage.js";
import { buildVoiceGraph, renderVoiceAffinityGraph, type VoiceGraphPair } from "./voice-affinity-graph.js";

export const loadVoiceGraphData = (guildId: string, now: number) => {
  const users = all<{ user_id: string; voice_total: number }>(
    guildId,
    "SELECT user_id, voice_total FROM users WHERE guild_id = ? AND voice_total > 0 ORDER BY voice_total DESC, user_id ASC LIMIT 20",
    guildId,
  );
  const pairs: VoiceGraphPair[] = [];
  if (users.length < 2) return { users, pairs };
  const ids = users.map(({ user_id }) => user_id);
  const placeholders = ids.map(() => "?").join(", ");
  const sharedPairs = all<VoiceGraphPair>(guildId, `
    SELECT a.user_id AS source, b.user_id AS target,
      SUM(MIN(COALESCE(a.ended_at, ?), COALESCE(b.ended_at, ?), ?)
        - MAX(a.started_at, b.started_at)) AS sharedMs
    FROM voice_presence_sessions a
    JOIN voice_presence_sessions b ON a.guild_id = b.guild_id
      AND a.channel_id = b.channel_id AND a.user_id < b.user_id
      AND b.started_at < MIN(COALESCE(a.ended_at, ?), ?)
      AND a.started_at < MIN(COALESCE(b.ended_at, ?), ?)
    WHERE a.guild_id = ? AND a.user_id IN (${placeholders}) AND b.user_id IN (${placeholders})
    GROUP BY a.user_id, b.user_id
    HAVING sharedMs > 0
  `, now, now, now, now, now, now, now, guildId, ...ids, ...ids);
  return { users, pairs: sharedPairs };
};

export const handleVoiceAffinityGraphCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
  }
  await interaction.deferReply();
  const { users, pairs } = loadVoiceGraphData(interaction.guildId, Date.now());
  if (!users.length) return interaction.editReply({ content: "통화량 기록이 없습니다." });

  const members = await Promise.all(users.map(async ({ user_id, voice_total }) => {
    const member = await interaction.guild.members.fetch(user_id).catch(() => null);
    const user = member?.user ?? await interaction.client.users.fetch(user_id).catch(() => null);
    return {
      userId: user_id,
      name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
      avatarUrl: member?.displayAvatarURL({ extension: "png", size: 256 })
        ?? user?.displayAvatarURL({ extension: "png", size: 256 }) ?? null,
      voiceMs: voice_total * 1000,
    };
  }));
  const attachment = await renderVoiceAffinityGraph(buildVoiceGraph(members, pairs));
  return interaction.editReply({ files: [{ name: "voice-affinity-graph.png", attachment,
    description: "친밀도 그래프 · 누적 통화량 상위 20명, 서로 함께한 시간 상위 7명끼리 연결" }] });
};
