import type { Database } from "bun:sqlite";
import {
  DecisionClient,
  isTimeoutError,
  type DecisionTransport
} from "./decision/client.js";
import { CircuitBreaker } from "./decision/circuit-breaker.js";
import { parseDecision, type DecisionDraft, type DecisionSignals } from "./decision/parser.js";
import { buildQuestions, renderState } from "./decision/questions.js";
import { DecisionQuota } from "./decision/quota.js";
import {
  applyRefinement,
  buildRefineQuestions,
  needsRefinement,
  refineOptions,
  renderRefineState
} from "./decision/refinement.js";
import { localDecision } from "./fallback.js";
import { compileFrame as buildFrame } from "./frame.js";
import type { MindConfig } from "./config.js";
import { MindMemoryStore, selectMemories } from "./memory/store.js";
import { commitMemoryOperation } from "./memory/operations.js";
import { validateNickname } from "./memory/policy.js";
import { BotUserRelationshipStore } from "./relationship/store.js";
import type {
  CharacterFrame,
  CompletedTurn,
  MemoryActor,
  MemoryCategory,
  MemoryOperationResult,
  MemoryRecord,
  MemoryVisibility,
  MindContext,
  MindDecision,
  MindRequest,
  RecentMessage
} from "./types.js";

export type MindEngineDeps = {
  guildId: string;
  db: Database;
  rootDb: Database;
  apiKey: string;
  config: MindConfig;
  now?: () => number;
  /** 테스트에서 Decision 호출을 대체한다. 없으면 apiKey로 실제 클라이언트를 만든다. */
  transport?: DecisionTransport;
};

export type MindStatus = {
  enabled: boolean;
  model: string;
  breaker: string;
  usage: ReturnType<DecisionQuota["stats"]>;
  failureRate: number;
};

export type GuildMemoryInput = {
  actor: MemoryActor;
  category: MemoryCategory;
  subjectUserId: string | null;
  content: string;
  structuredValue?: string | null;
};

export type NicknameResult =
  | { ok: true; memory: MemoryRecord }
  | { ok: false; reason: string };

/**
 * 캐릭터 판단의 조율자. 바깥에서는 이 다섯 메서드만 알면 된다.
 * 실제 상태 변경은 모두 TypeScript가 검증한 뒤에만 일어난다.
 */
export class MindEngine {
  readonly relationship: BotUserRelationshipStore;
  readonly memories: MindMemoryStore;
  private readonly quota: DecisionQuota;
  private readonly breaker: CircuitBreaker;
  private readonly client: DecisionTransport | null;
  private readonly now: () => number;

  constructor(private readonly deps: MindEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.relationship = new BotUserRelationshipStore(deps.db, deps.guildId, {
      enabled: deps.config.relationship.enabled,
      updateLimit: deps.config.relationship.updateLimit
    });
    this.memories = new MindMemoryStore(deps.db, deps.guildId);
    this.quota = new DecisionQuota(
      deps.rootDb,
      {
        dailyBudget: deps.config.dailyBudget,
        minuteBudget: deps.config.minuteBudget
      },
      this.now
    );
    this.breaker = new CircuitBreaker(3, 60_000, this.now);
    this.client =
      deps.transport ??
      (deps.apiKey
        ? new DecisionClient(
            deps.apiKey,
            deps.config.decisionApiUrl,
            deps.config.decisionModel
          )
        : null);
  }

  prepareContext(request: MindRequest): MindContext {
    const now = this.now();
    const retrieved = this.deps.config.memory.enabled
      ? this.memories.retrieve({
          actorUserId: request.userId,
          referencedUserIds: request.referencedUsers.map((user) => user.userId),
          // "나 누군지 기억해?"처럼 본문에 이름이 없어도 발화자 이름으로 기억을 찾는다.
          query: `${request.displayName} ${request.text}`,
          candidateLimit: this.deps.config.memory.candidates,
          includeOwn: true,
          includeOther: this.deps.config.memory.otherUserEnabled,
          includeGuild: this.deps.config.memory.guildEnabled
        })
      : { candidates: [], conventions: [] };

    return {
      request,
      relationship: this.relationship.load(request.userId, now),
      candidates: retrieved.candidates,
      conventions: retrieved.conventions,
      recent: toRecentMessages(request, now)
    };
  }

