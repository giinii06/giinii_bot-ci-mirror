/**
 * Mind 테이블 정의. 기존 서버 DB에 덧붙이기만 하고 기존 테이블은 건드리지 않는다.
 * 테스트가 임시 DB를 직접 만들 수 있도록 문자열로 분리해 둔다.
 */
export const MIND_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mind_state (
    guild_id TEXT PRIMARY KEY,
    valence REAL NOT NULL DEFAULT 0.55,
    arousal REAL NOT NULL DEFAULT 0.4,
    irritation REAL NOT NULL DEFAULT 0.09,
    curiosity REAL NOT NULL DEFAULT 0.67,
    current_goal TEXT,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS mind_relationships (
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
  CREATE TABLE IF NOT EXISTS mind_memories (
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
  CREATE INDEX IF NOT EXISTS mind_memories_owner_idx
    ON mind_memories (guild_id, owner_user_id, deleted_at);
  CREATE UNIQUE INDEX IF NOT EXISTS mind_memories_source_idx
    ON mind_memories (guild_id, source_message_id, normalized_content)
    WHERE source_message_id IS NOT NULL;
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
  CREATE UNIQUE INDEX IF NOT EXISTS mind_events_message_idx
    ON mind_events (guild_id, message_id) WHERE message_id IS NOT NULL;
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
  CREATE UNIQUE INDEX IF NOT EXISTS mind_feedback_bot_message_idx
    ON mind_feedback (guild_id, bot_message_id);
  CREATE TABLE IF NOT EXISTS mind_meta (
    guild_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, key)
  );
`;

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
