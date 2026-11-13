import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import { databasePath } from "./config.js";
import type { HistoryMessage } from "./history.js";

/** 서버별 DB가 놓이는 디렉터리. 기존 data/bot.sqlite 옆에 guilds/ 를 만든다. */
export const guildsDirectory = () => join(dirname(databasePath), "guilds");

/** 서버마다 이 파일 하나를 소유한다. 파일명을 서버 ID로 고정해 임의 문자열이 경로를 바꾸지 못하게 한다. */
export const guildDatabasePath = (guildId: Snowflake | string) => {
  const safe = String(guildId).replace(/[^0-9A-Za-z]/g, "");
  if (!safe) throw new Error(`잘못된 서버 ID입니다: ${guildId}`);
  return join(guildsDirectory(), `${safe}.sqlite`);
};

const SCHEMA = `
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
  CREATE TABLE IF NOT EXISTS user_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, observed_at INTEGER NOT NULL, source TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '', global_name TEXT, nickname TEXT, display_name TEXT,
    avatar_hash TEXT, avatar_url TEXT, banner_hash TEXT, banner_url TEXT,
    accent_color INTEGER, bot INTEGER NOT NULL DEFAULT 0, public_flags INTEGER NOT NULL DEFAULT 0,
    identity TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_identity_idx ON user_profiles (guild_id, user_id, identity);
  CREATE INDEX IF NOT EXISTS user_profiles_history_idx ON user_profiles (guild_id, user_id, observed_at);
  CREATE TABLE IF NOT EXISTS enrichment_state (
    guild_id TEXT PRIMARY KEY, enriched_at INTEGER NOT NULL, message_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS message_details (
    message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, author_id TEXT NOT NULL,
    message_type INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
    edited_timestamp INTEGER, webhook_id TEXT, reply_to_message_id TEXT, thread_id TEXT,
    mentions_everyone INTEGER NOT NULL DEFAULT 0, mention_user_ids TEXT NOT NULL DEFAULT '[]',
    mention_role_ids TEXT NOT NULL DEFAULT '[]', mention_channel_ids TEXT NOT NULL DEFAULT '[]',
    reaction_summary TEXT NOT NULL DEFAULT '[]', embed_count INTEGER NOT NULL DEFAULT 0,
    component_count INTEGER NOT NULL DEFAULT 0, position INTEGER, flags INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL DEFAULT '{}', recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS message_details_guild_idx ON message_details (guild_id, channel_id);
  CREATE TABLE IF NOT EXISTS media_files (
    media_id TEXT PRIMARY KEY, kind TEXT NOT NULL,
    guild_id TEXT, channel_id TEXT, message_id TEXT, owner_user_id TEXT,
    filename TEXT NOT NULL DEFAULT '', content_type TEXT, bytes INTEGER, width INTEGER, height INTEGER,
    duration REAL, url TEXT NOT NULL, local_path TEXT, sha256 TEXT, status TEXT NOT NULL DEFAULT 'pending',
    stored_bytes INTEGER NOT NULL DEFAULT 0, downloaded_at INTEGER, recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_files_pending_idx ON media_files (status, recorded_at);
  CREATE INDEX IF NOT EXISTS media_files_message_idx ON media_files (message_id);
  CREATE INDEX IF NOT EXISTS media_files_owner_idx ON media_files (owner_user_id, kind);
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
  CREATE TABLE IF NOT EXISTS guild_command_rules (
    guild_id TEXT NOT NULL, command_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL, updated_by TEXT,
    PRIMARY KEY (guild_id, command_name)
  );
`;

const openDatabases = new Map<string, Database>();

/** 이 파일이 아는 모든 서버 DB를 닫는다. 기동 실패 후 프로세스가 남지 않게 할 때 쓴다. */
export const closeAllDatabases = () => {
  for (const database of openDatabases.values()) {
    try { database.close(); } catch { /* 이미 닫혔으면 무시 */ }
  }
  openDatabases.clear();
};

/** 서버 DB를 연다. 처음 여는 순간에만 스키마를 만들므로 어디서 불러도 준비돼 있다. */
export const dbFor = (guildId: Snowflake | string): Database => {
  const id = String(guildId);
  const existing = openDatabases.get(id);
  if (existing) return existing;
  const path = guildDatabasePath(id);
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true });
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  database.exec(SCHEMA);
  const columns = database.query<{ name: string }, []>("PRAGMA table_info(settings)").all();
  if (!columns.some((column) => column.name === "target_role_id")) {
    database.exec("ALTER TABLE settings ADD COLUMN target_role_id TEXT");
  }
  openDatabases.set(id, database);
  return database;
};