  async decide(context: MindContext): Promise<MindDecision> {
    const fallback = (): MindDecision =>
      this.buildDecision(context, localDecision(context), "local_fallback", false);

    if (!this.deps.config.enabled || !this.client) return fallback();
    if (!this.breaker.allow()) return fallback();

    const model = this.deps.config.decisionModel;
    const started = this.now();
    const reservation = this.quota.reserve(context.request.messageId, model, "primary");
    if (!reservation) return fallback();

    let settled = false;
    const settle = (status: "ok" | "error" | "timeout" | "limited") => {
      if (settled) return;
      settled = true;
      reservation.settle(status, this.now() - started);
    };

    try {
      const response = await this.client.ask({
        turnId: context.request.messageId,
        kind: "primary",
        state: renderState(context),
        questions: buildQuestions(context),
        timeoutMs: this.deps.config.decisionTimeoutMs
      });

      const parsed = parseDecision(response.answers ?? {}, context, {
        maxSelected: this.deps.config.memory.selected
      });
      // 정밀 판단 시간이 1차 호출 지연으로 기록되지 않도록 먼저 확정한다.
      settle("ok");

      let draft = parsed.draft;
      let refined = false;

      if (
        this.deps.config.maxDecisionsPerTrigger > 1 &&
        needsRefinement(draft, parsed.signals, {
          adaptiveRefinement: this.deps.config.adaptiveRefinement,
          refineConfidenceFloor: this.deps.config.refineConfidenceFloor,
          refineMarginFloor: this.deps.config.refineMarginFloor
        })
      ) {
        const refinedDraft = await this.refine(context, draft, parsed.signals);
        if (refinedDraft) {
          draft = refinedDraft;
          refined = true;
        }
      }

      settle("ok");
      this.breaker.record(true);
      return this.buildDecision(context, draft, refined ? "remote_refined" : "remote", refined);
    } catch (error) {
      settle(isTimeoutError(error) ? "timeout" : "error");
      this.breaker.record(false);
      if (this.deps.config.debug) console.error("[mind] Decision 실패", error);
      return fallback();
    }
  }

  private async refine(
    context: MindContext,
    draft: DecisionDraft,
    signals: DecisionSignals
  ): Promise<DecisionDraft | null> {
    if (!this.client) return null;
    const reservation = this.quota.reserve(
      context.request.messageId,
      this.deps.config.decisionModel,
      "refine"
    );
    if (!reservation) return null;

    const started = this.now();
    let settled = false;
    const settle = (status: "ok" | "error" | "timeout") => {
      if (settled) return;
      settled = true;
      reservation.settle(status, this.now() - started);
    };

    const options = refineOptions(draft, signals);

    try {
      const response = await this.client.ask({
        turnId: context.request.messageId,
        kind: "refine",
        state: renderRefineState(context, draft),
        questions: buildRefineQuestions(draft, options),
        timeoutMs: this.deps.config.refineTimeoutMs
      });
      settle("ok");
      return applyRefinement(draft, response.answers ?? {}, options);
    } catch (error) {
      settle(isTimeoutError(error) ? "timeout" : "error");
      if (this.deps.config.debug) {
        console.error("[mind] 정밀 판단 실패, 기본 판단을 쓴다", error);
      }
      return null;
    }
  }

  private buildDecision(
    context: MindContext,
    draft: DecisionDraft,
    source: MindDecision["source"],
    refined: boolean
  ): MindDecision {
    const selected = selectMemories(context.candidates, draft.selectedMemoryIds);
    if (selected.length > 0) {
      this.memories.markAccessed(selected.map((memory) => memory.id));
    }

    return {
      intent: draft.intent,
      socialContext: draft.socialContext,
      relationshipSignal: draft.relationshipSignal,
      userNeeds: draft.userNeeds,
      goal: draft.goal,
      action: draft.action,
      humorStrategy: draft.humorStrategy,
      needsWeb: draft.needsWeb,
      memory: draft.memory,
      selectedMemories: selected,
      confidence: draft.confidence,
      refined,
      source
    };
  }

  commitMemoryOperation(
    context: MindContext,
    decision: MindDecision
  ): MemoryOperationResult {
    if (!this.deps.config.memory.enabled) {
      return { status: "none", added: [], updated: [], removed: [], reason: null };
    }

    return commitMemoryOperation(this.memories, {
      actor: {
        userId: context.request.userId,
        guildId: context.request.guildId,
        isAdministrator: context.request.isAdministrator,
        source: "discord_message"
      },
      messageId: context.request.messageId,
      channelId: context.request.channelId,
      text: context.request.text,
      decision: decision.memory,
      referencedUsers: context.request.referencedUsers,
      ambiguousUserNames: context.request.ambiguousUserNames,
      authorDisplayName: context.request.displayName,
      autoMemory: this.deps.config.memory.autoMemory
    });
  }

  compileFrame(
    context: MindContext,
    decision: MindDecision,
    memoryResult: MemoryOperationResult
  ): CharacterFrame {
    return buildFrame(context, decision, memoryResult, {
      playfulnessFloor: this.deps.config.relationship.playfulnessFloor
    });
  }

