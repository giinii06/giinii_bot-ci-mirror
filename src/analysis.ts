import type { Client, Guild, Message } from "discord.js";
import { ensureChatStatsMigrated, ensureGuildChatStats, markChatStatsCurrent, recordChatCounts } from "./activity.js";
import { config } from "./config.js";
import { recordMessageRecords, isGuildEnriched, markGuildEnriched } from "./records.js";
import { cleanMessage, captureDetail, captureMedia, captureProfile, collectDiscordHistoryInBatches, safeCapture, type HistoryMessage, type MediaRecord } from "./history.js";
import { fetchStoredChannelRanges, initDatabase, sql, upsertMessages } from "./storage.js";

const backfillStatuses = new Map<string, BackfillStatus>();
const INITIAL_BACKFILL_BATCH_SIZE = 100;

type BackfillStatus = { state: "running" | "ready" | "error"; messageCount: number; startedAt: number; completedAt?: number; error?: string };

export const persistLiveMessage = async (message: Message) => {
  if (!message.inGuild()) return;
  const content = cleanMessage(message);
  if (!content) return;
  const profile = safeCapture("live profile", () => captureProfile(message), null);
  const historyMessage: HistoryMessage = { messageId: message.id, guildId: message.guildId, channelId: message.channelId,
    channelName: "name" in message.channel && typeof message.channel.name === "string" ? message.channel.name : message.channelId,
    authorId: message.author.id, authorName: message.member?.displayName || message.author.displayName || message.author.username,
    authorIsBot: message.author.bot, content, createdTimestamp: message.createdTimestamp,
    profile,
    media: safeCapture("live media", () => captureMedia(message, profile), [] as MediaRecord[]),
    detail: safeCapture("live detail", () => captureDetail(message), null) };
  try {
    const inserted = upsertMessages(message.guildId, [historyMessage]);
    recordChatCounts(message.guildId, inserted);
    recordMessageRecords(message.guildId, inserted);
  } catch (error) { console.error("Failed to persist live message", error); }
};

export const startInitialBackfill = async (client: Client) => {
  // 멀티 서버 모드: DISCORD_GUILD_ID 로 필터하지 않고 봇이 들어간 모든 서버를 백필한다.
  // SKIP_BACKFILL=true 여도 저장 메시지가 0건인 길드는 신규 길드로 보고 1회는 강제 백필한다
  // (오프라인 상태에서 초대된 뒤 재시작한 경우 GuildCreate가 안 오기 때문).
  const guilds = await Promise.all([...client.guilds.cache.values()].map((guild) => guild.fetch()));
  initDatabase(guilds.map((guild) => guild.id));
  ensureChatStatsMigrated();
  // 길드마다 전체 기록을 훑는 작업이라 동시에 돌리면 Discord 레이트리밋만 앞당긴다.
  for (const guild of guilds) await backfillGuild(guild, { force: storedCount(guild.id) === 0 });
};

const storedCount = (guildId: string) =>
  sql<{ stored: number }>(guildId, "SELECT COUNT(*) AS stored FROM discord_messages WHERE guild_id = ?", guildId)?.stored ?? 0;

const backfillGuild = async (guild: Guild, opts?: { force?: boolean }) => {
  const startedAt = Date.now();
  const storedRanges = fetchStoredChannelRanges(guild.id);
  if (config.skipBackfill && !opts?.force) {
    console.log(`Skipping backfill for ${guild.name} (${guild.id}) because SKIP_BACKFILL is set`);
    markChatStatsCurrent(guild.id);
    backfillStatuses.set(guild.id, { state: "ready", messageCount: storedCount(guild.id), startedAt, completedAt: Date.now() });
    return;
  }
  try {
    ensureGuildChatStats(guild.id);
    console.log(`Backfilling ${guild.name} (${guild.id}): every readable message, ${storedRanges.size} channel(s) already saved`);
    let saved = 0;
    const history = await collectDiscordHistoryInBatches(guild, { batchSize: INITIAL_BACKFILL_BATCH_SIZE, storedRanges }, async (messages, totalCollected) => {
      const inserted = upsertMessages(guild.id, messages);
      recordChatCounts(guild.id, inserted);
      recordMessageRecords(guild.id, inserted);
      saved += inserted.length;
      backfillStatuses.set(guild.id, { state: "running", messageCount: totalCollected, startedAt });
      console.log(`Backfill progress for ${guild.name}: ${totalCollected} fetched, ${saved} newly saved`);
    });
    markChatStatsCurrent(guild.id);
    backfillStatuses.set(guild.id, { state: "ready", messageCount: history.messageCount, startedAt, completedAt: Date.now() });
    console.log(`Backfill ready for ${guild.name}: ${history.messageCount} fetched, ${saved} newly saved, ${history.scannedChannelCount} channel(s)`);
    await enrichGuildHistory(guild).catch((error) => console.error(`Enrichment failed for ${guild.name}`, error));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    backfillStatuses.set(guild.id, { state: "error", messageCount: 0, startedAt, completedAt: Date.now(), error: message });
    console.error(`Backfill failed for ${guild.name} (${guild.id})`, error);
  }
};

/**
 * 이미 저장된 구간은 백필이 건너뛰므로, 예전에 받은 메시지에는 부가 정보가 없다.
 * 저장 범위를 무시하고 전부 다시 훑어 상세/미디어/프로필 이력을 채운다. 완료하면 표시를 남긴다.
 */
const enrichGuildHistory = async (guild: Guild) => {
  if (isGuildEnriched(guild.id)) {
    console.log(`Enrichment for ${guild.name} (${guild.id}): already complete, skipping`);
    return;
  }
  const startedAt = Date.now();
  let details = 0;
  let media = 0;
  let profiles = 0;
  let batches = 0;
  const history = await collectDiscordHistoryInBatches(guild, { batchSize: INITIAL_BACKFILL_BATCH_SIZE }, async (messages, totalCollected) => {
    const recorded = recordMessageRecords(guild.id, messages);
    details += recorded.details;
    media += recorded.media;
    profiles += recorded.profiles;
    batches += 1;
    if (batches % 100 === 0) {
      console.log(`Enrichment progress for ${guild.name}: ${totalCollected} messages, ${details} details, ${media} media, ${profiles} profile rows`);
    }
  });
  markGuildEnriched(guild.id, history.messageCount);
  console.log(`Enrichment for ${guild.name} (${guild.id}): ${history.messageCount} messages revisited in ${Date.now() - startedAt}ms, ${details} details, ${media} media, ${profiles} profile rows`);
};

export const ensureBackfillStarted = async (guild: Guild) => {
  initDatabase([guild.id]);
  // GuildCreate 경로(새 서버 초대)는 SKIP_BACKFILL과 무관하게 1회 강제 백필한다.
  if (!backfillStatuses.has(guild.id)) await backfillGuild(guild, { force: true });
};

/** 일회성 백필 CLI(scripts/backfill-guild.ts)가 봇과 같은 경로를 쓰도록 노출한다. 실패는 예외로 올린다. */
export const backfillGuildOnce = async (guild: Guild) => {
  initDatabase([guild.id]);
  await backfillGuild(guild, { force: true });
  const status = backfillStatuses.get(guild.id);
  if (status?.state !== "ready") throw new Error(status?.error ?? "Backfill did not complete");
  return status;
};
