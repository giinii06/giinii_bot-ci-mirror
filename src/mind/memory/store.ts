import type { Database } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import { cleanMemoryText } from "../../chat/memory.js";
import type {
  MemoryCandidate,
  MemoryKind,
  MemoryRecord,
  MemoryScope
} from "../types.js";

const MAX_MEMORY_LENGTH = 120;
const RECENCY_HALF_LIFE_DAYS = 30;

type MemoryRow = {
  id: number;
  guild_id: string;
  owner_user_id: string | null;
  scope: string;
  kind: string;
  content: string;
  normalized_content: string;
  confidence: number;
  importance: number;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number | null;
  expires_at: number | null;
  version: number;
};

export type MemoryInput = {
  ownerUserId: string | null;
  scope?: MemoryScope;
  kind?: MemoryKind;
  content: string;
  confidence?: number;
  importance?: number;
  sourceMessageId?: string | null;
  sourceAuthorId?: string | null;
  expiresAt?: number | null;
};

const oneLine = (value: string) => value.trim().replace(/\s+/g, " ");

export const normalizeMemory = (value: string): string =>
  oneLine(value)
    .replace(/^[-*+]\s+/, "")
    .replace(/[.!?~。]+$/g, "")
    .toLowerCase();

const bigrams = (value: string): Set<string> => {
  const chars = [...value.replace(/\s+/g, "")];
  if (chars.length < 2) return new Set(chars);
  const grams = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.add(`${chars[index]}${chars[index + 1]}`);
  }
  return grams;
};

/** Dice 계수. 한국어는 공백이 적어 문자 bigram이 가장 안정적이다. */
const similarity = (left: string, right: string): number => {
  const a = normalizeMemory(left);
  const b = normalizeMemory(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const overlap = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.8 + overlap * 0.19;
  }

  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  const total = aGrams.size + bGrams.size;
  if (total === 0) return 0;
  let shared = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) shared += 1;
  }
  return (2 * shared) / total;
};

const toRecord = (row: MemoryRow): MemoryRecord => ({
  id: row.id,
  guildId: row.guild_id,
  ownerUserId: row.owner_user_id,
  scope: row.scope as MemoryScope,
  kind: row.kind as MemoryKind,
  content: row.content,
  confidence: row.confidence,
  importance: row.importance,
  sourceMessageId: row.source_message_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastAccessedAt: row.last_accessed_at,
  expiresAt: row.expires_at,
  version: row.version
});

/**
 * FTS 질의는 사용자 입력을 그대로 쓰지 않는다.
 * 한국어는 두 글자 단어가 흔해서 trigram 대신 unicode61 + 접두사(*)로 찾는다.
 */
const ftsQuery = (text: string): string | null => {
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 5);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token.replace(/"/g, "")}*`).join(" OR ");
};

/** Decision이 고른 기억만 남긴다. 후보에 없던 id는 버린다. */
export const selectMemories = (
  candidates: MemoryCandidate[],
  ids: number[]
): MemoryRecord[] => {
  const wanted = new Set(ids);
  return candidates
    .filter((candidate) => wanted.has(candidate.memory.id))
    .map((candidate) => candidate.memory);
};

export class MindMemoryStore {
  constructor(
    private readonly db: Database,
    private readonly guildId: Snowflake | string
  ) {}

  private get guild(): string {
    return String(this.guildId);
  }

  list(userId: string, limit = 50): MemoryRecord[] {
    const rows = this.db
      .query<MemoryRow, [string, string, number, number]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND owner_user_id = ? AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(this.guild, userId, Date.now(), limit);
    return rows.map(toRecord);
  }

  count(userId: string): number {
    const row = this.db
      .query<{ n: number }, [string, string, number]>(
        `SELECT COUNT(*) AS n FROM mind_memories
         WHERE guild_id = ? AND owner_user_id = ? AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`
      )
      .get(this.guild, userId, Date.now());
    return row?.n ?? 0;
  }

