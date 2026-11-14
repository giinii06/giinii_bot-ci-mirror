import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mindConfig } from "../src/mind/config.js";
import { CircuitBreaker } from "../src/mind/decision/circuit-breaker.js";
import { parseDecision } from "../src/mind/decision/parser.js";
import { DecisionQuota } from "../src/mind/decision/quota.js";
import { buildQuestions, renderState } from "../src/mind/decision/questions.js";
import { MindEngine } from "../src/mind/engine.js";
import { compileFrame } from "../src/mind/frame.js";
import { commitMemoryOperation } from "../src/mind/memory/operations.js";
import { migrateLegacyMemory } from "../src/mind/memory/migration.js";
import { MindMemoryStore, selectMemories } from "../src/mind/memory/store.js";
import { MIND_SCHEMA, ROOT_SCHEMA } from "../src/mind/schema.js";
import { DEFAULT_EMOTION, MindStateStore } from "../src/mind/state.js";
import type {
  CharacterFrame,
  MemoryCandidate,
  MindContext,
  MindDecision,
  MindRequest
} from "../src/mind/types.js";

const GUILD = "1111111111111111111";
const USER = "u1";

const mindDb = (): Database => {
  const db = new Database(":memory:");
  db.exec(MIND_SCHEMA);
  return db;
};

const rootDb = (): Database => {
  const db = new Database(":memory:");
  db.exec(ROOT_SCHEMA);
  return db;
};

const candidate = (id: number, content: string): MemoryCandidate => ({
  memory: {
    id,
    guildId: GUILD,
    ownerUserId: USER,
    scope: "user",
    kind: "semantic",
    content,
    confidence: 0.8,
    importance: 0.5,
    sourceMessageId: null,
    createdAt: 0,
    updatedAt: 0,
    lastAccessedAt: null,
    expiresAt: null,
    version: 1
  },
  score: 0.8,
  matched: true
});

const choice = (key: string, confidence = 0.8, probabilities?: Record<string, number>) => ({
  type: "choice" as const,
  choice: key,
  confidence,
  probabilities: probabilities ?? { [key]: confidence }
});

const contextOf = (overrides: Partial<MindContext> = {}): MindContext => {
  const request: MindRequest = {
    messageId: "m1",
    guildId: GUILD,
    channelId: "c1",
    userId: USER,
    displayName: "민지",
    text: "기니봇아 야이 멍청아",
    trigger: "prefix",
    createdAt: 10_000,
    recent: []
  };

  return {
    request,
    state: { ...DEFAULT_EMOTION, currentGoal: null, updatedAt: 0 },
    relationship: {
      familiarity: 0.5,
      trust: 0.6,
      playfulness: 0.6,
      interactionCount: 10,
      boundaries: [],
      lastInteractionAt: 0
    },
    candidates: [],
    recent: [],
    ...overrides
  };
};

const decisionOf = (overrides: Partial<MindDecision> = {}): MindDecision => ({
  intent: "friendly_banter",
  socialContext: "friendly_banter",
  emotionImpact: "positive",
  emotionIntensity: 0.5,
  relationshipSignal: "playful",
  userNeeds: "humor",
  goal: "maintain_rapport",
  action: "tease_back",
  humorStrategy: "light_tease",
  needsWeb: false,
  memoryOperation: "none",
  memoryTargetId: null,
  selectedMemories: [],
  confidence: 0.8,
  refined: false,
  source: "remote",
  ...overrides
});

describe("Decision 질문과 state", () => {
  test("기억 후보가 있으면 후보별 관련성 질문과 대상 선택을 넣는다", () => {
    const questions = buildQuestions([candidate(101, "민지는 커피를 좋아한다")]);
    expect(questions.memory_rel_101?.type).toBe("noul");
    expect(questions.memory_target?.type).toBe("choice");
    expect(Object.keys(questions.memory_target?.criteria ?? {})).toEqual(["none", "m101"]);
  });

  test("기억 후보가 없으면 대상 선택 질문을 만들지 않는다", () => {
    const questions = buildQuestions([]);
    expect(questions.memory_target).toBeUndefined();
  });

  test("state는 문자열이고 Discord ID를 담지 않는다", () => {
    const context = contextOf({ candidates: [candidate(101, "민지는 커피를 좋아한다")] });
    const state = renderState(context);

    expect(typeof state).toBe("string");
    expect(state).toContain("[현재 메시지]");
    expect(state).toContain("민지는 커피를 좋아한다");
    expect(state).not.toContain(USER);
  });
});

