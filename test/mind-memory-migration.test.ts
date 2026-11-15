import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { MIND_INDEXES, MIND_TABLES, migrateMindSchema } from "../src/mind/schema.js";
import { GUILD, USER } from "./mind-fixtures.js";

/** v3 시점의 실제 스키마. 이전에 배포된 DB를 그대로 재현한다. */
const LEGACY_SCHEMA = `
  CREATE TABLE mind_state (
    guild_id TEXT PRIMARY KEY,
    valence REAL NOT NULL DEFAULT 0.55,
    arousal REAL NOT NULL DEFAULT 0.4,
    irritation REAL NOT NULL DEFAULT 0.09,
    curiosity REAL NOT NULL DEFAULT 0.67,
    current_goal TEXT,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE mind_relationships (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    familiarity REAL NOT NULL DEFAULT 0,
    trust REAL NOT NULL DEFAULT 0.5,
    playfulness REAL NOT NULL DEFAULT 0.3,
    boundaries TEXT NOT NULL DEFAULT '[]',
    interaction_count INTEGER NOT NULL DEFAULT 0,
    last_interaction_at INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE mind_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    owner_user_id TEXT,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    normalized_content TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 1.0,
    importance REAL NOT NULL DEFAULT 0.5,
    source_message_id TEXT,
    source_author_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_accessed_at INTEGER,
    expires_at INTEGER,
    deleted_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE VIRTUAL TABLE mind_memory_fts USING fts5(content, tokenize = 'unicode61');
`;

const legacyDb = (): Database => {
  const db = new Database(":memory:");
  db.exec(LEGACY_SCHEMA);
  return db;
};

const columns = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);

const insertLegacyMemory = (
  db: Database,
  input: { owner: string | null; scope: string; content: string; author?: string | null }
): void => {
  db.query(
    `INSERT INTO mind_memories
       (guild_id, owner_user_id, scope, kind, content, normalized_content,
        source_author_id, created_at, updated_at, version)
     VALUES (?, ?, ?, 'semantic', ?, ?, ?, 1, 1, 1)`
  ).run(GUILD, input.owner, input.scope, input.content, input.content, input.author ?? null);
};

describe("Mind 스키마 마이그레이션", () => {
  test("기존 개인 기억은 비공개로, 공용 기억은 공유 가능으로 남는다", () => {
    const db = legacyDb();
    insertLegacyMemory(db, { owner: USER, scope: "user", content: "민지는 커피를 좋아한다" });
    insertLegacyMemory(db, { owner: null, scope: "guild", content: "이 서버는 아침에 조용하다" });

    migrateMindSchema(db);

    const rows = db
      .query<{ scope: string; visibility: string; approval_status: string }, []>(
        "SELECT scope, visibility, approval_status FROM mind_memories ORDER BY id"
      )
      .all();
    expect(rows).toEqual([
      { scope: "user", visibility: "private", approval_status: "active" },
      { scope: "guild", visibility: "shareable", approval_status: "active" }
    ]);
  });

  test("기존 행을 지우지 않고 빠진 컬럼만 더한다", () => {
    const db = legacyDb();
    insertLegacyMemory(db, { owner: USER, scope: "user", content: "기억 하나" });
    insertLegacyMemory(db, { owner: USER, scope: "user", content: "기억 둘" });

    migrateMindSchema(db);

    expect(db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mind_memories").get()?.n).toBe(2);
    expect(columns(db, "mind_memories")).toEqual(
      expect.arrayContaining([
        "subject_user_id",
        "created_by_user_id",
        "category",
        "visibility",
        "approval_status",
        "structured_value",
        "source_channel_id",
        "reviewed_by_user_id",
        "reviewed_at"
      ])
    );
    // 감정 상태 테이블은 지우지 않고 그대로 둔다.
    expect(columns(db, "mind_state")).toContain("valence");
  });

  test("작성자를 모르는 기존 기억은 source_author_id로 채운다", () => {
    const db = legacyDb();
    insertLegacyMemory(db, {
      owner: null,
      scope: "guild",
      content: "서버 규칙",
      author: "100000000000000009"
    });

    migrateMindSchema(db);

    const row = db
      .query<{ created_by_user_id: string }, []>(
        "SELECT created_by_user_id FROM mind_memories LIMIT 1"
      )
      .get();
    expect(row?.created_by_user_id).toBe("100000000000000009");
  });

  test("trust 값을 rapport로 옮기고 이후 실행에서는 덮어쓰지 않는다", () => {
    const db = legacyDb();
    db.query(
      `INSERT INTO mind_relationships (guild_id, user_id, familiarity, trust, playfulness,
         boundaries, interaction_count, last_interaction_at, version)
       VALUES (?, ?, 0.4, 0.91, 0.2, '[]', 7, 5, 1)`
    ).run(GUILD, USER);

    migrateMindSchema(db);

    const read = () =>
      db
        .query<{ rapport: number; familiarity: number }, []>(
          "SELECT rapport, familiarity FROM mind_relationships LIMIT 1"
        )
        .get();
    expect(read()?.rapport).toBeCloseTo(0.91);
    expect(read()?.familiarity).toBeCloseTo(0.4);

    // 사용자가 조정한 값을 두 번째 실행이 되돌리지 않는다.
    db.query("UPDATE mind_relationships SET rapport = 0.2").run();
    migrateMindSchema(db);
    expect(read()?.rapport).toBeCloseTo(0.2);
  });

  test("마이그레이션은 두 번 실행해도 같다", () => {
    const db = legacyDb();
    insertLegacyMemory(db, { owner: USER, scope: "user", content: "기억 하나" });

    migrateMindSchema(db);
    const first = db.query("SELECT * FROM mind_memories").all();
    migrateMindSchema(db);

    expect(db.query("SELECT * FROM mind_memories").all()).toEqual(first);
  });

  test("활성 공용 별명은 사용자당 하나만 허용한다", () => {
    const db = legacyDb();
    db.exec(MIND_TABLES);
    migrateMindSchema(db);
    db.exec(MIND_INDEXES);

    const insert = (nickname: string) =>
      db
        .query(
          `INSERT INTO mind_memories
             (guild_id, owner_user_id, subject_user_id, created_by_user_id, scope, kind,
              category, visibility, approval_status, content, normalized_content,
              created_at, updated_at, version)
           VALUES (?, NULL, ?, ?, 'guild', 'semantic', 'nickname', 'shareable', 'active',
                   ?, ?, 1, 1, 1)`
        )
        .run(GUILD, USER, USER, nickname, nickname);

    insert("천재");
    expect(() => insert("바보")).toThrow(/UNIQUE/);

    // 거절된 별명은 같은 사용자에게 여러 개 남을 수 있다.
    db.query("UPDATE mind_memories SET approval_status = 'rejected'").run();
    expect(() => insert("바보")).not.toThrow();
  });
});
