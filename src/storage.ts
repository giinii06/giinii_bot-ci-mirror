import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import { databasePath } from "./config.js";
import type { HistoryMessage } from "./history.js";

mkdirSync(dirname(databasePath), { recursive: true });
export const db = new Database(databasePath, { create: true });

let initialized = false;

export const initDatabase = () => {
  if (initialized) return;
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      chat_total INTEGER NOT NULL DEFAULT 0, voice_total REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS activity (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, bucket_type TEXT NOT NULL, bucket_key TEXT NOT NULL,
      chat_count INTEGER NOT NULL DEFAULT 0, voice_seconds REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, bucket_type, bucket_key)
    );
    CREATE TABLE IF NOT EXISTS chat_stats (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, bucket_type TEXT NOT NULL, bucket_key TEXT NOT NULL,
      chat_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, bucket_type, bucket_key)
    );
    CREATE INDEX IF NOT EXISTS chat_stats_bucket_idx
      ON chat_stats (guild_id, bucket_type, bucket_key, chat_count DESC);
    CREATE TABLE IF NOT EXISTS chat_stats_state (
      guild_id TEXT PRIMARY KEY, built_messages INTEGER NOT NULL, built_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (guild_id TEXT PRIMARY KEY, target_role_id TEXT);
    CREATE TABLE IF NOT EXISTS voice_sessions (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      last_tick INTEGER NOT NULL, limited INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS voice_presence_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS voice_presence_lookup
      ON voice_presence_sessions (guild_id, user_id, channel_id, started_at, ended_at);
    CREATE TABLE IF NOT EXISTS admin_target_roles (
      guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS admin_defense_roles (
      guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS discord_messages (
      message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, author_is_bot INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discord_messages_guild_created_idx ON discord_messages(guild_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS discord_messages_guild_channel_created_idx ON discord_messages(guild_id, channel_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS command_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
      user_name TEXT NOT NULL, command_name TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL, model TEXT NOT NULL,
      output TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS command_logs_guild_created_idx ON command_logs(guild_id, created_at DESC);
  `);

  if (!all<{ name: string }>("PRAGMA table_info(settings)").some((column) => column.name === "target_role_id")) {
    db.exec("ALTER TABLE settings ADD COLUMN target_role_id TEXT");
  }
  if (!all<{ name: string }>("PRAGMA table_info(command_logs)").some((column) => column.name === "question")) {
    db.exec("ALTER TABLE command_logs ADD COLUMN question TEXT NOT NULL DEFAULT ''");
  }
  if (all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roulette_target_roles'").length) {
    for (const { guild_id, role_id } of all<{ guild_id: string; role_id: string }>("SELECT guild_id, MIN(role_id) AS role_id FROM roulette_target_roles GROUP BY guild_id")) {
      run(`INSERT INTO settings (guild_id, target_role_id) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET target_role_id = excluded.target_role_id
        WHERE settings.target_role_id IS NULL`, guild_id, role_id);
    }
  }
  initialized = true;
};

export const sql = <T>(query: string, ...params: SQLQueryBindings[]) =>
  db.query<T, SQLQueryBindings[]>(query).get(...params);

export const all = <T>(query: string, ...params: SQLQueryBindings[]) =>
  db.query<T, SQLQueryBindings[]>(query).all(...params);

export const run = (query: string, ...params: SQLQueryBindings[]) =>
  db.query(query).run(...params);

export const each = <T>(query: string, ...params: SQLQueryBindings[]) =>
  db.query<T, SQLQueryBindings[]>(query).iterate(...params);

/** 이미 저장된 메시지는 건너뛰고, 새로 들어간 메시지만 돌려준다. 반환값이 곧 적재기가 세어야 할 대상이다. */
export const upsertMessages = (messages: HistoryMessage[]): HistoryMessage[] => {
  if (messages.length === 0) return [];
  const insert = db.query(`
    INSERT INTO discord_messages (
      message_id, guild_id, channel_id, channel_name, author_id, author_name, author_is_bot, content, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO NOTHING
  `);
  const refresh = db.query(`
    UPDATE discord_messages SET
      guild_id = ?, channel_id = ?, channel_name = ?, author_id = ?, author_name = ?, author_is_bot = ?,
      content = ?, updated_at = ?
    WHERE message_id = ?
  `);
  db.exec("BEGIN");
  try {
    const inserted: HistoryMessage[] = [];
    const now = Date.now();
    for (const message of messages) {
      const result = insert.run(
        message.messageId, message.guildId, message.channelId, message.channelName, message.authorId,
        message.authorName, message.authorIsBot ? 1 : 0, message.content, message.createdTimestamp, now
      );
      if (result.changes > 0) {
        inserted.push(message);
        continue;
      }
      refresh.run(
        message.guildId, message.channelId, message.channelName, message.authorId, message.authorName,
        message.authorIsBot ? 1 : 0, message.content, now, message.messageId
      );
    }
    db.exec("COMMIT");
    return inserted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export type StoredChannelRange = { oldest: Snowflake; newest: Snowflake };
export type StoredChannelRanges = Map<Snowflake, StoredChannelRange>;

/**
 * 채널별로 이미 저장된 구간(가장 오래된 것, 가장 최근 것). 백필은 이 구간 전체를 건너뛴다.
 * SQLite는 MIN()/MAX() 질의에서 다른 컬럼 값을 그 최소/최대 행에서 가져온다.
 */
export const fetchStoredChannelRanges = (guildId: Snowflake): StoredChannelRanges => {
  const oldest = new Map(all<{ channel_id: Snowflake; message_id: Snowflake }>(
    `SELECT channel_id, message_id, MIN(created_at) FROM discord_messages WHERE guild_id = ? GROUP BY channel_id`,
    guildId
  ).map((row) => [row.channel_id, row.message_id] as const));
  const newest = new Map(all<{ channel_id: Snowflake; message_id: Snowflake }>(
    `SELECT channel_id, message_id, MAX(created_at) FROM discord_messages WHERE guild_id = ? GROUP BY channel_id`,
    guildId
  ).map((row) => [row.channel_id, row.message_id] as const));

  const ranges: StoredChannelRanges = new Map();
  for (const [channelId, oldestId] of oldest) {
    const newestId = newest.get(channelId);
    if (newestId) ranges.set(channelId, { oldest: oldestId, newest: newestId });
  }
  return ranges;
};

export const fetchRecentMessages = (guildId: Snowflake, limit: number, channelIds: Snowflake[], includeBotMessages: boolean) => {
  if (channelIds.length === 0) return [] as HistoryMessage[];
  const placeholders = channelIds.map(() => "?").join(",");
  const rows = all<{
    message_id: string; guild_id: string; channel_id: string; channel_name: string;
    author_id: string; author_name: string; author_is_bot: number; content: string; created_at: number;
  }>(
    `SELECT message_id, guild_id, channel_id, channel_name, author_id, author_name, author_is_bot, content, created_at
     FROM discord_messages
     WHERE guild_id = ? AND (${includeBotMessages ? "1" : "author_is_bot = 0"}) AND channel_id IN (${placeholders})
     ORDER BY created_at DESC LIMIT ?`,
    guildId, ...channelIds, limit
  );
  return rows.reverse().map((row): HistoryMessage => ({
    messageId: row.message_id, guildId: row.guild_id, channelId: row.channel_id, channelName: row.channel_name,
    authorId: row.author_id, authorName: row.author_name, authorIsBot: Boolean(row.author_is_bot),
    content: row.content, createdTimestamp: row.created_at
  }));
};

export const insertCommandLog = (log: {
  guildId: Snowflake; channelId: Snowflake; userId: Snowflake; userName: string;
  commandName: string; question: string; provider: string; model: string; output: string;
}) => {
  run(`INSERT INTO command_logs (guild_id, channel_id, user_id, user_name, command_name, question, provider, model, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, log.guildId, log.channelId, log.userId, log.userName,
    log.commandName, log.question, log.provider, log.model, log.output);
};
