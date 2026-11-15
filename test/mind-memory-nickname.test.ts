import { describe, expect, test } from "bun:test";
import { extractMemory, factOf } from "../src/mind/memory/extractor.js";
import { commitMemoryOperation } from "../src/mind/memory/operations.js";
import { guildApprovalFor, validateNickname } from "../src/mind/memory/policy.js";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import { BotUserRelationshipStore } from "../src/mind/relationship/store.js";
import type { MemoryDecision } from "../src/mind/types.js";
import {
  GUILD,
  OTHER,
  USER,
  actorOf,
  memoryDecisionOf,
  mindDb
} from "./mind-fixtures.js";

const roster = [{ userId: OTHER, displayName: "민지", referenceType: "name" as const, confidence: 0.9 }];

const extract = (
  text: string,
  referencedUsers = roster,
  subjectUserId: string | null = USER
) =>
  extractMemory({
    text,
    category: "fact",
    subjectUserId,
    referencedUsers,
    authorId: USER,
    authorDisplayName: "영희"
  });

const setup = () => {
  const db = mindDb();
  const store = new MindMemoryStore(db, GUILD);
  const relationship = new BotUserRelationshipStore(db, GUILD, {
    enabled: true,
    updateLimit: 0.05
  });
  const commit = (
    text: string,
    decision: Partial<MemoryDecision>,
    overrides: Partial<Parameters<typeof commitMemoryOperation>[2]> = {}
  ) =>
    commitMemoryOperation(store, relationship, {
      actor: actorOf(),
      messageId: "m1",
      channelId: "c1",
      text,
      decision: memoryDecisionOf(decision),
      referencedUsers: roster,
      authorDisplayName: "영희",
      autoMemory: true,
      guildAutoNickname: true,
      guildApprovalRequired: false,
      ...overrides
    });
  return { db, store, relationship, commit };
};

describe("기억 추출", () => {
  test("별명 요청은 대상과 값을 구조화한다", () => {
    const extracted = extract("앞으로 민지를 천재라고 불러");

    expect(extracted).toMatchObject({
      category: "nickname",
      subjectUserId: OTHER,
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
        { userId: "100000000000000005", displayName: "민지", referenceType: "name", confidence: 0.9 }
      ],
      null
    );

    expect(extracted?.subjectUserId).toBeNull();
  });

  test("자기 자신을 가리키면 요청자로 정한다", () => {
    expect(extract("나를 왕이라고 불러")?.subjectUserId).toBe(USER);
  });

  test("일반 기억 요청은 요청 표현만 떼고 문장을 남긴다", () => {
    const extracted = extract("민지는 커피를 좋아해 기억해줘");

    expect(extracted?.category).toBe("fact");
    expect(extracted?.content).toBe("민지는 커피를 좋아해");
    expect(extracted?.isExplicit).toBe(true);
    expect(factOf("오늘 날씨가 좋다")).toBe("오늘 날씨가 좋다");
  });
});

describe("별명 정책", () => {
  test("빈 값·긴 값·링크·멘션·욕설을 막는다", () => {
    expect(validateNickname("  ").ok).toBe(false);
    expect(validateNickname("가".repeat(21)).ok).toBe(false);
    expect(validateNickname("https://example.com").ok).toBe(false);
    expect(validateNickname("@everyone").ok).toBe(false);
    expect(validateNickname("병신").ok).toBe(false);
  });

  test("따옴표를 떼고 20자까지 허용한다", () => {
    expect(validateNickname('"천재"')).toEqual({ ok: true, value: "천재" });
    expect(validateNickname("가".repeat(20)).ok).toBe(true);
  });

  test("승인 상태는 모델이 아니라 설정 표가 정한다", () => {
    const base = { isAdministrator: false, category: "server_convention" as const };

    expect(guildApprovalFor({ ...base, isAdministrator: true, autoNickname: false, approvalRequired: true })).toBe("active");
    expect(guildApprovalFor({ ...base, autoNickname: false, approvalRequired: false })).toBe("active");
    expect(guildApprovalFor({ ...base, autoNickname: false, approvalRequired: true })).toBe("pending");
    expect(
      guildApprovalFor({ ...base, category: "nickname", autoNickname: true, approvalRequired: true })
    ).toBe("active");
    expect(
      guildApprovalFor({ ...base, category: "nickname", autoNickname: false, approvalRequired: false })
    ).toBe("pending");
  });
});

