import type { Client, VoiceState } from "discord.js";
import { all, beginTransaction, commitTransaction, listGuildIds, rollbackTransaction, run, sql } from "./storage.js";
import type { HistoryMessage } from "./history.js";

const KST = 9 * 60 * 60 * 1000;
type Bucket = "day" | "week" | "month" | "all";
export type VoiceSession = { guild_id: string; user_id: string; channel_id: string; last_tick: number };

const BUCKETS = ["day", "week", "month", "all"] as const;
const pad = (value: number) => String(value).padStart(2, "0");

export const bucketAt = (time: number, kind: Bucket) => {
  if (kind === "all") return "all";
  const date = new Date(time + KST);
  if (kind === "day") return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (kind === "month") return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return `${thursday.getUTCFullYear()}-W${pad(Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7))}`;
};

const ensureUser = (guildId: string, userId: string) => {
  run(guildId, "INSERT OR IGNORE INTO users (guild_id, user_id) VALUES (?, ?)", guildId, userId);
};

export const recordVoiceActivity = (guildId: string, userId: string, voiceSeconds: number, at: number) => {
  for (const kind of BUCKETS) {
    run(guildId, `INSERT INTO activity (guild_id, user_id, bucket_type, bucket_key, chat_count, voice_seconds)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(guild_id, user_id, bucket_type, bucket_key) DO UPDATE SET
      voice_seconds = voice_seconds + excluded.voice_seconds`,
      guildId, userId, kind, bucketAt(at, kind), voiceSeconds);
  }
  ensureUser(guildId, userId);
  run(guildId, "UPDATE users SET voice_total = voice_total + ? WHERE guild_id = ? AND user_id = ?", voiceSeconds, guildId, userId);
};

type ChatSample = { authorId: string; createdAt: number };
type ChatStatGroup = { userId: string; kind: Bucket; key: string; count: number };

/** 한 메시지가 여러 버킷 키에 걸려도 각각 한 번만 세도록 (유저, 종류, 키)로 묶는다. */
const groupChatStats = (samples: ChatSample[]) => {
  const grouped = new Map<string, ChatStatGroup>();
  for (const { authorId, createdAt } of samples) {
    for (const kind of BUCKETS) {
      const key = bucketAt(createdAt, kind);
      const id = `${authorId}|${kind}|${key}`;
      const group = grouped.get(id);
      if (group) group.count += 1;
      else grouped.set(id, { userId: authorId, kind, key, count: 1 });
    }
  }
  return grouped;
};

const applyChatStats = (guildId: string, groups: Map<string, ChatStatGroup>) => {
  if (groups.size === 0) return 0;
  beginTransaction(guildId);
  try {
    for (const { userId, kind, key, count } of groups.values()) {
      run(guildId, `INSERT INTO chat_stats (guild_id, user_id, bucket_type, bucket_key, chat_count) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id, user_id, bucket_type, bucket_key) DO UPDATE SET chat_count = chat_count + excluded.chat_count`,
        guildId, userId, kind, key, count);
    }
    commitTransaction(guildId);
    return groups.size;
  } catch (error) {
    rollbackTransaction(guildId);
    throw error;
  }
};

/** 새로 적재된 메시지만 집계에 반영한다. 이미 들어 있던 메시지를 다시 세지 않는 유일한 경로다. */
export const recordChatCounts = (guildId: string, messages: HistoryMessage[]) => {
  const samples: ChatSample[] = [];
  for (const message of messages) {
    if (message.authorIsBot) continue;
    samples.push({ authorId: message.authorId, createdAt: message.createdTimestamp });
  }
  return applyChatStats(guildId, groupChatStats(samples));
};

const writeChatStatsState = (guildId: string, messages: number) =>
  run(guildId, `INSERT INTO chat_stats_state (guild_id, built_messages, built_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET built_messages = excluded.built_messages, built_at = excluded.built_at`,
    guildId, messages, Date.now());

/** discord_messages 전체에서 채팅량을 다시 계산해 chat_stats를 DB와 정확히 맞춘다. */
export const rebuildGuildChatStats = (guildId: string) => {
  const samples: ChatSample[] = all<{ author_id: string; created_at: number }>(
    guildId, "SELECT author_id, created_at FROM discord_messages WHERE guild_id = ? AND author_is_bot = 0", guildId
  ).map((row) => ({ authorId: row.author_id, createdAt: row.created_at }));
  const groups = groupChatStats(samples);

  beginTransaction(guildId);
  try {
    run(guildId, "DELETE FROM chat_stats WHERE guild_id = ?", guildId);
    for (const { userId, kind, key, count } of groups.values()) {
      run(guildId, "INSERT INTO chat_stats (guild_id, user_id, bucket_type, bucket_key, chat_count) VALUES (?, ?, ?, ?, ?)",
        guildId, userId, kind, key, count);
    }
    writeChatStatsState(guildId, samples.length);
    commitTransaction(guildId);
  } catch (error) {
    rollbackTransaction(guildId);
    throw error;
  }
  return { buckets: groups.size, messages: samples.length };
};

