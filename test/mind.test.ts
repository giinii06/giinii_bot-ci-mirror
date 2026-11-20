import { describe, expect, test } from "bun:test";
import { mindConfig } from "../src/mind/config.js";
import { CircuitBreaker } from "../src/mind/decision/circuit-breaker.js";
import { parseDecision } from "../src/mind/decision/parser.js";
import { DecisionQuota } from "../src/mind/decision/quota.js";
import { buildQuestions, renderState } from "../src/mind/decision/questions.js";
import { MindEngine } from "../src/mind/engine.js";
import { handleMemoryCommand } from "../src/mind/commands.js";
import { compileFrame } from "../src/mind/frame.js";
import { mentionsName, resolveReferencedUsers } from "../src/mind/identity-resolver.js";
import {
  commitMemoryOperation,
  describeMemoryResult,
  resolveMemoryScope
} from "../src/mind/memory/operations.js";
import { MindMemoryStore, selectMemories } from "../src/mind/memory/store.js";
import { BotUserRelationshipStore } from "../src/mind/relationship/store.js";
import type { MemoryDecision } from "../src/mind/types.js";
import {
  ADMIN,
  GUILD,
  OTHER,
  USER,
  actorOf,
  candidateOf,
  choice,
  contextOf,
  decisionOf,
  fakeTextCommandMessage,
  memoryRecordOf,
  mindDb,
  relationshipOf,
  requestOf,
  rootDb
} from "./mind-fixtures.js";

const relationshipStore = (db = mindDb()) =>
  new BotUserRelationshipStore(db, GUILD, { enabled: true, updateLimit: 0.03 });

const noResult = {
  status: "none" as const,
  added: [],
  updated: [],
  removed: [],
  reason: null
};

describe("Decision 질문과 state", () => {
  test("기억 범위·대상·유형 질문을 넣고 감정 질문은 넣지 않는다", () => {
    const questions = buildQuestions(contextOf());

    expect(questions.memory_scope?.type).toBe("choice");
    expect(questions.memory_category?.type).toBe("choice");
    expect(questions.memory_visibility?.type).toBe("choice");
    expect(questions.memory_subject?.type).toBe("choice");
    expect(questions.memory_worthiness?.type).toBe("noul");
    expect(questions.memory_involves_other_user?.type).toBe("noul");
    expect(questions.memory_write_intent?.type).toBe("noul");
    expect(questions.emotion_impact).toBeUndefined();
    expect(questions.emotion_intensity).toBeUndefined();
  });

  test("기억 후보가 있으면 후보별 관련성 질문과 대상 선택을 넣는다", () => {
    const context = contextOf({
      candidates: [candidateOf(101, "민지는 커피를 좋아한다")]
    });
    const questions = buildQuestions(context);

    expect(questions.memory_rel_101?.type).toBe("noul");
    expect(questions.memory_target?.type).toBe("choice");
    expect(Object.keys(questions.memory_target?.criteria ?? {})).toEqual([
      "none",
      "m101"
    ]);
  });

  test("언급된 사용자는 u1 같은 후보 키로만 질문에 넣는다", () => {
    const context = contextOf({
      request: requestOf({
        referencedUsers: [
          { userId: OTHER, displayName: "영희", referenceType: "mention", confidence: 1 }
        ]
      })
    });
    const questions = buildQuestions(context);

    expect(Object.keys(questions.memory_subject?.criteria ?? {})).toEqual([
      "none",
      "self",
      "server",
      "u1"
    ]);
  });

  test("state는 문자열이고 Discord ID를 담지 않는다", () => {
    const context = contextOf({
      candidates: [candidateOf(101, "민지는 커피를 좋아한다")],
      conventions: [
        memoryRecordOf({
          id: 5,
          scope: "guild",
          ownerUserId: null,
          subjectUserId: USER,
          category: "nickname",
          structuredValue: "천재",
          content: '민지의 별명은 "천재"이다.'
        })
      ]
    });
    const state = renderState(context);

    expect(typeof state).toBe("string");
    expect(state).toContain("[현재 메시지]");
    expect(state).toContain("민지는 커피를 좋아한다");
    expect(state).toContain("[적용 호칭]");
    expect(state).toContain("천재");
    expect(state).not.toContain(USER);
  });

  test("답장 대상이 봇인지 다른 사용자인지 구분한다", () => {
    const toBot = renderState(
      contextOf({ request: requestOf({ botWasReplyTarget: true }) })
    );
    const toOther = renderState(
      contextOf({
        request: requestOf({
          replyToAuthorId: OTHER,
          referencedUsers: [
            { userId: OTHER, displayName: "영희", referenceType: "reply", confidence: 0.9 }
          ]
        })
      })
    );

    expect(toBot).toContain("기니봇의 이전 발언에 답장");
    expect(toOther).toContain("영희의 메시지에 답장");
  });
});

