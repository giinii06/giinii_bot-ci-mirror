import { loadImage } from "@napi-rs/canvas";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction, type ChatInputCommandInteraction, type Guild } from "discord.js";
import { all } from "./storage.js";
import { renderVoiceAffinity, type VoiceAffinityEntry, type VoiceCardMode } from "./voice-affinity-card.js";
import { buildVoiceAffinity, type VoiceInterval } from "./voice-affinity.js";

type CardPage = { name: string; attachment: Buffer };

const voiceAffinityPages = new Map<string, CardPage[]>();
const MAX_STORED_CARD_PAGES = 20;
const PAGE_SIZE = 7;
const RANK_LIMIT = 21;

type StatisticsRow = { user_id: string; chat_count: number; voice_seconds: number };
type ChatCountRow = { user_id: string; chat_count: number };
type VoiceSecondsRow = { user_id: string; voice_seconds: number };

const voiceAffinityComponents = (page: number, pageCount: number) => [new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`voice-affinity:${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
  new ButtonBuilder().setCustomId(`voice-affinity:${page}`).setLabel(`${page + 1} / ${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(),
  new ButtonBuilder().setCustomId(`voice-affinity:${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page === pageCount - 1),
)];

const rememberCards = (messageId: string, cards: CardPage[]) => {
  voiceAffinityPages.set(messageId, cards);
  while (voiceAffinityPages.size > MAX_STORED_CARD_PAGES) {
    const oldest = voiceAffinityPages.keys().next().value;
    if (oldest === undefined) break;
    voiceAffinityPages.delete(oldest);
  }
  setTimeout(() => voiceAffinityPages.delete(messageId), 15 * 60_000).unref();
};

const sendCardPages = async (interaction: ChatInputCommandInteraction, cards: CardPage[]) => {
  if (cards.length === 1) return interaction.editReply({ files: cards });
  const message = await interaction.editReply({
    files: [cards[0]!],
    components: voiceAffinityComponents(0, cards.length),
  });
  rememberCards(message.id, cards);
  return message;
};

const rankingCards = (
  title: string,
  entries: VoiceAffinityEntry[],
  mode: VoiceCardMode,
  name: string,
) => Array.from({ length: Math.ceil(entries.length / PAGE_SIZE) }, (_, page) => ({
  name,
  attachment: renderVoiceAffinity(
    title, entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    page * PAGE_SIZE + 1, entries.length, mode, entries[0]?.sharedMs,
  ),
}));

const rankingProfile = async (guild: Guild, userId: string): Promise<Omit<VoiceAffinityEntry, "sharedMs">> => {
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user ?? await guild.client.users.fetch(userId).catch(() => null);
  const avatarUrl = (member ?? user)?.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
  const avatar = avatarUrl ? await fetch(avatarUrl, { signal: AbortSignal.timeout(3_000) })
    .then(async (response) => response.ok ? loadImage(Buffer.from(await response.arrayBuffer())) : undefined)
    .catch(() => undefined) : undefined;
  return {
    name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
    username: user?.username ?? "unknown",
    avatar,
  };
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
    guild.id, "SELECT user_id, channel_id, started_at, ended_at FROM voice_presence_sessions WHERE guild_id = ? AND user_id = ?",
    guild.id, target.id,
  );
  const otherSessions = all<VoiceInterval>(
    guild.id, "SELECT user_id, channel_id, started_at, ended_at FROM voice_presence_sessions WHERE guild_id = ? AND user_id != ?",
    guild.id, target.id,
  );
  const affinities = buildVoiceAffinity(targetSessions, otherSessions, now).slice(0, PAGE_SIZE);
  await interaction.deferReply();
  const [entries, targetMember] = await Promise.all([
    Promise.all(affinities.map(async ({ user_id, shared_ms }) => ({
      ...await rankingProfile(guild, user_id), sharedMs: shared_ms,
    }))),
    guild.members.fetch(target.id).catch(() => null),
  ]);
  const targetName = targetMember?.displayName ?? target.globalName ?? target.username;
  return interaction.editReply({
    files: [{ name: "voice-affinity.png", attachment: renderVoiceAffinity(targetName, entries) }],
  });
};

export const handleVoiceVolumeCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const rankedUsers = all<{ user_id: string; voice_total: number }>(
    guild.id, "SELECT user_id, voice_total FROM users WHERE guild_id = ? AND voice_total > 0 ORDER BY voice_total DESC, user_id ASC LIMIT ?",
    guild.id, RANK_LIMIT,
  );
  if (!rankedUsers.length) return interaction.reply({ content: "통화량 기록이 없습니다." });

  await interaction.deferReply();
  const entries = await Promise.all(rankedUsers.map(async ({ user_id, voice_total }) => ({
    ...await rankingProfile(guild, user_id), sharedMs: voice_total * 1000,
  })));
  return sendCardPages(interaction, rankingCards("전체", entries, "volume", "voice-volume.png"));
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

export const loadStatisticsRows = (guildId: string): StatisticsRow[] => {
  const chats = all<ChatCountRow>(
    guildId, "SELECT user_id, chat_count FROM chat_stats WHERE guild_id = ? AND bucket_type = 'all' AND bucket_key = 'all' AND chat_count > 0",
    guildId,
  );
  const voices = all<VoiceSecondsRow>(guildId,
    "SELECT user_id, voice_total AS voice_seconds FROM users WHERE guild_id = ? AND voice_total > 0", guildId);
  return mergeStatisticsRows(chats, voices);
};

export const handleStatisticsCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const rows = loadStatisticsRows(guild.id);
  if (!rows.length) return interaction.reply({ content: "전체 통계 기록이 없습니다." });

  await interaction.deferReply();
  const metrics: { mode: VoiceCardMode; name: string; score: (row: StatisticsRow) => number }[] = [
    { mode: "volume", name: "statistics-voice.png", score: (row) => row.voice_seconds * 1000 },
    { mode: "chat", name: "statistics-chat.png", score: (row) => row.chat_count },
    { mode: "activity", name: "statistics-total.png", score: (row) => row.chat_count + row.voice_seconds / 60 },
  ];
  const rankings = metrics.map(({ mode, name, score }) => {
    const scored = rows.map((row) => ({ userId: row.user_id, sharedMs: score(row) }));
    const entries = scored.sort((a, b) => b.sharedMs - a.sharedMs || a.userId.localeCompare(b.userId)).slice(0, PAGE_SIZE);
    return { mode, name, entries };
  });
  const userIds = new Set(rankings.flatMap(({ entries }) => entries.map(({ userId }) => userId)));
  const profiles = new Map([...userIds].map((id) => [id, rankingProfile(guild, id)]));
  const cards = await Promise.all(rankings.map(async ({ mode, name, entries }) => {
    const ranked = await Promise.all(entries.map(async ({ userId, sharedMs }) => ({
      ...await profiles.get(userId)!, sharedMs,
    })));
    return { name, attachment: renderVoiceAffinity("전체", ranked, 1, ranked.length, mode) };
  }));
  return sendCardPages(interaction, cards);
};

export const handleVoiceAffinityComponent = async (interaction: ButtonInteraction) => {
  const page = Number(interaction.customId.slice("voice-affinity:".length));
  const cards = Number.isInteger(page) ? voiceAffinityPages.get(interaction.message.id) : undefined;
  const card = cards?.[page];
  if (!card) {
    return interaction.reply({ content: "카드 결과가 만료되었습니다. `/통화량` 또는 `/통계`를 다시 실행하세요.", ephemeral: true });
  }
  return interaction.update({
    attachments: [],
    files: [card],
    components: voiceAffinityComponents(page, cards.length),
  });
};
