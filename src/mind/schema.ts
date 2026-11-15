/**
 * Mind 테이블 정의. 기존 서버 DB에 덧붙이기만 하고 기존 테이블은 건드리지 않는다.
 * 새 DB는 아래 전체 스키마로 만들고, 기존 DB는 db.ts가 빠진 컬럼만 더한다.
 */
import type { Database } from "bun:sqlite";

export const MIND_TABLES = `
  CREATE TABLE IF NOT EXISTS mind_relationships (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    familiarity REAL NOT NULL DEFAULT 0,
    rapport REAL NOT NULL DEFAULT 0.5,
    playfulness REAL NOT NULL DEFAULT 0.3,
    engagement REAL NOT NULL DEFAULT 0,
    communication_style TEXT NOT NULL DEFAULT 'default',
    boundaries TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    positive_interaction_count INTEGER NOT NULL DEFAULT 0,
    negative_feedback_count INTEGER NOT NULL DEFAULT 0,
    first_interaction_at INTEGER NOT NULL DEFAULT 0,
    last_interaction_at INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS mind_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    owner_user_id TEXT,
    subject_user_id TEXT,
    created_by_user_id TEXT,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'fact',
    visibility TEXT NOT NULL DEFAULT 'private',
    approval_status TEXT NOT NULL DEFAULT 'active',
    content TEXT NOT NULL,
    structured_value TEXT,
    normalized_content TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 1.0,
    importance REAL NOT NULL DEFAULT 0.5,
    source_message_id TEXT,
    source_channel_id TEXT,
    source_author_id TEXT,
    reviewed_by_user_id TEXT,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_accessed_at INTEGER,
    expires_at INTEGER,
    deleted_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS mind_memory_fts USING fts5(
    content,
    tokenize = 'unicode61'
  );
  CREATE TABLE IF NOT EXISTS mind_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message_id TEXT,
    intent TEXT,
    action TEXT,
    goal TEXT,
    emotion_delta TEXT NOT NULL DEFAULT '{}',
    decision_source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mind_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    bot_message_id TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    selected_action TEXT NOT NULL,
    response_type TEXT NOT NULL,
    feedback_score REAL NOT NULL,
    evaluated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mind_memory_audit (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    memory_id INTEGER NOT NULL,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    source TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mind_meta (
    guild_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, key)
  );
`;

/** 기존 DB에서 빠진 컬럼. ALTER TABLE ADD COLUMN만 허용한다. */
export const MIND_COLUMNS: Record<string, Record<string, string>> = {
  mind_memories: {
    subject_user_id: "TEXT",
    created_by_user_id: "TEXT",
    category: "TEXT NOT NULL DEFAULT 'fact'",
    visibility: "TEXT NOT NULL DEFAULT 'private'",
    approval_status: "TEXT NOT NULL DEFAULT 'active'",
    structured_value: "TEXT",
    source_channel_id: "TEXT",
    reviewed_by_user_id: "TEXT",
    reviewed_at: "INTEGER"
  },
  mind_relationships: {
    rapport: "REAL NOT NULL DEFAULT 0.5",
    engagement: "REAL NOT NULL DEFAULT 0",
    communication_style: "TEXT NOT NULL DEFAULT 'default'",
    confidence: "REAL NOT NULL DEFAULT 0",
    positive_interaction_count: "INTEGER NOT NULL DEFAULT 0",
    negative_feedback_count: "INTEGER NOT NULL DEFAULT 0",
    first_interaction_at: "INTEGER NOT NULL DEFAULT 0"
  }
};

/**
 * 기존 행은 개인 기억이면 비공개, 공용 기억이면 공유 가능으로 남긴다.
 * 작성자를 모르는 공용 기억은 system으로 채운다.
 */