describe("Decision 파싱", () => {
  test("choice·noul·score를 읽어 판단으로 바꾼다", () => {
    const { draft, signals } = parseDecision(
      {
        intent: choice("friendly_banter"),
        social_context: choice("friendly_banter", 0.6, { friendly_banter: 0.6, conflict: 0.3 }),
        emotion_impact: choice("positive"),
        emotion_intensity: { type: "score", score: 4, probabilities: {}, confidence: 0.9 },
        relationship_signal: choice("playful"),
        user_needs: choice("humor"),
        goal: choice("entertain"),
        action: choice("tease_back", 0.9),
        humor_strategy: choice("light_tease"),
        needs_web: { type: "noul", noul: 0.9, confidence: 0.9 },
        memory_operation: choice("none"),
        memory_rel_101: { type: "noul", noul: 0.9, confidence: 0.9 },
        memory_rel_102: { type: "noul", noul: 0.2, confidence: 0.9 }
      },
      [candidate(101, "민지는 커피를 좋아한다"), candidate(102, "민지는 부산에 산다")],
      { maxSelected: 5 }
    );

    expect(draft.action).toBe("tease_back");
    expect(draft.goal).toBe("entertain");
    expect(draft.emotionIntensity).toBe(1);
    expect(draft.needsWeb).toBe(true);
    expect(draft.selectedMemoryIds).toEqual([101]);
    expect(draft.confidence).toBe(0.9);
    expect(signals.actionMargin).toBe(1);
  });

  test("답이 없으면 보수적인 기본값을 쓴다", () => {
    const { draft } = parseDecision({}, [], { maxSelected: 5 });
    expect(draft.action).toBe("acknowledge");
    expect(draft.goal).toBe("maintain_rapport");
    expect(draft.memoryOperation).toBe("none");
    expect(draft.confidence).toBe(0);
  });

  test("후보에 없는 기억을 수정 대상으로 고르면 대상은 null", () => {
    const { draft, signals } = parseDecision(
      {
        memory_operation: choice("update"),
        memory_target: choice("m999")
      },
      [candidate(101, "민지는 커피를 좋아한다")],
      { maxSelected: 5 }
    );

    expect(draft.memoryTargetId).toBeNull();
    expect(signals.memoryAmbiguous).toBe(true);
  });

  test("refusal 응답은 없는 답으로 취급한다", () => {
    const { draft } = parseDecision(
      { action: { type: "refusal" }, goal: { type: "refusal" } },
      [],
      { maxSelected: 5 }
    );
    expect(draft.action).toBe("acknowledge");
  });

  test("감정 판단과 행동이 충돌하면 신호를 세운다", () => {
    const { signals } = parseDecision(
      {
        emotion_impact: choice("negative"),
        emotion_intensity: { type: "score", score: 4, probabilities: {}, confidence: 1 },
        social_context: choice("conflict"),
        action: choice("tease_back")
      },
      [],
      { maxSelected: 5 }
    );
    expect(signals.conflicting).toBe(true);
  });
});

