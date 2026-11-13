import { all, run, sql } from "./storage.js";

/**
 * 룰렛 4종(타겟, 관리자_타겟, 관리자머리끄댕이, 관리자머리끄댕이방어권_역할) 전용 길드.
 * 이 서버에서만 룰렛 명령어가 등록·실행된다. DB on/off 설정보다 우선한다.
 */
export const ALLOWED_GUILD_ID = "1489819911277641952";

/** 봇의 전용 길드인지. 룰렛과 기니봇아 대화가 이 서버에서만 동작한다. guildId가 없으면(DM 등) false. */
export const isAllowedGuild = (guildId: string | null | undefined) => guildId === ALLOWED_GUILD_ID;

/** 룰렛 명령어가 허용된 길드인지. */
export const isRouletteGuild = isAllowedGuild;

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