describe("Decision 파싱", () => {
  test("범위·유형·공개 범위·대상·명시 여부를 읽는다", () => {
    const context = contextOf({
      request: requestOf({
        referencedUsers: [
          { userId: OTHER, displayName: "영희", referenceType: "mention", confidence: 1 }
        ]
      })
    });
    const { draft } = parseDecision(
      {
        memory_operation: choice("add"),
        memory_scope: choice("guild", 0.9, { guild: 0.9, user: 0.05 }),
        memory_category: choice("nickname"),
        memory_visibility: choice("shareable"),
        memory_subject: choice("u1"),
        memory_worthiness: { type: "noul", noul: 0.8, confidence: 0.8 },
        memory_involves_other_user: { type: "noul", noul: 0.9, confidence: 0.8 },
        memory_write_intent: { type: "noul", noul: 0.9, confidence: 0.9 }
      },
      context,
      { maxSelected: 5 }
    );

    expect(draft.memory.operation).toBe("add");
    expect(draft.memory.scope).toBe("guild");
    expect(draft.memory.category).toBe("nickname");
    expect(draft.memory.visibility).toBe("shareable");
    expect(draft.memory.subjectUserId).toBe(OTHER);
    expect(draft.memory.explicit).toBe(true);
    expect(draft.memory.memoryWorthiness).toBeCloseTo(0.8, 3);
    expect(draft.memory.involvesOtherUser).toBe(true);
  });

  test("답이 없으면 보수적인 기본값을 쓴다", () => {
    const { draft } = parseDecision({}, contextOf(), { maxSelected: 5 });
    expect(draft.action).toBe("acknowledge");
    expect(draft.goal).toBe("maintain_rapport");
    expect(draft.memory.operation).toBe("none");
    expect(draft.memory.scope).toBe("none");
    expect(draft.confidence).toBe(0);
  });

  test("후보에 없는 기억을 수정 대상으로 고르면 대상은 null", () => {
    const { draft, signals } = parseDecision(
      {
        memory_operation: choice("update"),
        memory_target: choice("m999")
      },
      contextOf({ candidates: [candidateOf(101, "민지는 커피를 좋아한다")] }),
      { maxSelected: 5 }
    );

    expect(draft.memory.targetMemoryId).toBeNull();
    expect(signals.memoryAmbiguous).toBe(true);
  });

  test("refusal 응답은 없는 답으로 취급한다", () => {
    const { draft } = parseDecision(
      { action: { type: "refusal" }, goal: { type: "refusal" } },
      contextOf(),
      { maxSelected: 5 }
    );
    expect(draft.action).toBe("acknowledge");
  });

  test("상황과 행동이 충돌하면 신호를 세운다", () => {
    const { signals } = parseDecision(
      {
        social_context: choice("conflict"),
        action: choice("tease_back")
      },
      contextOf(),
      { maxSelected: 5 }
    );
    expect(signals.conflicting).toBe(true);
  });

  test("범위 확률 차이가 작으면 정밀 판단 신호를 세운다", () => {
    const { signals } = parseDecision(
      {
        memory_operation: choice("add"),
        memory_scope: choice("user", 0.5, { user: 0.5, guild: 0.45 })
      },
      contextOf(),
      { maxSelected: 5 }
    );
    expect(signals.memoryScopeUncertain).toBe(true);
  });
});