/** 백필이 끝났다는 사실을 기록한다. 이 표가 있어야 chat_stats를 다시 만들지 않는다. */
export const markChatStatsCurrent = (guildId: string) => {
  const { stored } = sql<{ stored: number }>(guildId, "SELECT COUNT(*) AS stored FROM discord_messages WHERE guild_id = ?", guildId)
    ?? { stored: 0 };
  writeChatStatsState(guildId, stored);
  return stored;
};

/** 아직 한 번도 통째로 계산한 적 없는 서버만 다시 만든다. 이미 만든 서버는 즉시 끝난다. */
export const ensureGuildChatStats = (guildId: string) => {
  if (sql(guildId, "SELECT 1 FROM chat_stats_state WHERE guild_id = ?", guildId)) return 0;
  if (!sql<{ present: number }>(guildId, "SELECT EXISTS(SELECT 1 FROM discord_messages WHERE guild_id = ?) AS present", guildId)?.present) return 0;
  const rebuilt = rebuildGuildChatStats(guildId);
  console.log(`Rebuilt precomputed chat counts for ${guildId}: ${rebuilt.messages} messages in ${rebuilt.buckets} buckets`);
  return rebuilt.buckets;
};

export const ensureChatStatsMigrated = () => {
  let rebuilt = 0;
  for (const guildId of listGuildIds()) {
    if (ensureGuildChatStats(guildId) > 0) rebuilt += 1;
  }
  return rebuilt;
};

const recordVoice = (guildId: string, userId: string, from: number, to: number) => {
  while (from < to) {
    const date = new Date(from + KST);
    const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - KST;
    const end = Math.min(to, nextMidnight);
    recordVoiceActivity(guildId, userId, (end - from) / 1000, from);
    from = end;
  }
};

const startVoicePresence = (guildId: string, userId: string, channelId: string, startedAt: number) => {
  run(guildId, "INSERT INTO voice_presence_sessions (guild_id, user_id, channel_id, started_at) VALUES (?, ?, ?, ?)",
    guildId, userId, channelId, startedAt);
};

const endVoicePresence = (guildId: string, userId: string, endedAt: number) => {
  run(guildId, "UPDATE voice_presence_sessions SET ended_at = ? WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL",
    endedAt, guildId, userId);
};

export const settleSession = (session: VoiceSession, until: number) => {
  const elapsed = Math.max(0, until - session.last_tick);
  if (!elapsed) return session;
  recordVoice(session.guild_id, session.user_id, session.last_tick, until);
  run(session.guild_id, "UPDATE voice_sessions SET last_tick = ? WHERE guild_id = ? AND user_id = ?",
    until, session.guild_id, session.user_id);
  return { ...session, last_tick: until };
};

export const initializeVoiceSessions = (client: Client) => {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const guildId = guild.id;
    run(guildId, "UPDATE voice_presence_sessions SET ended_at = ? WHERE ended_at IS NULL", now);
    run(guildId, "DELETE FROM voice_sessions");
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channelId && !state.member?.user.bot) {
        run(guildId, "INSERT OR IGNORE INTO voice_sessions (guild_id, user_id, channel_id, last_tick) VALUES (?, ?, ?, ?)",
          guildId, state.id, state.channelId, now);
        startVoicePresence(guildId, state.id, state.channelId, now);
      }
    }
  }
};

export const handleVoiceStateUpdate = async (newState: VoiceState) => {
  if (newState.member?.user.bot) return;
  const guildId = newState.guild.id;
  const session = sql<VoiceSession>(guildId, "SELECT * FROM voice_sessions WHERE guild_id = ? AND user_id = ?", guildId, newState.id);
  const now = Date.now();
  if (session) settleSession(session, now);
  if (!newState.channelId) {
    endVoicePresence(guildId, newState.id, now);
    run(guildId, "DELETE FROM voice_sessions WHERE guild_id = ? AND user_id = ?", guildId, newState.id);
    return;
  }
  if (session?.channel_id === newState.channelId) return;
  endVoicePresence(guildId, newState.id, now);
  startVoicePresence(guildId, newState.id, newState.channelId, now);
  run(guildId, `INSERT INTO voice_sessions (guild_id, user_id, channel_id, last_tick) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET channel_id = excluded.channel_id, last_tick = excluded.last_tick`,
    guildId, newState.id, newState.channelId, now);
};

export const startVoiceTracker = (client: Client) => setInterval(() => {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const session of all<VoiceSession>(guild.id, "SELECT * FROM voice_sessions")) settleSession(session, now);
  }
}, 60_000);
