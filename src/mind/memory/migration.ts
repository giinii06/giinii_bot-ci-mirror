import { readFile } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import { parseLegacyEntries } from "../../chat/memory.js";
import type { MindMemoryStore } from "./store.js";

const MIGRATION_KEY = "legacy_memory_migrated";

export const getMeta = (
  db: Database,
  guildId: Snowflake | string,
  key: string
): string | null => {
  const row = db
    .query<{ value: string }, [string, string]>(
      "SELECT value FROM mind_meta WHERE guild_id = ? AND key = ?"
    )
    .get(String(guildId), key);
  return row?.value ?? null;
};

export const setMeta = (
  db: Database,
  guildId: Snowflake | string,
  key: string,
  value: string
): void => {
  db.query(
    `INSERT INTO mind_meta (guild_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(String(guildId), key, value, Date.now());
};

/**
 * 기존 memory.md는 서버 전체가 공유하던 파일이다. 그 동작을 유지하려면
 * scope='guild'로 옮겨야 한다. 한 번만 실행하고, 실패하면 다음 기동에서 다시 시도한다.
 */
export const migrateLegacyMemory = async (
  store: MindMemoryStore,
  db: Database,
  guildId: Snowflake | string,
  path: string
): Promise<number> => {
  if (getMeta(db, guildId, MIGRATION_KEY) === "done") return 0;

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    setMeta(db, guildId, MIGRATION_KEY, "done");
    return 0;
  }

  let migrated = 0;
  for (const entry of parseLegacyEntries(raw)) {
    const saved = store.add({
      ownerUserId: null,
      scope: "guild",
      kind: "semantic",
      content: entry,
      confidence: 0.6,
      importance: 0.5,
      sourceMessageId: null,
      sourceAuthorId: null
    });
    if (saved) migrated += 1;
  }

  setMeta(db, guildId, MIGRATION_KEY, "done");
  return migrated;
};