  /** 답변이 나간 뒤에만 호출한다. 여기서 실패해도 답변을 되돌리지 않는다. */
  afterReply(turn: CompletedTurn): void {
    const { context, decision, memoryResult } = turn;
    const now = this.now();

    // 같은 메시지의 사후 처리가 두 번 실행되면 관계 점수도 두 번 움직인다.
    // 사건 기록과 관계 갱신을 한 트랜잭션에 묶고, 처음 기록일 때만 관계를 바꾼다.
    const apply = this.deps.db.transaction(() => {
      const inserted = this.deps.db
        .query(
          `INSERT OR IGNORE INTO mind_events
             (guild_id, user_id, message_id, intent, action, goal, emotion_delta, decision_source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`
        )
        .run(
          this.deps.guildId,
          context.request.userId,
          context.request.messageId,
          decision.intent,
          decision.action,
          decision.goal,
          decision.source,
          now
        );
      if (inserted.changes === 0) return false;

      const next = this.relationship.applyInteraction(
        this.relationship.load(context.request.userId, now),
        decision.relationshipSignal,
        now
      );
      this.relationship.save(next, now);
      return true;
    });

    try {
      apply();
    } catch (error) {
      console.error("[mind] 사후 상태 기록 실패", error);
    }

    if (this.deps.config.feedback && turn.sentMessageId) {
      this.deps.db
        .query(
          `INSERT OR IGNORE INTO mind_feedback
             (guild_id, bot_message_id, source_message_id, user_id, selected_action, response_type, feedback_score, evaluated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`
        )
        .run(
          this.deps.guildId,
          turn.sentMessageId,
          context.request.messageId,
          context.request.userId,
          decision.action,
          now
        );
    }

    this.recordFeedback(context, decision, now);
    if (this.deps.config.debug && memoryResult.status !== "none") {
      console.log(`[mind] 기억 작업 ${memoryResult.status}`);
    }
  }

  /** 이전 기니봇 답변에 답장했다면 그 답변의 평가를 갱신한다. */
  private recordFeedback(
    context: MindContext,
    decision: MindDecision,
    now: number
  ): void {
    if (!this.deps.config.feedback || !context.request.replyToMessageId) return;
    const score =
      decision.relationshipSignal === "rejection" ||
      decision.relationshipSignal === "boundary_set"
        ? -1
        : decision.relationshipSignal === "warm" ||
            decision.relationshipSignal === "playful"
          ? 1
          : 0;

    this.deps.db
      .query(
        `UPDATE mind_feedback SET response_type = ?, feedback_score = ?, evaluated_at = ?
         WHERE guild_id = ? AND bot_message_id = ?`
      )
      .run(
        decision.relationshipSignal,
        score,
        now,
        this.deps.guildId,
        context.request.replyToMessageId
      );
  }

  listMemories(userId: string, limit = 25) {
    return this.memories.listOwn(userId, limit);
  }

  listGuildMemories(limit = 50) {
    return this.memories.listGuild(limit);
  }

  addGuildMemory(input: GuildMemoryInput): MemoryRecord | null {
    if (!input.actor.isAdministrator) return null;
    return this.memories.addGuild({
      createdByUserId: input.actor.userId,
      category: input.category,
      subjectUserId: input.subjectUserId,
      content: input.content,
      structuredValue: input.structuredValue ?? null,
      confidence: 0.9,
      importance: 0.7,
      source: "slash_command"
    });
  }

  updateGuildMemory(
    id: number,
    actor: MemoryActor,
    patch: { content?: string; category?: MemoryCategory; subjectUserId?: string | null }
  ): MemoryRecord | null {
    return this.memories.updateGuild(id, actor, patch);
  }

  deleteGuildMemory(id: number, actor: MemoryActor): boolean {
    return this.memories.deleteGuild(id, actor);
  }

  setGuildNickname(input: {
    actor: MemoryActor;
    subjectUserId: string;
    subjectDisplayName: string;
    nickname: string;
  }): NicknameResult {
    if (!input.actor.isAdministrator) {
      return { ok: false, reason: "관리자만 공용 별명을 설정할 수 있습니다" };
    }
    const validation = validateNickname(input.nickname);
    if (!validation.ok) return { ok: false, reason: validation.reason };

    const content = `${input.subjectDisplayName}의 별명은 "${validation.value}"이다.`;
    const saved = this.memories.replaceGuildNickname({
      subjectUserId: input.subjectUserId,
      nickname: validation.value,
      content,
      actorUserId: input.actor.userId,
      source: "slash_command"
    });
    return saved
      ? { ok: true, memory: saved }
      : { ok: false, reason: "별명을 저장하지 못했습니다" };
  }

  setMemoryVisibility(
    userId: string,
    id: number,
    visibility: MemoryVisibility
  ): boolean {
    return this.memories.setPersonalVisibility(id, userId, visibility);
  }

  clearMemories(userId: string): number {
    const removed = this.memories.clearPersonal(userId);
    this.relationship.reset(userId);
    return removed;
  }

  status(): MindStatus {
    return {
      enabled: this.deps.config.enabled,
      model: this.deps.config.decisionModel,
      breaker: this.breaker.current(),
      usage: this.quota.stats(),
      failureRate: this.quota.recentFailureRate()
    };
  }
}

const toRecentMessages = (request: MindRequest, now: number): RecentMessage[] =>
  request.recent.map((entry) => ({
    authorRole: entry.fromBot
      ? "bot"
      : entry.authorId === request.userId
        ? "current_user"
        : "other_user",
    text: entry.content,
    secondsAgo: Math.max(0, Math.round((now - entry.createdAt) / 1000)),
    fromBot: entry.fromBot
  }));