describe("별명 저장과 거부", () => {
  test("자동 별명이 켜져 있으면 일반 사용자의 별명도 바로 적용된다", () => {
    const { store, commit } = setup();

    const result = commit("앞으로 민지를 천재라고 불러", {
      operation: "add",
      scope: "guild",
      category: "nickname",
      subjectUserId: OTHER,
      explicit: true
    });

    expect(result.status).toBe("success");
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("천재");
  });

  test("자동 별명이 꺼져 있으면 관리자 승인 대기로 남긴다", () => {
    const { store, commit } = setup();

    const result = commit(
      "앞으로 민지를 천재라고 불러",
      {
        operation: "add",
        scope: "guild",
        category: "nickname",
        subjectUserId: OTHER,
        explicit: true
      },
      { guildAutoNickname: false }
    );

    expect(result.status).toBe("pending");
    expect(store.findGuildNickname(OTHER)).toBeNull();
    expect(store.listPendingGuild()).toHaveLength(1);
  });

  test("일반 사용자가 기존 별명을 바꾸면 승인 대기로 남는다", () => {
    const { store, commit } = setup();
    commit("앞으로 민지를 천재라고 불러", {
      operation: "add",
      scope: "guild",
      category: "nickname",
      subjectUserId: OTHER,
      explicit: true
    });

    const result = commit("앞으로 민지를 바보라고 불러", {
      operation: "add",
      scope: "guild",
      category: "nickname",
      subjectUserId: OTHER,
      explicit: true
    });

    expect(result.status).toBe("pending");
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("천재");
  });

  test("관리자는 기존 별명을 바로 바꾼다", () => {
    const { store, commit } = setup();
    const admin = actorOf({ userId: "100000000000000003", isAdministrator: true });
    const decision: Partial<MemoryDecision> = {
      operation: "add",
      scope: "guild",
      category: "nickname",
      subjectUserId: OTHER,
      explicit: true
    };

    commit("앞으로 민지를 천재라고 불러", decision, { actor: admin });
    commit("앞으로 민지를 바보라고 불러", decision, { actor: admin });

    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("바보");
    expect(store.listGuild()).toHaveLength(1);
  });

  test("대상이 거부한 별명은 다시 붙지 않는다", () => {
    const { store, commit } = setup();
    const decision: Partial<MemoryDecision> = {
      operation: "add",
      scope: "guild",
      category: "nickname",
      subjectUserId: OTHER,
      explicit: true
    };
    commit("앞으로 민지를 천재라고 불러", decision);
    store.releaseGuildNickname(OTHER, OTHER);

    const again = commit("앞으로 민지를 천재라고 불러", decision);

    expect(again.status).toBe("blocked");
    expect(again.reason).toContain("거부");
    expect(store.findGuildNickname(OTHER)).toBeNull();
  });

  test("본인이 자연어로 자기 별명을 거부하면 경계로 남긴다", () => {
    const { store, relationship, commit } = setup();
    commit("앞으로 민지를 천재라고 불러", {
      operation: "add",
      scope: "guild",
      category: "nickname",
      subjectUserId: OTHER,
      explicit: true
    });

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

    expect(result.status).toBe("success");
    expect(result.removed).toEqual(['민지의 별명은 "천재"이다.']);
    expect(store.findGuildNickname(OTHER)).toBeNull();
    expect(relationship.load(OTHER).boundaries).toContain("그 별명은 부르지 마");
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
