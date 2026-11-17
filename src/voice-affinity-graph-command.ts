import { type ChatInputCommandInteraction } from "discord.js";
import { isAllowedGuild } from "./command-rules.js";
import { config } from "./config.js";
import { all } from "./storage.js";
import { MAX_GRAPH_NODES, loadLifetimeVoiceTotals } from "./voice-graph-data.js";
import { buildVoiceGraph, renderVoiceAffinityGraph, type VoiceGraphPair } from "./voice-affinity-graph.js";
import { resolveVoiceGraphMembers } from "./voice-graph-members.js";

export const loadVoiceGraphData = (guildId: string, now: number) => {
  const users = loadLifetimeVoiceTotals(guildId, MAX_GRAPH_NODES);
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

  const profiles = new Map((await resolveVoiceGraphMembers(
    interaction.guild, interaction.client, users.map(({ user_id }) => user_id),
  )).map((member) => [member.userId, member]));
  const members = users.map(({ user_id, voice_total }) => ({
    userId: user_id,
    name: profiles.get(user_id)?.name ?? "알 수 없는 유저",
    avatarUrl: profiles.get(user_id)?.avatarUrl ?? null,
    voiceMs: voice_total * 1000,
  }));
  const attachment = await renderVoiceAffinityGraph(buildVoiceGraph(members, pairs));
  return interaction.editReply({ files: [{ name: "voice-affinity-graph.png", attachment,
    description: "친밀도 그래프 · 누적 통화량 상위 20명, 서로 함께한 시간 상위 7명끼리 연결" }] });
};

/**
 * 3D 그래프는 디스코드 Activity로 띄운다. 명령은 LAUNCH_ACTIVITY 콜백만 보내고,
 * iframe은 인스턴스 ID와 OAuth 코드를 서버에 넘겨 베어러 세션을 받는다.
 * 길드와 유저 신원은 모두 서버가 디스코드 API로 직접 확인한다.
 */
export const handleVoiceAffinityGraph3dCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    return interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
  }
  if (!isAllowedGuild(interaction.guildId)) {
    return interaction.reply({ content: "이 명령어는 지정된 서버에서만 사용할 수 있어요.", ephemeral: true });
  }
  if (!config.activity.enabled || !config.activity.clientId || !config.activity.clientSecret) {
    return interaction.reply({
      content: "3D 친밀도 그래프가 아직 설정되지 않았어요. ACTIVITY_ENABLED, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET을 확인해 주세요.",
      ephemeral: true,
    });
  }

  try {
    await interaction.launchActivity();
  } catch (error) {
    console.error("Activity launch failed", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "3D 그래프를 열지 못했어요. 잠시 후 다시 시도해 주세요.",
        ephemeral: true,
      }).catch(() => undefined);
    }
  }
};