describe("호출 예산", () => {
  test("분당 상한을 넘으면 예약하지 않는다", () => {
    const quota = new DecisionQuota(
      rootDb(),
      { dailyBudget: 100, minuteBudget: 1 },
      () => 1_000_000
    );
    expect(quota.reserve("t1", "m", "primary")).not.toBeNull();
    expect(quota.reserve("t2", "m", "primary")).toBeNull();
  });

  test("하루 상한을 넘으면 예약하지 않는다", () => {
    const quota = new DecisionQuota(
      rootDb(),
      { dailyBudget: 2, minuteBudget: 100 },
      () => 1_000_000
    );
    expect(quota.reserve("t1", "m", "primary")).not.toBeNull();
    expect(quota.reserve("t2", "m", "primary")).not.toBeNull();
    expect(quota.reserve("t3", "m", "primary")).toBeNull();
  });

  test("실패한 호출도 사용량에 남는다", () => {
    const quota = new DecisionQuota(
      rootDb(),
      { dailyBudget: 10, minuteBudget: 10 },
      () => 1_000_000
    );
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
  test("개인 기억을 저장하고 목록으로 다시 읽는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });

    expect(saved?.content).toBe("민지는 커피를 좋아한다");
    expect(saved?.scope).toBe("user");
    expect(saved?.subjectUserId).toBe(USER);
    expect(saved?.createdByUserId).toBe(USER);
    expect(store.listOwn(USER).map((memory) => memory.content)).toEqual([
      "민지는 커피를 좋아한다"
    ]);
  });

  test("같은 출처 메시지의 같은 내용은 한 번만 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const input = {
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다",
      sourceMessageId: "m1"
    };
    expect(store.addPersonal(input)).not.toBeNull();
    expect(store.addPersonal(input)).toBeNull();
  });

  test("소유자가 아니면 수정·삭제할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });
    if (!saved) throw new Error("저장 실패");

    expect(store.updatePersonal(saved.id, OTHER, "다른 내용")).toBeNull();
    expect(store.deletePersonal(saved.id, OTHER)).toBe(false);
    expect(store.byId(saved.id)?.content).toBe("민지는 커피를 좋아한다");
  });

  test("삭제한 기억은 검색에서도 사라진다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });
    if (!saved) throw new Error("저장 실패");

    expect(store.deletePersonal(saved.id, USER)).toBe(true);
    expect(store.byId(saved.id)).toBeNull();
    expect(store.searchOwn(USER, "커피", 10)).toHaveLength(0);
    expect(store.listOwn(USER)).toHaveLength(0);
  });

  test("전체 삭제는 1,000개 상한 없이 본인 기억만 지운다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    for (let index = 0; index < 1_005; index += 1) {
      store.addPersonal({
        ownerUserId: USER,
        createdByUserId: USER,
        content: `기억 ${index}`
      });
    }
    store.addPersonal({
      ownerUserId: OTHER,
      createdByUserId: OTHER,
      content: "다른 사람 기억"
    });

    expect(store.clearPersonal(USER)).toBe(1_005);
    expect(store.countOwn(USER)).toBe(0);
    expect(store.countOwn(OTHER)).toBe(1);
  });

  test("후보 선택은 고른 기억만 돌려준다", () => {
    const candidates = [candidateOf(1, "a"), candidateOf(2, "b"), candidateOf(3, "c")];
    expect(selectMemories(candidates, [3, 1]).map((memory) => memory.id)).toEqual([1, 3]);
    expect(selectMemories(candidates, [99])).toEqual([]);
  });
});