/** 디스크에 이미 만들어져 있는 서버 DB 목록. 워커처럼 전체 서버를 훑는 코드가 쓴다. */
export const listGuildIds = (): string[] => {
  const onDisk = readdirSync(guildsDirectory())
    .map((name) => name.replace(/\.sqlite(?:-wal|-shm)?$/, ""))
    .filter((name) => /^\d+$/.test(name));
  const opened = [...openDatabases.keys()].filter((id) => !onDisk.includes(id));
  return [...onDisk, ...opened];
};

export const initDatabase = (guildIds: Array<Snowflake | string> = []) => {
  for (const guildId of guildIds) dbFor(guildId);
};

export const sql = <T>(guildId: Snowflake | string, query: string, ...params: SQLQueryBindings[]) =>
  dbFor(guildId).query<T, SQLQueryBindings[]>(query).get(...params);

export const all = <T>(guildId: Snowflake | string, query: string, ...params: SQLQueryBindings[]) =>
  dbFor(guildId).query<T, SQLQueryBindings[]>(query).all(...params);

export const run = (guildId: Snowflake | string, query: string, ...params: SQLQueryBindings[]) =>
  dbFor(guildId).query(query).run(...params);

export const each = <T>(guildId: Snowflake | string, query: string, ...params: SQLQueryBindings[]) =>
  dbFor(guildId).query<T, SQLQueryBindings[]>(query).iterate(...params);

export const beginTransaction = (guildId: Snowflake | string) => dbFor(guildId).exec("BEGIN");

export const commitTransaction = (guildId: Snowflake | string) => dbFor(guildId).exec("COMMIT");

export const rollbackTransaction = (guildId: Snowflake | string) => dbFor(guildId).exec("ROLLBACK");

/** 이미 저장된 메시지는 건너뛰고, 새로 들어간 메시지만 돌려준다. 반환값이 곧 적재기가 세어야 할 대상이다. */
export const upsertMessages = (guildId: Snowflake | string, messages: HistoryMessage[]): HistoryMessage[] => {
  if (messages.length === 0) return [];
  const database = dbFor(guildId);
  const insert = database.query(`
    INSERT INTO discord_messages (
      message_id, guild_id, channel_id, channel_name, author_id, author_name, author_is_bot, content, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO NOTHING
  `);
  const refresh = database.query(`
    UPDATE discord_messages SET
      guild_id = ?, channel_id = ?, channel_name = ?, author_id = ?, author_name = ?, author_is_bot = ?,
      content = ?, updated_at = ?
    WHERE message_id = ?
  `);
  database.exec("BEGIN");
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
    database.exec("COMMIT");
    return inserted;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

/**
 * 기록 중인 DB를 그대로 복사하면 트랜잭션이 찢어질 수 있다.
 * VACUUM INTO 는 쓰기 잠금을 걸고 일관된 스냅샷을 만든다.
 */
export const snapshotDatabase = (database: Database, targetPath: string) => {
  rmSync(targetPath, { force: true });
  database.exec(`VACUUM INTO '${targetPath.split("'").join("''")}'`);
  return targetPath;
};

export type StoredChannelRange = { oldest: Snowflake; newest: Snowflake };
export type StoredChannelRanges = Map<Snowflake, StoredChannelRange>;

/**
 * 채널별로 이미 저장된 구간(가장 오래된 것, 가장 최근 것). 백필은 이 구간 전체를 건너뛴다.
 * SQLite는 MIN()/MAX() 질의에서 다른 컬럼 값을 그 최소/최대 행에서 가져온다.
 */
export const fetchStoredChannelRanges = (guildId: Snowflake): StoredChannelRanges => {
  const oldest = new Map(all<{ channel_id: Snowflake; message_id: Snowflake }>(
    guildId, `SELECT channel_id, message_id, MIN(created_at) FROM discord_messages WHERE guild_id = ? GROUP BY channel_id`, guildId
  ).map((row) => [row.channel_id, row.message_id] as const));
  const newest = new Map(all<{ channel_id: Snowflake; message_id: Snowflake }>(
    guildId, `SELECT channel_id, message_id, MAX(created_at) FROM discord_messages WHERE guild_id = ? GROUP BY channel_id`, guildId
  ).map((row) => [row.channel_id, row.message_id] as const));

  const ranges: StoredChannelRanges = new Map();
  for (const [channelId, oldestId] of oldest) {
    const newestId = newest.get(channelId);
    if (newestId) ranges.set(channelId, { oldest: oldestId, newest: newestId });
  }
  return ranges;
};
