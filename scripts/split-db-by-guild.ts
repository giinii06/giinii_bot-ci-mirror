import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { databasePath } from "../src/config.js";
import { dbFor, guildDatabasePath } from "../src/storage.js";

/**
 * 서버별 DB 로 바꾸기 전 단일 DB 였던 데이터를 서버별 파일로 나눈다.
 * guild_id 가 있는 행만 대상이다. media_files 도 guild_id 로 나눈다.
 */
const source = process.argv[2]?.trim() || databasePath;

if (!existsSync(source)) {
  console.log(`no legacy database at ${source}, nothing to split`);
  process.exit(0);
}

const legacy = new Database(source, { readonly: true });
const tableExists = (table: string) =>
  legacy.query<{ n: number }, SQLQueryBindings[]>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.n === 1;

const tables = [
  "users", "activity", "chat_stats", "chat_stats_state", "user_profiles", "enrichment_state",
  "message_details", "media_files", "settings", "voice_sessions", "voice_presence_sessions",
  "admin_target_roles", "admin_defense_roles", "discord_messages", "command_logs"
].filter(tableExists);

if (!tables.includes("discord_messages")) {
  legacy.close();
  console.log(`${source} has no discord_messages table, nothing to split`);
  process.exit(0);
}

const guildIds = [...new Set(tables.flatMap((table) =>
  legacy.query<{ guild_id: string | null }, SQLQueryBindings[]>(`SELECT DISTINCT guild_id FROM ${table}`).all()
    .map((row) => row.guild_id)
    .filter((id): id is string => !!id)
))];

if (guildIds.length === 0) {
  legacy.close();
  console.log("legacy database holds no guild rows, nothing to split");
  process.exit(0);
}

let total = 0;
for (const guildId of guildIds) {
  // dbFor 가 열면서 서버별 스키마를 만든다. 여기서 직접 DDL 을 쓰면 storage.ts 와 어긋난다.
  const target = dbFor(guildId);
  const insertRows = (table: string) => {
    const rows = legacy.query<Record<string, unknown>, SQLQueryBindings[]>(
      `SELECT * FROM ${table} WHERE guild_id = ?`
    ).all(guildId);
    if (rows.length === 0) return 0;
    const columns = Object.keys(rows[0]!);
    const insert = target.query(
      `INSERT OR REPLACE INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`
    );
    for (const row of rows) insert.run(...columns.map((column) => row[column] as never));
    return rows.length;
  };

  target.exec("BEGIN");
  try {
    for (const table of tables) total += insertRows(table);
    target.exec("COMMIT");
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  }
  console.log(`split ${guildId} -> ${guildDatabasePath(guildId)}`);
}

// media_files 는 guild_id 가 비어 있을 수 있다. 서버를 알 수 없는 행은 남겨 둔다.
const orphans = tables.includes("media_files")
  ? legacy.query<{ n: number }, SQLQueryBindings[]>(
    "SELECT COUNT(*) AS n FROM media_files WHERE guild_id IS NULL OR guild_id = ''"
  ).get()?.n ?? 0
  : 0;
legacy.close();

console.log(`\n${guildIds.length} guild database(s) written, ${total} row(s) copied`);
if (orphans > 0) console.log(`${orphans} media_files row(s) had no guild_id and were left behind`);

// 원본은 지우지 않고 이름만 바꾼다. 되돌리려면 새 파일들을 지우고 이름을 되돌리면 된다.
const backupPath = join(dirname(source), "bot.sqlite.legacy");
if (!existsSync(backupPath)) await rename(source, backupPath);
console.log(`original database moved to ${backupPath} (delete it once you are satisfied)`);