describe("호출 예산", () => {
  test("분당 상한을 넘으면 예약하지 않는다", () => {
    const quota = new DecisionQuota(rootDb(), { dailyBudget: 100, minuteBudget: 1 }, () => 1_000_000);
    expect(quota.reserve("t1", "m", "primary")).not.toBeNull();
    expect(quota.reserve("t2", "m", "primary")).toBeNull();
  });

  test("하루 상한을 넘으면 예약하지 않는다", () => {
    const quota = new DecisionQuota(rootDb(), { dailyBudget: 2, minuteBudget: 100 }, () => 1_000_000);
    expect(quota.reserve("t1", "m", "primary")).not.toBeNull();
    expect(quota.reserve("t2", "m", "primary")).not.toBeNull();
    expect(quota.reserve("t3", "m", "primary")).toBeNull();
  });

  test("실패한 호출도 사용량에 남는다", () => {
    const quota = new DecisionQuota(rootDb(), { dailyBudget: 10, minuteBudget: 10 }, () => 1_000_000);
    const reservation = quota.reserve("t1", "m", "primary");
    reservation?.settle("error", 120);
    expect(quota.stats().last24h).toBe(1);
    expect(quota.recentFailureRate()).toBe(1);
  });
});

describe("CircuitBreaker", () => {
  test("연속 실패하면 열리고, 시간이 지나면 한 번만 확인한다", () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 1_000, () => now);

    breaker.record(false);
    breaker.record(false);
    expect(breaker.allow()).toBe(true);
    breaker.record(false);

    expect(breaker.current()).toBe("open");
    expect(breaker.allow()).toBe(false);

    now += 1_001;
    expect(breaker.current()).toBe("half_open");
    expect(breaker.allow()).toBe(true);

    breaker.record(false);
    expect(breaker.current()).toBe("open");

    now += 1_001;
    breaker.record(true);
    expect(breaker.current()).toBe("closed");
  });
});

describe("기억 저장소", () => {
  test("저장하고 목록으로 다시 읽는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.add({ ownerUserId: USER, content: "민지는 커피를 좋아한다" });
    expect(saved?.content).toBe("민지는 커피를 좋아한다");
    expect(store.list(USER).map((memory) => memory.content)).toEqual(["민지는 커피를 좋아한다"]);
  });

  test("같은 출처 메시지의 같은 내용은 한 번만 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const input = { ownerUserId: USER, content: "민지는 커피를 좋아한다", sourceMessageId: "m1" };
    expect(store.add(input)).not.toBeNull();
    expect(store.add(input)).toBeNull();
  });

  test("다른 사람의 기억은 후보에 넣지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: "other", content: "다른 사람의 비밀" });
    store.add({ ownerUserId: USER, content: "민지는 커피를 좋아한다" });

    const candidates = store.candidates(USER, "커피", 10);
    expect(candidates.map((item) => item.memory.content)).toEqual(["민지는 커피를 좋아한다"]);
  });

  test("서버 공용 기억은 모든 사용자가 볼 수 있다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: null, scope: "guild", content: "이 서버는 아침에 조용하다" });

    expect(store.candidates(USER, "서버", 10)).toHaveLength(1);
  });

  test("서버 공용 기억은 검색과 무관하게 항상 꺼내 쓸 수 있다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: null, scope: "guild", content: "기니는 21살이다." });
    store.add({ ownerUserId: USER, content: "민지는 커피를 좋아한다" });

    expect(store.guildMemories().map((memory) => memory.content)).toEqual(["기니는 21살이다."]);
  });

  test("발화자 이름으로 기억을 찾는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: null, scope: "guild", content: "기니는 21살이다." });
    store.add({ ownerUserId: null, scope: "guild", content: "설하는 17살이다." });

    const candidates = store.candidates(USER, "기니 나 누군지 기억해?", 8);
    expect(candidates.map((item) => item.memory.content)).toContain("기니는 21살이다.");
    expect(store.candidates(USER, "나 누군지 기억해?", 8)).toHaveLength(0);
  });

  test("두 글자 한국어 단어로도 후보를 찾는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: USER, content: "민지는 시험 때문에 요즘 속상해한다" });

    const candidates = store.candidates(USER, "나 이번 시험 또 망한 것 같아", 8);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.matched).toBe(true);
  });

  test("관련 없는 기억은 후보로 보내지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: USER, content: "민지는 시험 때문에 요즘 속상해한다" });

    expect(store.candidates(USER, "오늘 점심 뭐 먹지", 8)).toHaveLength(0);
  });

  test("소유자가 아니면 수정·삭제할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.add({ ownerUserId: USER, content: "민지는 커피를 좋아한다" });
    if (!saved) throw new Error("저장 실패");

    expect(store.update(saved.id, "other", "다른 내용")).toBeNull();
    expect(store.remove(saved.id, "other")).toBe(false);
    expect(store.byId(saved.id)?.content).toBe("민지는 커피를 좋아한다");
  });

  test("삭제한 기억은 검색에서도 사라진다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.add({ ownerUserId: USER, content: "민지는 커피를 좋아한다" });
    if (!saved) throw new Error("저장 실패");

    expect(store.remove(saved.id, USER)).toBe(true);
    expect(store.byId(saved.id)).toBeNull();
    expect(store.candidates(USER, "커피", 10)).toHaveLength(0);
    expect(store.list(USER)).toHaveLength(0);
  });

  test("전체 삭제는 본인 기억만 지운다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    store.add({ ownerUserId: USER, content: "민지는 커피를 좋아한다" });
    store.add({ ownerUserId: USER, content: "민지는 부산에 산다" });
    store.add({ ownerUserId: "other", content: "다른 사람 기억" });

    expect(store.clear(USER)).toBe(2);
    expect(store.list(USER)).toHaveLength(0);
    expect(store.list("other")).toHaveLength(1);
  });

  test("후보 선택은 고른 기억만 돌려준다", () => {
    const candidates = [candidate(1, "a"), candidate(2, "b"), candidate(3, "c")];
    expect(selectMemories(candidates, [3, 1]).map((memory) => memory.id)).toEqual([1, 3]);
    expect(selectMemories(candidates, [99])).toEqual([]);
  });
});