describe("명시적 기억 작업", () => {
  const commit = (
    store: MindMemoryStore,
    decision: MemoryDecision,
    text: string,
    options: { autoMemory?: boolean; actor?: Parameters<typeof actorOf>[0] } = {}
  ) =>
    commitMemoryOperation(store, {
      actor: actorOf(options.actor),
      messageId: "m1",
      channelId: "c1",
      text,
      decision,
      referencedUsers: [],
      ambiguousUserNames: [],
      authorDisplayName: "민지",
      autoMemory: options.autoMemory ?? true
    });

  test("명시적으로 기억해 달라고 하면 개인 기억으로 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const result = commit(
      store,
      {
        operation: "add",
        scope: "user",
        visibility: "private",
        category: "fact",
        subjectUserId: USER,
        targetMemoryId: null,
        confidence: 0.9,
        memoryWorthiness: 0.9,
        involvesOtherUser: false,
        explicit: true
      },
      "나 커피 안 마셔 기억해"
    );

    expect(result.status).toBe("success");
    expect(result.added).toEqual(["나 커피 안 마셔"]);
  });

  test("자동 저장이 꺼져 있으면 명시 요청만 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const auto = {
      operation: "add" as const,
      scope: "user" as const,
      visibility: "private" as const,
      category: "fact" as const,
      subjectUserId: USER,
      targetMemoryId: null,
      confidence: 0.7,
      memoryWorthiness: 0.7,
      involvesOtherUser: false,
      explicit: false
    };
    expect(commit(store, auto, "오늘 날씨 좋다", { autoMemory: false }).status).toBe(
      "none"
    );
    expect(
      commit(store, { ...auto, explicit: true }, "내 생일은 3월이야. 기억해", {
        autoMemory: false
      }).status
    ).toBe("success");
  });

  test("대상이 불분명한 수정은 아무것도 바꾸지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const result = commit(
      store,
      {
        operation: "update",
        scope: "user",
        visibility: "private",
        category: "fact",
        subjectUserId: USER,
        targetMemoryId: null,
        confidence: 0.5,
        memoryWorthiness: 0.5,
        involvesOtherUser: false,
        explicit: true
      },
      "고양이가 아니라 강아지야"
    );
    expect(result.status).toBe("needs_confirmation");
    expect(result.updated).toEqual([]);
  });

  test("자연어 삭제 요청은 본인 기억도 지우지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = store.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });
    if (!saved) throw new Error("저장 실패");

    const result = commit(
      store,
      {
        operation: "delete",
        scope: "user",
        visibility: "private",
        category: "fact",
        subjectUserId: USER,
        targetMemoryId: saved.id,
        confidence: 0.9,
        memoryWorthiness: 0.9,
        involvesOtherUser: false,
        explicit: true
      },
      "그 기억 지워"
    );
    expect(result.status).toBe("blocked");
    expect(result.removed).toEqual([]);
    expect(store.byId(saved.id)?.content).toBe("민지는 커피를 좋아한다");
  });

  test("차단된 삭제는 접두사 명령을 안내하게 만든다", () => {
    const text = describeMemoryResult({
      status: "blocked",
      added: [],
      updated: [],
      removed: [],
      reason:
        "자연어로는 기억을 삭제할 수 없습니다. /memory delete 슬래시 명령을 써야 합니다"
    });

    expect(text).toContain("바꾸지 않았다");
    expect(text).toContain("/memory delete");
  });
});

describe("관계 엔진", () => {
  test("관계 값은 저장하고 다시 읽을 수 있다", () => {
    const store = relationshipStore();
    store.save(
      relationshipOf({
        familiarity: 0.4,
        rapport: 0.7,
        playfulness: 0.5,
        interactionCount: 12,
        communicationStyle: "casual",
        lastInteractionAt: 5
      })
    );

    const loaded = store.load(USER);
    expect(loaded.communicationStyle).toBe("casual");
    expect(loaded.rapport).toBeCloseTo(0.7, 3);
    expect(loaded.interactionCount).toBe(12);
  });

  test("장난을 주고받으면 장난 선호와 라포가 오른다", () => {
    const store = relationshipStore();
    const next = store.applyInteraction(relationshipOf(), "playful", 0);

    expect(next.playfulness).toBeCloseTo(0.63, 3);
    expect(next.rapport).toBeCloseTo(0.609, 3);
    expect(next.interactionCount).toBe(11);
    expect(next.positiveInteractionCount).toBe(7);
  });

  test("경계 신호는 장난 선호를 낮추고 부정 피드백으로 센다", () => {
    const store = relationshipStore();
    const next = store.applyInteraction(relationshipOf(), "boundary_set", 0);

    expect(next.playfulness).toBeCloseTo(0.54, 3);
    expect(next.negativeFeedbackCount).toBe(2);
  });

  test("관계 기능이 꺼져 있어도 상호작용 횟수는 센다", () => {
    const store = new BotUserRelationshipStore(mindDb(), GUILD, {
      enabled: false,
      updateLimit: 0.03
    });
    const next = store.applyInteraction(relationshipOf(), "playful", 0);
    expect(next.interactionCount).toBe(11);
    expect(next.playfulness).toBe(0.6);
  });
});

