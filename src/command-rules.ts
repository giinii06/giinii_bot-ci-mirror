import { all, run, sql } from "./storage.js";

/**
 * 서버별 슬래시 명령어 허용 여부.
 * 행이 없는 서버/명령어는 허용이다(기본값 허용) — 비활성화는 예외로만 저장한다.
 */
export const isCommandEnabled = (guildId: string, commandName: string) => {
  const row = sql<{ enabled: number }>(
    guildId, "SELECT enabled FROM guild_command_rules WHERE guild_id = ? AND command_name = ?", guildId, commandName
  );
  return row ? row.enabled !== 0 : true;
};

export const setCommandEnabled = (guildId: string, commandName: string, enabled: boolean, userId: string) => {
  run(guildId, `INSERT INTO guild_command_rules (guild_id, command_name, enabled, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, command_name) DO UPDATE SET
      enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    guildId, commandName, enabled ? 1 : 0, Date.now(), userId);
};

/** 해당 서버에서 비활성화된 명령어 이름 목록. 허용된 명령어는 저장돼 있지 않다. */
export const disabledCommandNames = (guildId: string): string[] =>
  all<{ command_name: string }>(
    guildId, "SELECT command_name FROM guild_command_rules WHERE guild_id = ? AND enabled = 0", guildId
  ).map((row) => row.command_name);