describe("명시적 기억 작업", () => {
  const commit = (
    store: MindMemoryStore,
    input: { operation: Parameters<typeof commitMemoryOperation>[1]["operation"]; targetId: number | null; text: string; userId?: string },
    autoMemory = true
  ) =>
    commitMemoryOperation(
      store,
      {
        operation: input.operation,
        targetId: input.targetId,
        userId: input.userId ?? USER,
        messageId: "m1",
        text: input.text
      },
      { autoMemory }
    );

  test("명시적으로 기억해 달라고 하면 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const result = commit(store, { operation: "add", targetId: null, text: "나 커피 안 마셔. 기억해" });

    expect(result.status).toBe("success");
    expect(result.added).toEqual(["나 커피 안 마셔"]);
  });

  test("자동 저장이 꺼져 있으면 명시 요청만 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    expect(
      commit(store, { operation: "add", targetId: null, text: "오늘 날씨 좋다" }, false).status
    ).toBe("none");
    expect(
      commit(store, { operation: "add", targetId: null, text: "내 생일은 3월이야. 기억해" }, false).status
    ).toBe("success");
  });

  test("대상이 불분명한 수정은 아무것도 바꾸지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const result = commit(store, { operation: "update", targetId: null, text: "고양이가 아니라 강아지야" });
    expect(result.status).toBe("needs_confirmation");
    expect(result.updated).toEqual([]);
  });

  test("다른 사람 기억 삭제 요청은 실패로 끝난다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.add({ ownerUserId: "other", content: "다른 사람 기억" });
    if (!saved) throw new Error("저장 실패");

    const result = commit(store, { operation: "delete", targetId: saved.id, text: "그 기억 지워" });
    expect(result.status).toBe("failed");
    expect(store.byId(saved.id)?.content).toBe("다른 사람 기억");
  });
});