describe("CharacterFrame 중재", () => {
  test("위로가 필요한 상황에서는 장난을 버린다", () => {
    const frame = compileFrame(
      contextOf(),
      decisionOf({ userNeeds: "comfort", action: "tease_back" }),
      noResult
    );

    expect(frame.action).toBe("comfort");
    expect(frame.style.humorLevel).toBe(0);
    expect(frame.constraints.join(" ")).toContain("놀리지 않는다");
  });

  test("갈등 상황에서는 받아치지 않는다", () => {
    const frame = compileFrame(
      contextOf(),
      decisionOf({ socialContext: "conflict", action: "tease_back" }),
      noResult
    );

    expect(frame.action).toBe("acknowledge");
  });

  test("장난 선호가 낮은 사용자에게는 장난치지 않는다", () => {
    const context = contextOf({ relationship: relationshipOf({ playfulness: 0.1 }) });
    const frame = compileFrame(context, decisionOf({ action: "light_banter" }), noResult);
    expect(frame.action).toBe("acknowledge");
  });

  test("저장에 성공한 기억은 그대로 Frame에 싣는다", () => {
    const frame = compileFrame(contextOf(), decisionOf(), {
      status: "success",
      added: ["서버 규칙"],
      updated: [],
      removed: [],
      reason: null
    });

    expect(frame.memoryStatus).toBe("success");
    expect(frame.constraints.join(" ")).not.toContain("저장했다고 말하지 않는다");
  });

  test("활성 공용 별명을 Frame에 따로 싣는다", () => {
    const context = contextOf({
      conventions: [
        memoryRecordOf({
          id: 7,
          scope: "guild",
          ownerUserId: null,
          subjectUserId: USER,
          category: "nickname",
          structuredValue: "천재",
          content: '민지의 별명은 "천재"이다.'
        })
      ]
    });

    const frame = compileFrame(context, decisionOf(), noResult);
    expect(frame.applicableNicknames).toEqual([{ userId: USER, nickname: "천재" }]);
    expect(frame.relationship.rapport).toBeCloseTo(0.6, 3);
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
    mind.memories.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });

    const context = mind.prepareContext(requestOf({ text: "나 누군지 기억해?" }));

    expect(context.candidates.map((item) => item.memory.content)).toContain(
      "민지는 커피를 좋아한다"
    );
  });

  test("API 키가 없으면 규칙 기반 폴백으로 판단한다", async () => {
    const mind = engine();
    const context = mind.prepareContext(requestOf());
    const decision = await mind.decide(context);

    expect(decision.source).toBe("local_fallback");
    expect(decision.action).toBe("light_banter");
  });

  test("폴백에서도 힘든 이야기에는 위로를 고른다", async () => {
    const mind = engine();
    const context = mind.prepareContext(
      requestOf({ text: "나 이번 시험 또 망한 것 같아" })
    );
    const decision = await mind.decide(context);

    expect(decision.action).toBe("comfort");
    expect(decision.goal).toBe("support_user");
  });

  test("폴백에서도 명시적 기억 요청은 저장한다", async () => {
    const mind = engine();
    const context = mind.prepareContext(
      requestOf({ text: "나 커피 안 마셔. 기억해" })
    );
    const decision = await mind.decide(context);
    const result = mind.commitMemoryOperation(context, decision);

    expect(decision.memory.operation).toBe("add");
    expect(result.status).toBe("success");
    expect(mind.listMemories(USER)).toHaveLength(1);
  });

  test("접두사 기억 삭제는 사용자 본인 기억만 지운다", async () => {
    const mind = engine();
    const saved = mind.memories.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });
    if (!saved) throw new Error("저장 실패");
    const { message, replies } = fakeTextCommandMessage();
    await handleMemoryCommand(message, mind, `delete ${saved.id}`);
    expect(mind.memories.byId(saved.id)).toBeNull();
    expect(replies[0]).toContain("삭제 완료");
  });

  test("같은 메시지는 관계를 두 번 갱신하지 않는다", async () => {
    const db = mindDb();
    const mind = engine(db);
    const context = mind.prepareContext(requestOf());
    const decision = decisionOf({ relationshipSignal: "playful" });

    mind.afterReply({
      context,
      decision,
      memoryResult: noResult,
      replyText: "그래요?",
      sentMessageId: "bot1"
    });
    mind.afterReply({
      context,
      decision,
      memoryResult: noResult,
      replyText: "그래요?",
      sentMessageId: "bot2"
    });

    const relationship = mind.relationship.load(USER);
    expect(relationship.playfulness).toBeCloseTo(0.33, 3);
    expect(relationship.interactionCount).toBe(1);
    expect(db.query("SELECT * FROM mind_events").all()).toHaveLength(1);
  });

  test("관리자 여부는 요청을 만든 쪽이 정하고 엔진은 그대로 쓴다", () => {
    const mind = engine();
    const context = mind.prepareContext(
      requestOf({ userId: ADMIN, displayName: "관리자", isAdministrator: true })
    );

    expect(context.request.isAdministrator).toBe(true);
    expect(actorOf({ userId: ADMIN, isAdministrator: true }).isAdministrator).toBe(true);
  });
});

