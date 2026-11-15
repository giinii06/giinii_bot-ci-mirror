import type { Database } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import { cleanMemoryText } from "../../chat/memory.js";
import {
  MEMORY_CATEGORIES,
  MEMORY_VISIBILITIES,
  type MemoryActor,
  type MemoryCandidate,
  type MemoryCategory,
  type MemoryRecord,
  type MemoryVisibility
} from "../types.js";

const MAX_MEMORY_LENGTH = 120;
const RECENCY_HALF_LIFE_DAYS = 30;
export const SYSTEM_ACTOR = "system";

type MemoryRow = {
  id: number;
  guild_id: string;
  owner_user_id: string | null;
  subject_user_id: string | null;
  created_by_user_id: string | null;
  scope: string;
  kind: string;
  category: string;
  visibility: string;
  content: string;
  structured_value: string | null;
  normalized_content: string;
  confidence: number;
  importance: number;
  source_message_id: string | null;
  source_channel_id: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number | null;
  expires_at: number | null;
  deleted_at: number | null;
  version: number;
};

export type PersonalMemoryInput = {
  ownerUserId: string;
  createdByUserId: string;
  content: string;
  category?: MemoryCategory;
  visibility?: MemoryVisibility;
  confidence?: number;
  importance?: number;
  sourceMessageId?: string | null;
  sourceChannelId?: string | null;
};

export type GuildMemoryInput = {
  createdByUserId: string;
  category: MemoryCategory;
  subjectUserId: string | null;
  /** 기억에 등장하는 모든 사용자. subject_user_id 하나로는 다중 사용자 기억을 찾기 어렵다. */
  relatedUserIds?: string[];
  content: string;
  structuredValue?: string | null;
  confidence?: number;
  importance?: number;
  sourceMessageId?: string | null;
  sourceChannelId?: string | null;
  source?: "natural_language" | "slash_command";
};

export type GuildMemoryPatch = {
  content?: string;
  category?: MemoryCategory;
  subjectUserId?: string | null;
  relatedUserIds?: string[];
  structuredValue?: string | null;
};

export type GuildNicknameInput = {
  subjectUserId: string;
  nickname: string;
  content: string;
  actorUserId: string;
  sourceMessageId?: string | null;
  sourceChannelId?: string | null;
  source: "natural_language" | "slash_command";
};

export type MemoryRetrievalRequest = {
  actorUserId: string;
  referencedUserIds: string[];
  query: string;
  candidateLimit: number;
  includeOwn?: boolean;
  includeOther?: boolean;
  includeGuild?: boolean;
};