describe("감정과 관계", () => {
  const stateConfig = {
    emotionEnabled: true,
    decayEnabled: true,
    halfLifeMinutes: { valence: 30, arousal: 10, irritation: 20, curiosity: 60 },
    maxDelta: 0.25,
    relationshipEnabled: true,
    updateLimit: 0.03
  };

  test("시간이 지나면 기본 기분으로 돌아간다", () => {
    const db = mindDb();
    const store = new MindStateStore(db, GUILD, stateConfig);
    const start = 1_000_000;
    store.saveEmotion({ ...DEFAULT_EMOTION, valence: 1, currentGoal: null, updatedAt: start }, start);

    const halfLifeLater = store.loadEmotion(start + 30 * 60_000);
    expect(halfLifeLater.valence).toBeCloseTo(0.775, 3);

    const muchLater = store.loadEmotion(start + 30 * 60_000 * 10);
    expect(muchLater.valence).toBeCloseTo(DEFAULT_EMOTION.valence, 2);
  });

  test("한 사건의 감정 변화는 상한을 넘지 않는다", () => {
    const store = new MindStateStore(mindDb(), GUILD, stateConfig);
    const current = { ...DEFAULT_EMOTION, currentGoal: null, updatedAt: 0 };
    const next = store.applyEmotion(current, "negative", 1, "respect_boundary", 0);

    expect(next.valence).toBeCloseTo(DEFAULT_EMOTION.valence - 0.12, 3);
    expect(next.irritation).toBeCloseTo(DEFAULT_EMOTION.irritation + 0.14, 3);
  });

  test("명시적 경계는 즉시 저장하고 장난 선호를 낮춘다", () => {
    const store = new MindStateStore(mindDb(), GUILD, stateConfig);
    const before = {
      familiarity: 0.5,
      trust: 0.6,
      playfulness: 0.6,
      interactionCount: 10,
      boundaries: [],
      lastInteractionAt: 0
    };

    const after = store.applyInteraction(before, "boundary_set", "그런 농담 하지 마", 0);
    expect(after.playfulness).toBeCloseTo(0.54, 3);
    expect(after.boundaries).toEqual(["그런 농담 하지 마"]);
    expect(after.interactionCount).toBe(11);
  });

  test("관계 값은 저장하고 다시 읽을 수 있다", () => {
    const store = new MindStateStore(mindDb(), GUILD, stateConfig);
    store.saveRelationship(USER, {
      familiarity: 0.4,
      trust: 0.7,
      playfulness: 0.5,
      interactionCount: 12,
      boundaries: ["욕설 금지"],
      lastInteractionAt: 5
    });

    const loaded = store.loadRelationship(USER);
    expect(loaded.boundaries).toEqual(["욕설 금지"]);
    expect(loaded.trust).toBeCloseTo(0.7, 3);
  });
});

describe("CharacterFrame 중재", () => {
  const memoryResult = {
    status: "none" as const,
    added: [],
    updated: [],
    removed: [],
    reason: null
  };

  test("위로가 필요한 상황에서는 장난을 버린다", () => {
    const frame = compileFrame(
      contextOf(),
      decisionOf({ userNeeds: "comfort", action: "tease_back" }),
      memoryResult
    );

    expect(frame.action).toBe("comfort");
    expect(frame.style.humorLevel).toBe(0);
    expect(frame.constraints.join(" ")).toContain("놀리지 않는다");
  });

  test("갈등 상황에서는 받아치지 않는다", () => {
    const frame = compileFrame(
      contextOf(),
      decisionOf({ socialContext: "conflict", action: "tease_back" }),
      memoryResult
    );

    expect(frame.action).toBe("acknowledge");
  });

  test("장난 선호가 낮은 사용자에게는 장난치지 않는다", () => {
    const context = contextOf({
      relationship: {
        familiarity: 0.1,
        trust: 0.5,
        playfulness: 0.1,
        interactionCount: 1,
        boundaries: [],
        lastInteractionAt: 0
      }
    });

    const frame = compileFrame(context, decisionOf({ action: "light_banter" }), memoryResult);
    expect(frame.action).toBe("acknowledge");
  });

  test("확인이 필요한 기억 작업은 되묻도록 제약을 건다", () => {
    const frame = compileFrame(contextOf(), decisionOf(), {
      status: "needs_confirmation",
      added: [],
      updated: [],
      removed: [],
      reason: "대상이 불분명하다"
    });

    expect(frame.memoryStatus).toBe("needs_confirmation");
    expect(frame.constraints.join(" ")).toContain("되묻는다");
  });
});

