import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { bucketAt } from "./activity.js";
import { all } from "./storage.js";
import { renderVoiceAffinity, type VoiceAffinityEntry } from "./voice-affinity-card.js";
import { buildVoiceAffinity, type VoiceInterval } from "./voice-affinity.js";

type CardPage = { name: string; attachment: Buffer };

const voiceAffinityPages = new Map<string, CardPage[]>();

const statisticsPeriodLabels = { day: "오늘", week: "이번 주", month: "이번 달", all: "전체" } as const;
export type StatisticsPeriod = keyof typeof statisticsPeriodLabels;
type StatisticsRow = { user_id: string; chat_count: number; voice_seconds: number };
type ChatCountRow = { user_id: string; chat_count: number };
type VoiceSecondsRow = { user_id: string; voice_seconds: number };

const voiceAffinityComponents = (page: number, pageCount: number) => [new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`voice-affinity:${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
  new ButtonBuilder().setCustomId(`voice-affinity:${page}`).setLabel(`${page + 1} / ${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(),
  new ButtonBuilder().setCustomId(`voice-affinity:${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page === pageCount - 1),
)];

const sendCardPages = async (interaction: ChatInputCommandInteraction, cards: CardPage[]) => {
  const message = await interaction.editReply({
    files: [cards[0]!],
    components: voiceAffinityComponents(0, cards.length),
  });
  voiceAffinityPages.set(message.id, cards);
  setTimeout(() => voiceAffinityPages.delete(message.id), 15 * 60_000);
  return message;
};

const sendVoiceRanking = async (
  interaction: ChatInputCommandInteraction,
  title: string,
  entries: VoiceAffinityEntry[],
  now: number,
  mode: "affinity" | "volume" = "affinity",
  totalDurationMs?: number,
) => {
  const pageCount = Math.ceil(entries.length / 7);
  const pages = await Promise.all(Array.from({ length: pageCount }, (_, page) => renderVoiceAffinity(
    title,
    entries.slice(page * 7, page * 7 + 7),
    now,
    page * 7 + 1,
    entries.length,
    mode,
    totalDurationMs,
  )));
  return sendCardPages(interaction, pages.map((attachment) => ({ name: "voice-affinity.png", attachment })));
};

export const handleVoiceAffinityCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const target = interaction.options.getUser("유저", true);
  const now = Date.now();
  const targetSessions = all<VoiceInterval>(
    "SELECT user_id, channel_id, started_at, ended_at FROM voice_presence_sessions WHERE guild_id = ? AND user_id = ?",
    guild.id, target.id,
  );
  const otherSessions = all<VoiceInterval>(
    "SELECT user_id, channel_id, started_at, ended_at FROM voice_presence_sessions WHERE guild_id = ? AND user_id != ?",
    guild.id, target.id,
  );
  const affinities = buildVoiceAffinity(targetSessions, otherSessions, now).slice(0, 21);
  if (!affinities.length) {
    return interaction.reply({ content: `${target}님과 같은 음성 채널에 함께 있었던 기록이 없습니다.` });
  }

  await interaction.deferReply();
  const entries = await Promise.all(affinities.map(async (affinity) => {
    const member = await guild.members.fetch(affinity.user_id).catch(() => null);
    const user = member?.user ?? await interaction.client.users.fetch(affinity.user_id).catch(() => null);
    return {
      name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
      username: user?.username ?? "unknown",
      sharedMs: affinity.shared_ms,
    };
  }));
  const targetMember = await guild.members.fetch(target.id).catch(() => null);
  const targetName = targetMember?.displayName ?? target.globalName ?? target.username;
  return sendVoiceRanking(interaction, targetName, entries, now);
};

export const handleVoiceVolumeCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const now = Date.now();
  const users = all<{ user_id: string; voice_total: number }>(
    "SELECT user_id, voice_total FROM users WHERE guild_id = ? AND voice_total > 0 ORDER BY voice_total DESC, user_id ASC",
    guild.id,
  );
  const rankedUsers = users.slice(0, 21);
  if (!rankedUsers.length) return interaction.reply({ content: "통화량 기록이 없습니다." });
  const totalVoiceMs = users.reduce((sum, user) => sum + user.voice_total, 0) * 1000;

  await interaction.deferReply();
  const entries = await Promise.all(rankedUsers.map(async ({ user_id, voice_total }) => {
    const member = await guild.members.fetch(user_id).catch(() => null);
    const user = member?.user ?? await interaction.client.users.fetch(user_id).catch(() => null);
    return {
      name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
      username: user?.username ?? "unknown",
      sharedMs: voice_total * 1000,
    };
  }));
  return sendVoiceRanking(interaction, "전체", entries, now, "volume", totalVoiceMs);
};

/** 채팅량은 전체 DB에서 미리 계산한 chat_stats에서, 통화량은 음성 기록에서 읽어 유저별로 합친다. */
export const mergeStatisticsRows = (chats: ChatCountRow[], voices: VoiceSecondsRow[]): StatisticsRow[] => {
  const rows = new Map<string, StatisticsRow>();
  for (const { user_id, chat_count } of chats) rows.set(user_id, { user_id, chat_count, voice_seconds: 0 });
  for (const { user_id, voice_seconds } of voices) {
    const row = rows.get(user_id);
    if (row) row.voice_seconds = voice_seconds;
    else rows.set(user_id, { user_id, chat_count: 0, voice_seconds });
  }
  return [...rows.values()];
};

export const loadStatisticsRows = (guildId: string, period: StatisticsPeriod, now: number): StatisticsRow[] => {
  const bucket = bucketAt(now, period);
  const chats = all<ChatCountRow>(
    "SELECT user_id, chat_count FROM chat_stats WHERE guild_id = ? AND bucket_type = ? AND bucket_key = ? AND chat_count > 0",
    guildId, period, bucket,
  );
  const voices = period === "all"
    ? all<VoiceSecondsRow>("SELECT user_id, voice_total AS voice_seconds FROM users WHERE guild_id = ? AND voice_total > 0", guildId)
    : all<VoiceSecondsRow>(
      "SELECT user_id, voice_seconds FROM activity WHERE guild_id = ? AND bucket_type = ? AND bucket_key = ? AND voice_seconds > 0",
      guildId, period, bucket,
    );
  return mergeStatisticsRows(chats, voices);
};

export const handleStatisticsCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const requestedPeriod = interaction.options.getString("기간") ?? "all";
  const period: StatisticsPeriod = requestedPeriod in statisticsPeriodLabels
    ? requestedPeriod as StatisticsPeriod
    : "all";
  const now = Date.now();
  const rows = loadStatisticsRows(guild.id, period, now);
  if (!rows.length) return interaction.reply({ content: `${statisticsPeriodLabels[period]} 통계 기록이 없습니다.` });

  await interaction.deferReply();
  const users = new Map<string, { name: string; username: string }>();
  await Promise.all(rows.map(async ({ user_id }) => {
    const member = await guild.members.fetch(user_id).catch(() => null);
    const user = member?.user ?? await interaction.client.users.fetch(user_id).catch(() => null);
    users.set(user_id, {
      name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
      username: user?.username ?? "unknown",
    });
  }));

  const ranked = (score: (row: StatisticsRow) => number) => [...rows]
    .sort((a, b) => score(b) - score(a) || a.user_id.localeCompare(b.user_id))
    .slice(0, 7);
  const totalChat = rows.reduce((sum, row) => sum + row.chat_count, 0);
  const totalVoiceMs = rows.reduce((sum, row) => sum + row.voice_seconds, 0) * 1000;
  const totalActivity = rows.reduce((sum, row) => sum + row.chat_count + row.voice_seconds / 60, 0);
  const cards = [
    { mode: "chat" as const, rows: ranked((row) => row.chat_count), total: totalChat, name: "statistics-chat.png" },
    { mode: "volume" as const, rows: ranked((row) => row.voice_seconds), total: totalVoiceMs, name: "statistics-voice.png" },
    { mode: "activity" as const, rows: ranked((row) => row.chat_count + row.voice_seconds / 60), total: totalActivity, name: "statistics-total.png" },
  ].map(({ mode, rows: ranking, total, name }) => ({
    attachment: renderVoiceAffinity(
      statisticsPeriodLabels[period],
      ranking.map((row) => ({ ...(users.get(row.user_id) ?? { name: "알 수 없는 유저", username: "unknown" }),
        sharedMs: mode === "chat" ? row.chat_count : mode === "volume" ? row.voice_seconds * 1000 : row.chat_count + row.voice_seconds / 60 })),
      now,
      1,
      ranking.length,
      mode,
      total,
    ),
    name,
  }));
  return sendCardPages(interaction, cards);
};

export const handleVoiceAffinityComponent = async (interaction: ButtonInteraction) => {
  const page = Number(interaction.customId.slice("voice-affinity:".length));
  const cards = Number.isInteger(page) ? voiceAffinityPages.get(interaction.message.id) : undefined;
  const card = cards?.[page];
  if (!card) {
    return interaction.reply({ content: "카드 결과가 만료되었습니다. `/친밀도`, `/통화량`, `/통계`를 다시 실행하세요.", ephemeral: true });
  }
  return interaction.update({
    attachments: [],
    files: [card],
    components: voiceAffinityComponents(page, cards.length),
  });
};
