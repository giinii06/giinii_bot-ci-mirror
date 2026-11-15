import { describe, expect, test } from "bun:test";
import { extractMemory, factOf } from "../src/mind/memory/extractor.js";
import { commitMemoryOperation } from "../src/mind/memory/operations.js";
import { validateNickname } from "../src/mind/memory/policy.js";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import type { MemoryDecision } from "../src/mind/types.js";
import {
  GUILD,
  OTHER,
  USER,
  actorOf,
  memoryDecisionOf,
  mindDb
} from "./mind-fixtures.js";

const roster = [
  { userId: OTHER, displayName: "민지", referenceType: "name" as const, confidence: 0.9 }
];

const extract = (
  text: string,
  referencedUsers = roster,
  subjectUserId: string | null = USER,
  ambiguousUserNames: string[] = []
) =>
  extractMemory({
    text,
    category: "fact",
    subjectUserId,
    referencedUsers,
    ambiguousUserNames,
    authorId: USER,
    authorDisplayName: "영희"
  })[0];

const setup = () => {
  const db = mindDb();
  const store = new MindMemoryStore(db, GUILD);
  const commit = (
    text: string,
    decision: Partial<MemoryDecision>,
    overrides: Partial<Parameters<typeof commitMemoryOperation>[1]> = {}
  ) =>
    commitMemoryOperation(store, {
      actor: actorOf(),
      messageId: "m1",
      channelId: "c1",
      text,
      decision: memoryDecisionOf(decision),
      referencedUsers: roster,
      ambiguousUserNames: [],
      authorDisplayName: "영희",
      autoMemory: true,
      ...overrides
    });
  return { db, store, commit };
};

describe("기억 추출", () => {
  test("별명 요청은 대상과 값을 구조화한다", () => {
    const extracted = extract("앞으로 민지를 천재라고 불러");

    expect(extracted).toMatchObject({
      category: "nickname",
      primarySubjectId: OTHER,
      structuredValue: "천재",
      isExplicit: true
    });
    expect(extracted?.content).toBe('민지의 별명은 "천재"이다.');
  });

  test("같은 이름이 둘이면 대상을 특정하지 않는다", () => {
    const extracted = extract(
      "앞으로 민지를 천재라고 불러",
      [
        { userId: OTHER, displayName: "민지", referenceType: "name", confidence: 0.9 },
        {
          userId: "100000000000000005",
          displayName: "민지",
          referenceType: "name",
          confidence: 0.9
        }
      ],
      null,
      ["민지"]
    );

    expect(extracted?.primarySubjectId).toBeNull();
    expect(extracted?.involvesOtherUser).toBe(true);
  });

  test("자기 자신을 가리키면 요청자로 정한다", () => {
    expect(extract("나를 왕이라고 불러")?.primarySubjectId).toBe(USER);
  });

  test("일반 기억 요청은 요청 표현만 떼고 문장을 남긴다", () => {
    const extracted = extract("민지는 커피를 좋아해 기억해줘");

    expect(extracted?.category).toBe("fact");
    expect(extracted?.content).toBe("민지는 커피를 좋아해");
    expect(extracted?.isExplicit).toBe(true);
    expect(factOf("오늘 날씨가 좋다")).toBe("오늘 날씨가 좋다");
  });

  test("한 메시지의 개인 사실과 타인 사실을 따로 뽑는다", () => {
    const facts = extractMemory({
      text: "나는 커피를 좋아해. 민지는 미국에 살아",
      category: "fact",
      subjectUserId: USER,
      referencedUsers: roster,
      authorId: USER,
      authorDisplayName: "영희"
    });

    expect(facts.map((fact) => fact.content)).toEqual([
      "나는 커피를 좋아해.",
      "민지는 미국에 살아"
    ]);
    expect(facts.map((fact) => fact.involvesOtherUser)).toEqual([false, true]);
  });
});

describe("별명 정책", () => {
  test("빈 값과 긴 값만 막는다", () => {
    expect(validateNickname("  ").ok).toBe(false);
    expect(validateNickname("가".repeat(21)).ok).toBe(false);
  });

  test("링크와 멘션 문자열은 일반 텍스트로 저장한다", () => {
    expect(validateNickname("https://example.com")).toEqual({
      ok: true,
      value: "https://example.com"
    });
    expect(validateNickname("@everyone")).toEqual({ ok: true, value: "@everyone" });
  });

  test("따옴표를 떼고 20자까지 허용한다", () => {
    expect(validateNickname('"천재"')).toEqual({ ok: true, value: "천재" });
    expect(validateNickname("가".repeat(20)).ok).toBe(true);
  });
});

describe("별명 저장과 교체", () => {
  const nicknameDecision: Partial<MemoryDecision> = {
    operation: "add",
    scope: "guild",
    category: "nickname",
    subjectUserId: OTHER,
    explicit: true
  };

  test("일반 사용자의 별명 요청도 바로 적용된다", () => {
    const { store, commit } = setup();

    const result = commit("앞으로 민지를 천재라고 불러", nicknameDecision);

    expect(result.status).toBe("success");
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("천재");
  });

  test("기존 별명이 있으면 일반 사용자도 즉시 교체한다", () => {
    const { store, commit } = setup();
    commit("앞으로 민지를 천재라고 불러", nicknameDecision);

    const result = commit("앞으로 민지를 바보라고 불러", nicknameDecision);

    expect(result.status).toBe("success");
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("바보");
    expect(store.listGuild()).toHaveLength(1);
  });

  test("관리자도 같은 교체 서비스를 쓴다", () => {
    const { store, commit } = setup();
    const admin = actorOf({ userId: "100000000000000003", isAdministrator: true });

    commit("앞으로 민지를 천재라고 불러", nicknameDecision, { actor: admin });
    commit("앞으로 민지를 바보라고 불러", nicknameDecision, { actor: admin });

    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("바보");
    expect(store.listGuild()).toHaveLength(1);
  });

  test("삭제된 과거 별명은 새 별명 저장을 막지 않는다", () => {
    const { store, commit } = setup();
    const saved = commit("앞으로 민지를 천재라고 불러", nicknameDecision);
    expect(saved.status).toBe("success");

    const active = store.findGuildNickname(OTHER);
    if (!active) throw new Error("별명 저장 실패");
    store.deleteGuild(active.id, actorOf({ isAdministrator: true }));

    const again = commit("앞으로 민지를 천재라고 불러", nicknameDecision, {
      messageId: "m2"
    });
    expect(again.status).toBe("success");
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("천재");
  });

  test("본인이 자연어로 별명을 거부해도 별명은 그대로다", () => {
    const { store, commit } = setup();
    commit("앞으로 민지를 천재라고 불러", nicknameDecision);

    const result = commit(
      "그 별명은 부르지 마",
      {
        operation: "delete",
        scope: "guild",
        category: "nickname",
        subjectUserId: OTHER
      },
      { actor: actorOf({ userId: OTHER }) }
    );

    expect(result.status).toBe("blocked");
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("천재");
  });

  test("공용 기억 삭제는 자연어로 할 수 없다", () => {
    const { commit } = setup();

    const result = commit("아침 규칙 지워줘", {
      operation: "delete",
      scope: "guild",
      category: "server_convention"
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("/shared-memory delete");
  });
});
