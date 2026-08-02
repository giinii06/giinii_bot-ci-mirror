import type { Client, Message, VoiceState } from "discord.js";
import { all, run, sql } from "./storage.js";

const KST = 9 * 60 * 60 * 1000;
type Bucket = "day" | "week" | "month" | "all";
export type VoiceSession = { guild_id: string; user_id: string; channel_id: string; last_tick: number; limited?: number };

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
  run("INSERT OR IGNORE INTO users (guild_id, user_id) VALUES (?, ?)", guildId, userId);
};

export const recordActivity = (guildId: string, userId: string, chat: number, voiceSeconds: number, at: number) => {
  for (const kind of ["day", "week", "month", "all"] as const) {
    run(`INSERT INTO activity (guild_id, user_id, bucket_type, bucket_key, chat_count, voice_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, bucket_type, bucket_key) DO UPDATE SET
      chat_count = chat_count + excluded.chat_count, voice_seconds = voice_seconds + excluded.voice_seconds`,
      guildId, userId, kind, bucketAt(at, kind), chat, voiceSeconds);
  }
  ensureUser(guildId, userId);
  run("UPDATE users SET chat_total = chat_total + ?, voice_total = voice_total + ? WHERE guild_id = ? AND user_id = ?",
    chat, voiceSeconds, guildId, userId);
};

const recordVoice = (guildId: string, userId: string, from: number, to: number) => {
  while (from < to) {
    const date = new Date(from + KST);
    const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - KST;
    const end = Math.min(to, nextMidnight);
    recordActivity(guildId, userId, 0, (end - from) / 1000, from);
    from = end;
  }
};

const startVoicePresence = (guildId: string, userId: string, channelId: string, startedAt: number) => {
  run("INSERT INTO voice_presence_sessions (guild_id, user_id, channel_id, started_at) VALUES (?, ?, ?, ?)",
    guildId, userId, channelId, startedAt);
};

const endVoicePresence = (guildId: string, userId: string, endedAt: number) => {
  run("UPDATE voice_presence_sessions SET ended_at = ? WHERE guild_id = ? AND user_id = ? AND ended_at IS NULL",
    endedAt, guildId, userId);
};

export const settleSession = (session: VoiceSession, until: number) => {
  const elapsed = Math.max(0, until - session.last_tick);
  if (!elapsed) return session;
  recordVoice(session.guild_id, session.user_id, session.last_tick, until);
  run("UPDATE voice_sessions SET last_tick = ? WHERE guild_id = ? AND user_id = ?",
    until, session.guild_id, session.user_id);
  return { ...session, last_tick: until };
};

export const recordMessageActivity = (message: Message) => {
  if (!message.inGuild() || message.author.bot) return false;
  recordActivity(message.guildId, message.author.id, 1, 0, Date.now());
  return true;
};

export const initializeVoiceSessions = (client: Client) => {
  const now = Date.now();
  run("UPDATE voice_presence_sessions SET ended_at = ? WHERE ended_at IS NULL", now);
  run("DELETE FROM voice_sessions");
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channelId && !state.member?.user.bot) {
        run("INSERT OR IGNORE INTO voice_sessions (guild_id, user_id, channel_id, last_tick, limited) VALUES (?, ?, ?, ?, 0)",
          guild.id, state.id, state.channelId, now);
        startVoicePresence(guild.id, state.id, state.channelId, now);
      }
    }
  }
};

export const handleVoiceStateUpdate = async (newState: VoiceState) => {
  if (newState.member?.user.bot) return;
  const session = sql<VoiceSession>("SELECT * FROM voice_sessions WHERE guild_id = ? AND user_id = ?", newState.guild.id, newState.id);
  const now = Date.now();
  if (session) settleSession(session, now);
  if (!newState.channelId) {
    endVoicePresence(newState.guild.id, newState.id, now);
    run("DELETE FROM voice_sessions WHERE guild_id = ? AND user_id = ?", newState.guild.id, newState.id);
    return;
  }
  if (session?.channel_id === newState.channelId) return;
  endVoicePresence(newState.guild.id, newState.id, now);
  startVoicePresence(newState.guild.id, newState.id, newState.channelId, now);
  run(`INSERT INTO voice_sessions (guild_id, user_id, channel_id, last_tick, limited) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET channel_id = excluded.channel_id, last_tick = excluded.last_tick`,
    newState.guild.id, newState.id, newState.channelId, now);
};

export const startVoiceTracker = (client: Client) => setInterval(() => {
  const now = Date.now();
  for (const session of all<VoiceSession>("SELECT * FROM voice_sessions")) {
    if (client.guilds.cache.has(session.guild_id)) settleSession(session, now);
  }
}, 60_000);