export type MemoryRetrievalResult = {
  candidates: MemoryCandidate[];
  conventions: MemoryRecord[];
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

const categoryOf = (value: string): MemoryCategory =>
  (MEMORY_CATEGORIES as readonly string[]).includes(value)
    ? (value as MemoryCategory)
    : "fact";

const visibilityOf = (value: string): MemoryVisibility =>
  (MEMORY_VISIBILITIES as readonly string[]).includes(value)
    ? (value as MemoryVisibility)
    : "private";

const toRecord = (row: MemoryRow): MemoryRecord => ({
  id: row.id,
  guildId: row.guild_id,
  scope: row.scope === "guild" ? "guild" : "user",
  kind: "semantic",
  category: categoryOf(row.category),
  ownerUserId: row.owner_user_id,
  subjectUserId: row.subject_user_id,
  createdByUserId: row.created_by_user_id ?? row.owner_user_id ?? SYSTEM_ACTOR,
  visibility: visibilityOf(row.visibility),
  content: row.content,
  structuredValue: row.structured_value,
  confidence: row.confidence,
  importance: row.importance,
  sourceMessageId: row.source_message_id,
  sourceChannelId: row.source_channel_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastAccessedAt: row.last_accessed_at,
  expiresAt: row.expires_at,
  deletedAt: row.deleted_at,
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

/** 범위별 후보를 번갈아 합친다. 한 범위가 비면 남은 범위에서 채운다. */
const interleave = (lists: MemoryCandidate[][], limit: number): MemoryCandidate[] => {
  const queues = lists.map((list) => [...list]);
  const seen = new Set<number>();
  const merged: MemoryCandidate[] = [];

  while (merged.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      if (merged.length >= limit) break;
      const next = queue.shift();
      if (!next || seen.has(next.memory.id)) continue;
      seen.add(next.memory.id);
      merged.push(next);
    }
  }

  return merged;
};

export class MindMemoryStore {
  constructor(
    private readonly db: Database,
    private readonly guildId: Snowflake | string
  ) {}

  private get guild(): string {
    return String(this.guildId);
  }

  listOwn(userId: string, limit = 50): MemoryRecord[] {
    const rows = this.db
      .query<MemoryRow, [string, string, number, number]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND owner_user_id = ? AND scope = 'user' AND kind = 'semantic'
           AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(this.guild, userId, Date.now(), limit);
    return rows.map(toRecord);
  }

  countOwn(userId: string): number {
    const row = this.db
      .query<{ n: number }, [string, string, number]>(
        `SELECT COUNT(*) AS n FROM mind_memories
         WHERE guild_id = ? AND owner_user_id = ? AND scope = 'user' AND kind = 'semantic'
           AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`
      )
      .get(this.guild, userId, Date.now());
    return row?.n ?? 0;
  }

  /** 같은 출처 메시지에서 같은 내용이 두 번 들어가지 않도록 정규화 값으로 한 번 더 막는다. */
  addPersonal(input: PersonalMemoryInput): MemoryRecord | null {
    const owner = input.ownerUserId.trim();
    if (!owner) throw new Error("기억 소유자가 필요합니다");
    const content = cleanMemoryText(input.content).slice(0, MAX_MEMORY_LENGTH);
    if (!content) return null;
    const normalized = normalizeMemory(content);
    if (!normalized) return null;

    const now = Date.now();
    try {
      const result = this.db
        .query(
          `INSERT INTO mind_memories
             (guild_id, owner_user_id, subject_user_id, created_by_user_id, scope, kind, category,
              visibility, content, normalized_content, confidence, importance,
              source_message_id, source_channel_id, created_at, updated_at, version)
           VALUES (?, ?, ?, ?, 'user', 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          this.guild,
          owner,
          owner,
          input.createdByUserId,
          input.category ?? "fact",
          input.visibility ?? "private",
          content,
          normalized,
          input.confidence ?? 0.8,
          input.importance ?? 0.5,
          input.sourceMessageId ?? null,
          input.sourceChannelId ?? null,
          now,
          now
        );

      const id = Number(result.lastInsertRowid);
      this.index(id, content);
      this.saveSubjects(id, [owner]);
      return this.byId(id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return null;
      throw error;
    }
  }

  /** 공용 기억은 저장 즉시 활성화된다. 승인 상태 컬럼은 두지 않는다. */
  addGuild(input: GuildMemoryInput): MemoryRecord | null {
    const content = cleanMemoryText(input.content).slice(0, MAX_MEMORY_LENGTH);
    if (!content) return null;
    const normalized = normalizeMemory(content);
    if (!normalized) return null;

    const now = Date.now();
    const subjects = this.subjectIdsOfInput(input.subjectUserId, input.relatedUserIds);
    try {
      const save = this.db.transaction(() => {
        const result = this.db
          .query(
            `INSERT INTO mind_memories
               (guild_id, owner_user_id, subject_user_id, created_by_user_id, scope, kind, category,
                visibility, content, structured_value, normalized_content, confidence, importance,
                source_message_id, source_channel_id, created_at, updated_at, version)
             VALUES (?, NULL, ?, ?, 'guild', 'semantic', ?, 'shareable', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .run(
            this.guild,
            input.subjectUserId,
            input.createdByUserId,
            input.category,
            content,
            input.structuredValue ?? null,
            normalized,
            input.confidence ?? 0.8,
            input.importance ?? 0.5,
            input.sourceMessageId ?? null,
            input.sourceChannelId ?? null,
            now,
            now
          );

        const id = Number(result.lastInsertRowid);
        this.index(id, content);
        this.saveSubjects(id, subjects);
        this.audit({
          memoryId: id,
          actorUserId: input.createdByUserId,
          action: "ADD",
          source: input.source ?? "natural_language",
          previousValue: null,
          newValue: content
        });
        return id;
      });

      return this.byId(save());
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return null;
      throw error;
    }
  }

  /**
   * 별명은 대상 사용자당 하나만 유효하다. 기존 별명이 있으면 같은 행을
   * 새 값으로 바꾸고, 없으면 새로 만든다. 두 별명이 동시에 활성화되지 않는다.
   */
  replaceGuildNickname(input: GuildNicknameInput): MemoryRecord | null {
    const content = cleanMemoryText(input.content).slice(0, MAX_MEMORY_LENGTH);
    if (!content) return null;
    const current = this.findGuildNickname(input.subjectUserId);
    if (!current) {
      return this.addGuild({
        createdByUserId: input.actorUserId,
        category: "nickname",
        subjectUserId: input.subjectUserId,
        relatedUserIds: [input.subjectUserId],
        content,
        structuredValue: input.nickname,
        confidence: 0.9,
        importance: 0.7,
        sourceMessageId: input.sourceMessageId ?? null,
        sourceChannelId: input.sourceChannelId ?? null,
        source: input.source
      });
    }

    const now = Date.now();
    try {
      const replace = this.db.transaction(() => {
        this.db
          .query(
            `UPDATE mind_memories
             SET content = ?, structured_value = ?, normalized_content = ?,
                 updated_at = ?, version = version + 1
             WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`
          )
          .run(content, input.nickname, normalizeMemory(content), now, current.id, this.guild);
        this.reindex(current.id, content);
        this.saveSubjects(current.id, [input.subjectUserId]);
        this.audit({
          memoryId: current.id,
          actorUserId: input.actorUserId,
          action: "UPDATE",
          source: input.source,
          previousValue: current.content,
          newValue: content
        });
      });
      replace();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return null;
      throw error;
    }
    return this.byId(current.id);
  }

  byId(id: number): MemoryRecord | null {
    const row = this.db
      .query<MemoryRow, [number, string]>(
        `SELECT * FROM mind_memories
         WHERE id = ? AND guild_id = ? AND kind = 'semantic' AND deleted_at IS NULL`
      )
      .get(id, this.guild);
    return row ? toRecord(row) : null;
  }

  /** 소유자가 아니면 null. 호출자가 실패로 처리한다. */
  updatePersonal(id: number, userId: string, content: string): MemoryRecord | null {
    const current = this.byId(id);
    if (!current || current.scope !== "user" || current.ownerUserId !== userId) return null;

    const text = cleanMemoryText(content).slice(0, MAX_MEMORY_LENGTH);
    if (!text) return null;

    this.db
      .query(
        `UPDATE mind_memories
         SET content = ?, normalized_content = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`
      )
      .run(text, normalizeMemory(text), Date.now(), id, this.guild);

    this.reindex(id, text);
    return this.byId(id);
  }

  /** 개인 기억의 공유 여부. 다른 사람 대화에서 쓸 수 있는지는 이 값으로만 결정된다. */
  setPersonalVisibility(
    id: number,
    userId: string,
    visibility: MemoryVisibility
  ): boolean {
    const current = this.byId(id);
    if (!current || current.scope !== "user" || current.ownerUserId !== userId) return false;

    this.db
      .query(
        `UPDATE mind_memories
         SET visibility = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`
      )
      .run(visibility, Date.now(), id, this.guild);
    return true;
  }

  /** 삭제는 표시만 남긴다. 이후 검색에서 되살아나지 않는다. */
  deletePersonal(id: number, userId: string): boolean {
    const current = this.byId(id);
    if (!current || current.scope !== "user" || current.ownerUserId !== userId) return false;

    const now = Date.now();
    this.db
      .query(
        `UPDATE mind_memories
         SET deleted_at = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND guild_id = ?`
      )
      .run(now, now, id, this.guild);
    this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?").run(id);
    this.db.query("DELETE FROM mind_memory_subjects WHERE memory_id = ?").run(id);
    return true;
  }

  /**
   * 본인 개인 기억 전체 삭제. 목록 상한 없이 SQL 한 번으로 처리한다.
   * 공용 기억은 이 경로로 지우지 않는다.
   */
  clearPersonal(userId: string): number {
    const ids = this.db
      .query<{ id: number }, [string, string]>(
        `SELECT id FROM mind_memories
         WHERE guild_id = ? AND owner_user_id = ? AND scope = 'user' AND deleted_at IS NULL`
      )
      .all(this.guild, userId)
      .map((row) => row.id);
    if (ids.length === 0) return 0;

    const now = Date.now();
    const remove = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE mind_memories
           SET deleted_at = ?, updated_at = ?, version = version + 1
           WHERE guild_id = ? AND owner_user_id = ? AND scope = 'user' AND deleted_at IS NULL`
        )
        .run(now, now, this.guild, userId);
      const drop = this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?");
      const dropSubjects = this.db.query("DELETE FROM mind_memory_subjects WHERE memory_id = ?");
      for (const id of ids) {
        drop.run(id);
        dropSubjects.run(id);
      }
    });
    remove();
    return ids.length;
  }

  listGuild(limit = 50): MemoryRecord[] {
    const rows = this.db
      .query<MemoryRow, [string, number, number]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND scope = 'guild' AND kind = 'semantic'
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY id ASC LIMIT ?`
      )
      .all(this.guild, Date.now(), limit);
    return rows.map(toRecord);
  }

  updateGuild(id: number, actor: MemoryActor, patch: GuildMemoryPatch): MemoryRecord | null {
    if (!actor.isAdministrator) return null;
    const current = this.byId(id);
    if (!current || current.scope !== "guild") return null;

    const text =
      patch.content === undefined
        ? current.content
        : cleanMemoryText(patch.content).slice(0, MAX_MEMORY_LENGTH);
    if (!text) return null;

    const category = patch.category ?? current.category;
    const subject =
      patch.subjectUserId === undefined ? current.subjectUserId : patch.subjectUserId;
    const structured =
      patch.structuredValue === undefined ? current.structuredValue : patch.structuredValue;

    try {
      const update = this.db.transaction(() => {
        this.db
          .query(
            `UPDATE mind_memories
             SET content = ?, normalized_content = ?, category = ?, subject_user_id = ?,
                 structured_value = ?, updated_at = ?, version = version + 1
             WHERE id = ? AND guild_id = ? AND deleted_at IS NULL`
          )
          .run(
            text,
            normalizeMemory(text),
            category,
            subject,
            structured,
            Date.now(),
            id,
            this.guild
          );
        this.reindex(id, text);
        if (patch.relatedUserIds !== undefined || patch.subjectUserId !== undefined) {
          this.saveSubjects(id, this.subjectIdsOfInput(subject, patch.relatedUserIds));
        }
      });
      update();
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) return null;
      throw error;
    }

    this.audit({
      memoryId: id,
      actorUserId: actor.userId,
      action: "UPDATE",
      source: actor.source,
      previousValue: current.content,
      newValue: text
    });
    return this.byId(id);
  }

  deleteGuild(id: number, actor: MemoryActor): boolean {
    if (!actor.isAdministrator) return false;
    const current = this.byId(id);
    if (!current || current.scope !== "guild") return false;

    const now = Date.now();
    this.db
      .query(
        `UPDATE mind_memories
         SET deleted_at = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND guild_id = ?`
      )
      .run(now, now, id, this.guild);
    this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?").run(id);
    this.db.query("DELETE FROM mind_memory_subjects WHERE memory_id = ?").run(id);
    this.audit({
      memoryId: id,
      actorUserId: actor.userId,
      action: "DELETE",
      source: actor.source,
      previousValue: current.content,
      newValue: null
    });
    return true;
  }

  findGuildNickname(userId: string): MemoryRecord | null {
    const row = this.db
      .query<MemoryRow, [string, string]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND scope = 'guild' AND kind = 'semantic'
           AND category = 'nickname' AND deleted_at IS NULL
           AND subject_user_id = ?
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(this.guild, userId);
    return row ? toRecord(row) : null;
  }

  findApplicableConventions(userIds: string[]): MemoryRecord[] {
    const ids = [...new Set(userIds)].filter((id) => id.length > 0);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .query<MemoryRow, [string, ...string[]]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND scope = 'guild' AND kind = 'semantic'
           AND category = 'nickname' AND deleted_at IS NULL
           AND subject_user_id IN (${placeholders})
         ORDER BY subject_user_id ASC, updated_at DESC`
      )
      .all(this.guild, ...ids);
    return rows.map(toRecord);
  }

  /** 한 기억에 색인된 모든 사용자. 다중 사용자 기억을 사용자별로 찾을 때 쓴다. */
  subjectIdsOf(memoryId: number): string[] {
    return this.db
      .query<{ user_id: string }, [number]>(
        "SELECT user_id FROM mind_memory_subjects WHERE memory_id = ? ORDER BY user_id ASC"
      )
      .all(memoryId)
      .map((row) => row.user_id);
  }

  searchOwn(userId: string, query: string, limit: number): MemoryCandidate[] {
    const rows = this.db
      .query<MemoryRow, [string, string, number]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND owner_user_id = ? AND scope = 'user' AND kind = 'semantic'
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`
      )
      .all(this.guild, userId, Date.now());
    return this.score(rows, query, limit);
  }

  /** 다른 사용자가 공유를 허용한 개인 기억만. 비공개 기억은 SQL 단계에서 빠진다. */
  searchOtherShareable(
    userIds: string[],
    query: string,
    limit: number
  ): MemoryCandidate[] {
    const ids = [...new Set(userIds)].filter((id) => id.length > 0);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .query<MemoryRow, [string, number, ...string[]]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND scope = 'user' AND kind = 'semantic'
           AND visibility = 'shareable' AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND owner_user_id IN (${placeholders})`
      )
      .all(this.guild, Date.now(), ...ids);
    return this.score(rows, query, limit);
  }

  /** 공용 호칭은 규칙으로 적용하므로 후보 검색에서 뺀다. */
  searchGuild(query: string, limit: number): MemoryCandidate[] {
    const rows = this.db
      .query<MemoryRow, [string, number]>(
        `SELECT * FROM mind_memories
         WHERE guild_id = ? AND scope = 'guild' AND kind = 'semantic'
           AND visibility = 'shareable' AND deleted_at IS NULL
           AND category <> 'nickname'
           AND (expires_at IS NULL OR expires_at > ?)`
      )
      .all(this.guild, Date.now());
    return this.score(rows, query, limit);
  }

  /**
   * 세 검색 경로를 합친다. 권한 필터는 각 SQL이 이미 적용했고,
   * 여기서는 중복 제거와 범위별 균형만 맞춘다.
   */
  retrieve(request: MemoryRetrievalRequest): MemoryRetrievalResult {
    const own =
      request.includeOwn === false
        ? []
        : this.searchOwn(request.actorUserId, request.query, request.candidateLimit);
    const referenced = request.referencedUserIds.filter(
      (id) => id !== request.actorUserId
    );
    const other =
      request.includeOther === false
        ? []
        : this.searchOtherShareable(referenced, request.query, request.candidateLimit);
    const guild =
      request.includeGuild === false
        ? []
        : this.searchGuild(request.query, request.candidateLimit);

    const conventions =
      request.includeGuild === false
        ? []
        : this.findApplicableConventions([request.actorUserId, ...referenced]);

    return {
      candidates: interleave([own, other, guild], Math.max(0, request.candidateLimit)),
      conventions
    };
  }

  markAccessed(ids: number[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const update = this.db.query(
      "UPDATE mind_memories SET last_accessed_at = ? WHERE id = ? AND guild_id = ?"
    );
    for (const id of ids) update.run(now, id, this.guild);
  }

  private score(rows: MemoryRow[], query: string, limit: number): MemoryCandidate[] {
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

  private subjectIdsOfInput(
    subjectUserId: string | null,
    relatedUserIds: string[] | undefined
  ): string[] {
    return [
      ...new Set(
        [subjectUserId, ...(relatedUserIds ?? [])].filter(
          (id): id is string => !!id && id.length > 0
        )
      )
    ];
  }

  private saveSubjects(memoryId: number, userIds: string[]): void {
    this.db.query("DELETE FROM mind_memory_subjects WHERE memory_id = ?").run(memoryId);
    if (userIds.length === 0) return;
    const insert = this.db.query(
      "INSERT OR IGNORE INTO mind_memory_subjects (memory_id, user_id) VALUES (?, ?)"
    );
    for (const userId of userIds) insert.run(memoryId, userId);
  }

  private reindex(id: number, content: string): void {
    this.db.query("DELETE FROM mind_memory_fts WHERE rowid = ?").run(id);
    this.index(id, content);
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

  private audit(input: {
    memoryId: number;
    actorUserId: string;
    action: "ADD" | "UPDATE" | "DELETE";
    source: "natural_language" | "slash_command" | "discord_message";
    previousValue: string | null;
    newValue: string | null;
  }): void {
    this.db
      .query(
        `INSERT INTO mind_memory_audit
           (guild_id, memory_id, actor_user_id, action, source, previous_value, new_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.guild,
        input.memoryId,
        input.actorUserId,
        input.action,
        input.source,
        input.previousValue,
        input.newValue,
        Date.now()
      );
  }
}