  /** 같은 출처 메시지에서 같은 내용이 두 번 들어가지 않도록 정규화 값으로 한 번 더 막는다. */
  add(input: MemoryInput): MemoryRecord | null {
    const content = cleanMemoryText(input.content).slice(0, MAX_MEMORY_LENGTH);
    if (!content) return null;
    const normalized = normalizeMemory(content);
    if (!normalized) return null;

    const now = Date.now();
    try {
      const result = this.db
        .query(
          `INSERT INTO mind_memories
             (guild_id, owner_user_id, scope, kind, content, normalized_content, confidence, importance,
              source_message_id, source_author_id, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          this.guild,
          input.ownerUserId,
          input.scope ?? "user",
          input.kind ?? "semantic",
          content,
          normalized,
          input.confidence ?? 0.8,
          input.importance ?? 0.5,
          input.sourceMessageId ?? null,
          input.sourceAuthorId ?? null,
          now,
          now
        );

      const id = Number(result.lastInsertRowid);
      this.index(id, content);
      return this.byId(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return null;
      throw error;
    }
  }

  byId(id: number): MemoryRecord | null {
    const row = this.db
      .query<MemoryRow, [number, string]>(
        "SELECT * FROM mind_memories WHERE id = ? AND guild_id = ? AND deleted_at IS NULL"
      )
      .get(id, this.guild);
    return row ? toRecord(row) : null;
  }

  /** 소유자가 아니면 null. 호출자가 실패로 처리한다. */
  update(id: number, userId: string, content: string): MemoryRecord | null {
    const current = this.byId(id);
    if (!current || current.ownerUserId !== userId) return null;

    const text = cleanMemoryText(content).slice(0, MAX_MEMORY_LENGTH);
    if (!text) return null;

    this.db
      .query(
        `UPDATE mind_memories
         SET content = ?, normalized_content = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`
      )
      .run(text, normalizeMemory(text), Date.now(), id, this.guild);

    this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?").run(id);
    this.index(id, text);
    return this.byId(id);
  }

  /** 삭제는 표시만 남긴다. 이후 검색·마이그레이션·Reflection에서 되살아나지 않는다. */
  remove(id: number, userId: string): boolean {
    const current = this.byId(id);
    if (!current || current.ownerUserId !== userId) return false;

    this.db
      .query(
        "UPDATE mind_memories SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND guild_id = ?"
      )
      .run(Date.now(), Date.now(), id, this.guild);
    this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?").run(id);
    return true;
  }

  clear(userId: string): number {
    const ids = this.list(userId, 1000).map((memory) => memory.id);
    const now = Date.now();
    const remove = this.db.query(
      "UPDATE mind_memories SET deleted_at = ?, updated_at = ? WHERE id = ? AND guild_id = ?"
    );
    for (const id of ids) {
      remove.run(now, now, id, this.guild);
      this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?").run(id);
    }
    return ids.length;
  }

  /**
   * 후보 검색. 권한·삭제·만료를 먼저 거르고, 관련성·중요도·최근성·신뢰도로 정렬한다.
   * 다른 사람의 비공개 기억은 이 단계에서 이미 빠진다.
   */
  candidates(userId: string, query: string, limit: number): MemoryCandidate[] {
    const rows = this.db
      .query<MemoryRow, [string, number, string]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND (owner_user_id = ? OR scope = 'guild')
         ORDER BY updated_at DESC LIMIT 200`
      )
      .all(this.guild, Date.now(), userId);

    if (rows.length === 0) return [];

    const ftsHits = this.searchIndex(query);
    const now = Date.now();
    const scored = rows.map((row) => {
      const lexical = similarity(row.content, query);
      const indexed = ftsHits.has(row.id) ? 0.7 : 0;
      const relevance = Math.max(lexical, indexed);
      const ageDays = Math.max(0, (now - row.updated_at) / 86_400_000);
      const recency = Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
      const score =
        0.45 * relevance + 0.2 * row.importance + 0.15 * recency + 0.2 * row.confidence;

      return {
        memory: toRecord(row),
        score,
        matched: relevance >= 0.2
      } satisfies MemoryCandidate;
    });

    // 관련 근거가 전혀 없는 기억까지 후보로 보내면 Decision 질문만 낭비된다.
    return scored
      .filter((candidate) => candidate.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit));
  }

  markAccessed(ids: number[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const update = this.db.query(
      "UPDATE mind_memories SET last_accessed_at = ? WHERE id = ? AND guild_id = ?"
    );
    for (const id of ids) update.run(now, id, this.guild);
  }

  private searchIndex(query: string): Set<number> {
    const match = ftsQuery(query);
    if (!match) return new Set();
    try {
      const rows = this.db
        .query<{ memory_id: number }, [string]>(
          "SELECT rowid AS memory_id FROM mind_memory_fts WHERE mind_memory_fts MATCH ? LIMIT 50"
        )
        .all(match);
      return new Set(rows.map((row) => row.memory_id));
    } catch {
      // FTS 문법 오류는 후보 없음으로 처리하고 bigram 점수만 쓴다.
      return new Set();
    }
  }

  private index(id: number, content: string): void {
    try {
      this.db
        .query("INSERT INTO mind_memory_fts (rowid, content) VALUES (?, ?)")
        .run(id, content);
    } catch (error) {
      console.error("[mind] FTS 색인 실패", error);
    }
  }
}
