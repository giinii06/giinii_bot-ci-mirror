import type { Database } from "bun:sqlite";
import { DecisionClient, isTimeoutError } from "./decision/client.js";
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
import { MindStateStore } from "./state.js";
import type {
  CharacterFrame,
  CompletedTurn,
  MemoryOperationResult,
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
};

export type MindStatus = {
  enabled: boolean;
  model: string;
  breaker: string;
  usage: ReturnType<DecisionQuota["stats"]>;
  failureRate: number;
};

/**
 * 캐릭터 판단의 조율자. 바깥에서는 이 다섯 메서드만 알면 된다.
 * 실제 상태 변경은 모두 TypeScript가 검증한 뒤에만 일어난다.
 */
export class MindEngine {
  readonly state: MindStateStore;
  readonly memories: MindMemoryStore;
  private readonly quota: DecisionQuota;
  private readonly breaker: CircuitBreaker;
  private readonly client: DecisionClient | null;
  private readonly now: () => number;

  constructor(private readonly deps: MindEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.state = new MindStateStore(deps.db, deps.guildId, {
      emotionEnabled: deps.config.emotion.enabled,
      decayEnabled: deps.config.emotion.decay,
      halfLifeMinutes: deps.config.emotion.halfLifeMinutes,
      maxDelta: deps.config.emotion.maxDelta,
      relationshipEnabled: deps.config.relationship.enabled,
      updateLimit: deps.config.relationship.updateLimit
    });
    this.memories = new MindMemoryStore(deps.db, deps.guildId);
    this.quota = new DecisionQuota(deps.rootDb, {
      dailyBudget: deps.config.dailyBudget,
      minuteBudget: deps.config.minuteBudget
    }, this.now);
    this.breaker = new CircuitBreaker(3, 60_000, this.now);
    this.client = deps.apiKey
      ? new DecisionClient(deps.apiKey, deps.config.decisionApiUrl, deps.config.decisionModel)
      : null;
  }

  prepareContext(request: MindRequest): MindContext {
    const now = this.now();
    // "나 누군지 기억해?"처럼 본문에 이름이 없어도 발화자 이름으로 기억을 찾는다.
    const query = `${request.displayName} ${request.text}`;
    const candidates = this.deps.config.memory.enabled
      ? this.memories.candidates(request.userId, query, this.deps.config.memory.candidates)
      : [];

    return {
      request,
      state: this.state.loadEmotion(now),
      relationship: this.state.loadRelationship(request.userId, now),
      candidates,
      recent: toRecentMessages(request, now)
    };
  }

  async decide(context: MindContext): Promise<MindDecision> {
    const fallback = (): MindDecision => this.buildDecision(context, localDecision(context), "local_fallback", false);

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
        questions: buildQuestions(context.candidates),
        timeoutMs: this.deps.config.decisionTimeoutMs
      });

      const parsed = parseDecision(response.answers ?? {}, context.candidates, {
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
    const reservation = this.quota.reserve(context.request.messageId, this.deps.config.decisionModel, "refine");
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
      if (this.deps.config.debug) console.error("[mind] 정밀 판단 실패, 기본 판단을 쓴다", error);
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
    if (selected.length > 0) this.memories.markAccessed(selected.map((memory) => memory.id));

    return {
      intent: draft.intent,
      socialContext: draft.socialContext,
      emotionImpact: draft.emotionImpact,
      emotionIntensity: draft.emotionIntensity,
      relationshipSignal: draft.relationshipSignal,
      userNeeds: draft.userNeeds,
      goal: draft.goal,
      action: draft.action,
      humorStrategy: draft.humorStrategy,
      needsWeb: draft.needsWeb,
      memoryOperation: draft.memoryOperation,
      memoryTargetId: draft.memoryTargetId,
      selectedMemories: selected,
      confidence: draft.confidence,
      refined,
      source
    };
  }

  commitExplicitMemory(context: MindContext, decision: MindDecision): MemoryOperationResult {
    if (!this.deps.config.memory.enabled) {
      return { status: "none", added: [], updated: [], removed: [], reason: null };
    }

    return commitMemoryOperation(
      this.memories,
      {
        operation: decision.memoryOperation,
        targetId: decision.memoryTargetId,
        userId: context.request.userId,
        messageId: context.request.messageId,
        text: context.request.text
      },
      { autoMemory: this.deps.config.memory.autoMemory }
    );
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

    // prepareContext 시점의 스냅샷이 아니라 저장된 최신 값을 다시 읽는다.
    // 서로 다른 사용자의 턴이 겹쳐도 감정 변화가 덮어써지지 않는다.
    const nextState = this.state.applyEmotion(
      this.state.loadEmotion(now),
      decision.emotionImpact,
      decision.emotionIntensity,
      decision.goal,
      now
    );
    this.state.saveEmotion(nextState, now);

    const boundaryText =
      decision.relationshipSignal === "boundary_set" ? context.request.text : null;
    const nextRelationship = this.state.applyInteraction(
      this.state.loadRelationship(context.request.userId, now),
      decision.relationshipSignal,
      boundaryText,
      now
    );
    this.state.saveRelationship(context.request.userId, nextRelationship, now);

    try {
      this.deps.db
        .query(
          `INSERT OR IGNORE INTO mind_events
             (guild_id, user_id, message_id, intent, action, goal, emotion_delta, decision_source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this.deps.guildId,
          context.request.userId,
          context.request.messageId,
          decision.intent,
          decision.action,
          decision.goal,
          JSON.stringify({ impact: decision.emotionImpact, intensity: decision.emotionIntensity }),
          decision.source,
          now
        );
    } catch (error) {
      console.error("[mind] 사건 기록 실패", error);
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
  private recordFeedback(context: MindContext, decision: MindDecision, now: number): void {
    if (!this.deps.config.feedback || !context.request.replyToMessageId) return;
    const score =
      decision.relationshipSignal === "rejection" || decision.relationshipSignal === "boundary_set"
        ? -1
        : decision.relationshipSignal === "warm" || decision.relationshipSignal === "playful"
          ? 1
          : 0;

    this.deps.db
      .query(
        `UPDATE mind_feedback SET response_type = ?, feedback_score = ?, evaluated_at = ?
         WHERE guild_id = ? AND bot_message_id = ?`
      )
      .run(decision.relationshipSignal, score, now, this.deps.guildId, context.request.replyToMessageId);
  }

  listMemories(userId: string, limit = 25) {
    return this.memories.list(userId, limit);
  }

  sharedMemories(limit = 50) {
    return this.memories.guildMemories(limit);
  }

  clearMemories(userId: string): number {
    const removed = this.memories.clear(userId);
    this.state.resetRelationship(userId);
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
    authorRole: entry.fromBot ? "bot" : entry.authorId === request.userId ? "current_user" : "other_user",
    text: entry.content,
    secondsAgo: Math.max(0, Math.round((now - entry.createdAt) / 1000)),
    fromBot: entry.fromBot
  }));
