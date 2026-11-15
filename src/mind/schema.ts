/**
 * Mind 테이블 정의. 기존 서버 DB에 덧붙이기만 하고 기존 테이블은 건드리지 않는다.
 * 새 DB는 아래 전체 스키마로 만들고, 기존 DB는 db.ts가 빠진 컬럼만 더한다.
 */
import type { Database } from "bun:sqlite";

/** 여러 사용자가 등장하는 기억을 사용자별로 찾기 위한 색인. 관계 테이블이 아니다. */
export const MIND_SUBJECTS_TABLE = `
  CREATE TABLE IF NOT EXISTS mind_memory_subjects (
    memory_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (memory_id, user_id)
  );
`;

export const MIND_TABLES = `
  CREATE TABLE IF NOT EXISTS mind_relationships (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    familiarity REAL NOT NULL DEFAULT 0,
    rapport REAL NOT NULL DEFAULT 0.5,
    playfulness REAL NOT NULL DEFAULT 0.3,
    engagement REAL NOT NULL DEFAULT 0,
    communication_style TEXT NOT NULL DEFAULT 'default',
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
    content TEXT NOT NULL,
    structured_value TEXT,
    normalized_content TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 1.0,
    importance REAL NOT NULL DEFAULT 0.5,
    source_message_id TEXT,
    source_channel_id TEXT,
    source_author_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_accessed_at INTEGER,
    expires_at INTEGER,
    deleted_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  );
  ${MIND_SUBJECTS_TABLE}
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
    structured_value: "TEXT",
    source_channel_id: "TEXT"
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
  `INSERT OR IGNORE INTO mind_memory_subjects (memory_id, user_id)
   SELECT id, subject_user_id FROM mind_memories
   WHERE subject_user_id IS NOT NULL AND deleted_at IS NULL`,
  `INSERT OR IGNORE INTO mind_memory_subjects (memory_id, user_id)
   SELECT id, owner_user_id FROM mind_memories
   WHERE scope = 'user' AND owner_user_id IS NOT NULL AND deleted_at IS NULL`
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
    ON mind_memories (guild_id, scope, visibility, deleted_at);
  CREATE UNIQUE INDEX IF NOT EXISTS mind_active_guild_nickname_idx
    ON mind_memories (guild_id, subject_user_id)
    WHERE scope = 'guild'
      AND category = 'nickname'
      AND deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS mind_memory_subjects_user_idx
    ON mind_memory_subjects (user_id, memory_id);
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
 * 승인 컬럼을 쓰던 DB를 즉시 활성화 모델로 옮긴다.
 * 대기 중이던 기억은 활성화하고, 거부된 기억은 검색에서 빠지도록 표시한 뒤
 * 승인 컬럼과 인덱스를 없앤다. 거부 기록은 미래의 차단 규칙으로 쓰지 않는다.
 */
const dropApprovalState = (db: Database): void => {
  const columns = columnsOf(db, "mind_memories");
  if (!columns.has("approval_status")) return;

  db.exec("DROP INDEX IF EXISTS mind_memory_review_idx");
  db.exec("DROP INDEX IF EXISTS mind_memory_shared_idx");
  db.exec("DROP INDEX IF EXISTS mind_active_guild_nickname_idx");

  const now = Date.now();
  db.exec(
    `UPDATE mind_memories
     SET deleted_at = COALESCE(deleted_at, ${now}), updated_at = ${now}
     WHERE approval_status = 'rejected'`
  );
  db.exec(
    `DELETE FROM mind_memory_fts
     WHERE rowid IN (SELECT id FROM mind_memories WHERE approval_status = 'rejected')`
  );
  db.exec("UPDATE mind_memories SET approval_status = 'active' WHERE approval_status = 'pending'");

  // 같은 대상의 활성 별명은 최신 하나만 남긴다.
  db.exec(
    `UPDATE mind_memories
     SET deleted_at = ${now}, updated_at = ${now}
     WHERE scope = 'guild' AND category = 'nickname' AND approval_status = 'active'
       AND deleted_at IS NULL AND subject_user_id IS NOT NULL
       AND id NOT IN (
         SELECT MAX(id) FROM mind_memories
         WHERE scope = 'guild' AND category = 'nickname' AND approval_status = 'active'
           AND deleted_at IS NULL AND subject_user_id IS NOT NULL
         GROUP BY guild_id, subject_user_id
       )`
  );
  db.exec(
    `DELETE FROM mind_memory_fts
     WHERE rowid IN (
       SELECT id FROM mind_memories
       WHERE scope = 'guild' AND category = 'nickname' AND deleted_at IS NOT NULL
     )`
  );

  db.exec("ALTER TABLE mind_memories DROP COLUMN approval_status");
  if (columns.has("reviewed_by_user_id")) {
    db.exec("ALTER TABLE mind_memories DROP COLUMN reviewed_by_user_id");
  }
  if (columns.has("reviewed_at")) {
    db.exec("ALTER TABLE mind_memories DROP COLUMN reviewed_at");
  }
};

/**
 * 기존 DB에 빠진 컬럼만 더하고, 승인 상태는 즉시 활성화 모델로 옮긴다.
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

  dropApprovalState(db);
  db.exec(MIND_SUBJECTS_TABLE);

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