export const MIND_BACKFILL = [
  `UPDATE mind_memories
   SET created_by_user_id = COALESCE(source_author_id, owner_user_id, 'system')
   WHERE created_by_user_id IS NULL`,
  `UPDATE mind_memories
   SET visibility = 'shareable'
   WHERE scope = 'guild' AND visibility = 'private'`,
  // 같은 사용자에게 활성 별명이 여럿이면 최신 하나만 남기고 나머지는 거절로 돌린다.
  `UPDATE mind_memories
   SET approval_status = 'rejected'
   WHERE scope = 'guild' AND category = 'nickname' AND approval_status = 'active'
     AND deleted_at IS NULL AND subject_user_id IS NOT NULL
     AND id NOT IN (
       SELECT MAX(id) FROM mind_memories
       WHERE scope = 'guild' AND category = 'nickname' AND approval_status = 'active'
         AND deleted_at IS NULL AND subject_user_id IS NOT NULL
       GROUP BY guild_id, subject_user_id
     )`
];

export const MIND_INDEXES = `
  CREATE INDEX IF NOT EXISTS mind_memories_owner_idx
    ON mind_memories (guild_id, owner_user_id, scope, deleted_at);
  CREATE UNIQUE INDEX IF NOT EXISTS mind_memories_source_idx
    ON mind_memories (guild_id, source_message_id, normalized_content)
    WHERE source_message_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS mind_memory_subject_idx
    ON mind_memories (guild_id, subject_user_id, scope, category, deleted_at);
  CREATE INDEX IF NOT EXISTS mind_memory_shared_idx
    ON mind_memories (guild_id, scope, visibility, approval_status, deleted_at);
  CREATE INDEX IF NOT EXISTS mind_memory_review_idx
    ON mind_memories (guild_id, approval_status, created_at);
  CREATE UNIQUE INDEX IF NOT EXISTS mind_active_guild_nickname_idx
    ON mind_memories (guild_id, subject_user_id, category)
    WHERE scope = 'guild'
      AND category = 'nickname'
      AND approval_status = 'active'
      AND deleted_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS mind_events_message_idx
    ON mind_events (guild_id, message_id) WHERE message_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS mind_feedback_bot_message_idx
    ON mind_feedback (guild_id, bot_message_id);
  CREATE INDEX IF NOT EXISTS mind_memory_audit_memory_idx
    ON mind_memory_audit (guild_id, memory_id, created_at);
`;

/** 테스트와 새 DB용 전체 스키마. 기존 DB는 db.ts가 컬럼 보강 후 인덱스를 만든다. */
export const MIND_SCHEMA = `${MIND_TABLES}\n${MIND_INDEXES}`;

const columnsOf = (db: Database, table: string): Set<string> => {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((row) => row.name));
};

/**
 * 기존 DB에 빠진 컬럼만 더한다. 데이터를 지우거나 테이블을 다시 만들지 않는다.
 * storage에 의존하지 않아 테스트가 DB 경로 설정과 무관하게 쓸 수 있다.
 */
export const migrateMindSchema = (db: Database): void => {
  const added = new Set<string>();
  for (const [table, columns] of Object.entries(MIND_COLUMNS)) {
    const existing = columnsOf(db, table);
    for (const [name, definition] of Object.entries(columns)) {
      if (existing.has(name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      added.add(`${table}.${name}`);
    }
  }

  // trust → rapport 개명. 컬럼을 이번에 새로 만들었을 때만 값을 옮겨
  // 이후 실행에서 사용자가 조정한 rapport를 덮어쓰지 않는다.
  if (
    added.has("mind_relationships.rapport") &&
    columnsOf(db, "mind_relationships").has("trust")
  ) {
    db.exec("UPDATE mind_relationships SET rapport = trust");
  }

  for (const statement of MIND_BACKFILL) db.exec(statement);
};

/** 무료 Decision 호출량은 계정 단위라 서버 DB가 아니라 루트 DB에 쌓는다. */
export const ROOT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mind_decision_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mind_decision_usage_created_idx
    ON mind_decision_usage (created_at);
`;