describe("레거시 기억 이전", () => {
  test("memory.md를 서버 공용 기억으로 한 번만 옮긴다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-migrate-"));
    const db = mindDb();
    const store = new MindMemoryStore(db, GUILD);
    const path = join(dir, "memory.md");

    try {
      await writeFile(path, "# 기니봇 메모리\n\n- 민지는 부산에 산다.\n- 민지는 고양이를 키운다.\n", "utf8");

      expect(await migrateLegacyMemory(store, db, GUILD, path)).toBe(2);
      expect(store.candidates(USER, "부산", 10)).toHaveLength(1);
      expect(await migrateLegacyMemory(store, db, GUILD, path)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("파일이 없으면 조용히 넘어간다", async () => {
    const db = mindDb();
    const store = new MindMemoryStore(db, GUILD);
    expect(await migrateLegacyMemory(store, db, GUILD, "does-not-exist/memory.md")).toBe(0);
  });
});

describe("MindEngine", () => {
  const engine = (db = mindDb()) =>
    new MindEngine({
      guildId: GUILD,
      db,
      rootDb: rootDb(),
      apiKey: "",
      config: mindConfig
    });

  test("본문에 이름이 없어도 발화자 이름으로 기억 후보를 찾는다", () => {
    const mind = engine();
    mind.memories.add({
      ownerUserId: null,
      scope: "guild",
      kind: "semantic",
      content: "기니는 21살이다."
    });

    const context = mind.prepareContext({
      ...contextOf().request,
      displayName: "기니 (@giinii06)",
      text: "나 누군지 기억해?"
    });

    expect(context.candidates.map((item) => item.memory.content)).toContain("기니는 21살이다.");
    expect(mind.sharedMemories().map((memory) => memory.content)).toContain("기니는 21살이다.");
  });

  test("API 키가 없으면 규칙 기반 폴백으로 판단한다", async () => {
    const mind = engine();
    const context = mind.prepareContext(contextOf().request);
    const decision = await mind.decide(context);

    expect(decision.source).toBe("local_fallback");
    expect(decision.action).toBe("light_banter");
  });

  test("폴백에서도 힘든 이야기에는 위로를 고른다", async () => {
    const mind = engine();
    const request = { ...contextOf().request, text: "나 이번 시험 또 망한 것 같아" };
    const context = mind.prepareContext(request);
    const decision = await mind.decide(context);

    expect(decision.action).toBe("comfort");
    expect(decision.goal).toBe("support_user");
  });

  test("폴백에서도 명시적 기억 요청은 저장한다", async () => {
    const mind = engine();
    const request = { ...contextOf().request, text: "나 커피 안 마셔. 기억해" };
    const context = mind.prepareContext(request);
    const decision = await mind.decide(context);
    const result = mind.commitExplicitMemory(context, decision);

    expect(decision.memoryOperation).toBe("add");
    expect(result.status).toBe("success");
    expect(mind.listMemories(USER)).toHaveLength(1);
  });

  test("답변 후 감정과 사건을 기록한다", async () => {
    const db = mindDb();
    const mind = engine(db);
    const context = mind.prepareContext(contextOf().request);
    const decision = await mind.decide(context);

    mind.afterReply({
      context,
      decision,
      memoryResult: { status: "none", added: [], updated: [], removed: [], reason: null },
      replyText: "그래요?",
      sentMessageId: "bot1"
    });

    const events = db.query("SELECT * FROM mind_events").all();
    expect(events).toHaveLength(1);

    const state = mind.state.loadEmotion();
    expect(state.currentGoal).toBe(decision.goal);
  });

  test("같은 메시지는 사건으로 두 번 남지 않는다", async () => {
    const db = mindDb();
    const mind = engine(db);
    const context = mind.prepareContext(contextOf().request);
    const decision = await mind.decide(context);
    const memoryResult = { status: "none" as const, added: [], updated: [], removed: [], reason: null };

    mind.afterReply({ context, decision, memoryResult, replyText: "a", sentMessageId: "b1" });
    mind.afterReply({ context, decision, memoryResult, replyText: "a", sentMessageId: "b2" });

    expect(db.query("SELECT * FROM mind_events").all()).toHaveLength(1);
  });
});