describe("이름 언급 판정", () => {
  test("한국어 조사가 붙어도 이름으로 인식한다", () => {
    expect(mentionsName("빅시는 미국에 살아", "빅시")).toBe(true);
    expect(mentionsName("빅시가 게임을 잘해", "빅시")).toBe(true);
    expect(mentionsName("빅시랑 어제 놀았어", "빅시")).toBe(true);
    expect(mentionsName("빅시한테 물어봐", "빅시")).toBe(true);
    expect(mentionsName("빅시에게 선물했어", "빅시")).toBe(true);
  });

  test("단어 중간에 우연히 들어간 이름은 언급이 아니다", () => {
    expect(mentionsName("빅시티에 갔다", "빅시")).toBe(false);
    expect(mentionsName("민지는 커피를 좋아해", "지")).toBe(false);
  });

  test("같은 이름이 둘이면 사용자를 고르지 않고 이름만 남긴다", () => {
    const resolved = resolveReferencedUsers({
      authorId: USER,
      botId: "bot",
      text: "민지는 미국에 살아",
      mentions: [],
      replyTo: null,
      roster: [
        { userId: OTHER, displayName: "민지" },
        { userId: "100000000000000005", displayName: "민지" }
      ]
    });

    expect(resolved.users).toEqual([]);
    expect(resolved.ambiguousNames).toEqual(["민지"]);
  });

  test("조사가 붙은 여러 이름을 각각 사용자로 찾는다", () => {
    const resolved = resolveReferencedUsers({
      authorId: USER,
      botId: "bot",
      text: "빅시랑 철수는 친구야",
      mentions: [],
      replyTo: null,
      roster: [
        { userId: OTHER, displayName: "빅시" },
        { userId: "100000000000000005", displayName: "철수" }
      ]
    });

    expect(resolved.users.map((user) => user.userId).sort()).toEqual(
      [OTHER, "100000000000000005"].sort()
    );
    expect(resolved.ambiguousNames).toEqual([]);
  });
});

describe("저장 범위 확정", () => {
  test("타인이 조금이라도 관련되면 모델이 user를 골라도 공용이다", () => {
    expect(
      resolveMemoryScope({
        actorUserId: USER,
        relatedUserIds: [USER, OTHER],
        involvesOtherUser: false,
        modelScope: "user"
      })
    ).toBe("guild");
  });

  test("본인만 관련되면 모델의 공용 판단을 존중한다", () => {
    expect(
      resolveMemoryScope({
        actorUserId: USER,
        relatedUserIds: [USER],
        modelScope: "guild"
      })
    ).toBe("guild");
    expect(
      resolveMemoryScope({
        actorUserId: USER,
        relatedUserIds: [],
        modelScope: "user"
      })
    ).toBe("user");
  });

  test("확인된 사실은 모델이 none을 골라도 개인 기억으로 다시 읽는다", () => {
    expect(
      resolveMemoryScope({
        actorUserId: USER,
        relatedUserIds: [],
        involvesOtherUser: false,
        modelScope: "none"
      })
    ).toBe("user");
  });
});
