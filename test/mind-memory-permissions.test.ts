import { describe, expect, test } from "bun:test";
import { mindConfig } from "../src/mind/config.js";
import { handleSharedMemoryCommand } from "../src/mind/commands.js";
import { MindEngine } from "../src/mind/engine.js";
import { commitMemoryOperation } from "../src/mind/memory/operations.js";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import type { MemoryDecision } from "../src/mind/types.js";
import {
  GUILD,
  OTHER,
  OTHER_GUILD,
  USER,
  actorOf,
  fakeTextCommandMessage,
  memoryDecisionOf,
  mindDb,
  rootDb
} from "./mind-fixtures.js";

const roster = [
  { userId: OTHER, displayName: "민지", referenceType: "name" as const, confidence: 0.9 }
];

const commit = (
  store: MindMemoryStore,
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

const engine = () =>
  new MindEngine({
    guildId: GUILD,
    db: mindDb(),
    rootDb: rootDb(),
    apiKey: "",
    config: mindConfig
  });

describe("기억 권한", () => {
  test("타인 관련 기억은 Decision이 user를 골라도 공용으로 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "민지는 커피를 좋아해", {
      operation: "add",
      scope: "user",
      subjectUserId: OTHER,
      explicit: true
    });

    expect(result.status).toBe("success");
    expect(store.listGuild().map((memory) => memory.content)).toEqual([
      "민지는 커피를 좋아해"
    ]);
    expect(store.listOwn(USER)).toEqual([]);
  });

  test("다른 사람의 개인 기억은 수정할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const theirs = store.addPersonal({
      ownerUserId: OTHER,
      createdByUserId: OTHER,
      content: "민지는 커피를 좋아한다"
    });

    const result = commit(store, "민지는 차를 좋아해", {
      operation: "update",
      scope: "user",
      subjectUserId: OTHER,
      targetMemoryId: theirs!.id,
      explicit: true
    });

    expect(result.status).toBe("blocked");
    expect(store.byId(theirs!.id)?.content).toBe("민지는 커피를 좋아한다");
  });

  test("개인 기억 삭제는 자연어로 할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const mine = store.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });

    const result = commit(store, "그 기억 지워줘", {
      operation: "delete",
      scope: "user",
      targetMemoryId: mine!.id
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("!memory delete");
    expect(store.byId(mine!.id)).not.toBeNull();
  });

  test("타인 관련 기억은 명시적 요청 없이도 공용으로 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "민지는 미국에 살아", {
      operation: "none",
      scope: "none"
    });

    expect(result.status).toBe("success");
    expect(store.listGuild().map((memory) => memory.content)).toEqual([
      "민지는 미국에 살아"
    ]);
  });

  test("한 메시지의 개인 사실과 공용 사실을 각각 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "나는 커피를 좋아해. 민지는 미국에 살아", {
      operation: "add",
      scope: "user",
      subjectUserId: USER,
      explicit: true
    });

    expect(result.status).toBe("success");
    expect(store.listOwn(USER).map((memory) => memory.content)).toEqual([
      "나는 커피를 좋아해."
    ]);
    expect(store.listGuild().map((memory) => memory.content)).toEqual(["민지는 미국에 살아"]);
  });

  test("Decision이 none을 골라도 확인된 본인 사실은 개인 기억으로 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "나는 커피를 좋아해", {
      operation: "none",
      scope: "none"
    });

    expect(result.status).toBe("success");
    expect(store.listOwn(USER).map((memory) => memory.content)).toEqual(["나는 커피를 좋아해"]);
    expect(store.listGuild()).toEqual([]);
  });

  test("같은 메시지의 같은 사실은 한 번만 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const decision = { operation: "add" as const, scope: "guild" as const };

    const first = commit(store, "민지는 미국에 살아", decision);
    const second = commit(store, "민지는 미국에 살아", decision);

    expect(first.status).toBe("success");
    expect(second.status).toBe("none");
    expect(store.listGuild()).toHaveLength(1);
  });

  test("다른 서버의 공용 기억은 저장도 조회도 되지 않는다", () => {
    const db = mindDb();
    const here = new MindMemoryStore(db, GUILD);
    const elsewhere = new MindMemoryStore(db, OTHER_GUILD);

    commit(here, "민지는 미국에 살아", { operation: "add", scope: "guild" });

    expect(here.listGuild()).toHaveLength(1);
    expect(elsewhere.listGuild()).toEqual([]);
    expect(elsewhere.searchGuild("미국", 5)).toEqual([]);
  });

  test("관리자 여부는 요청자가 정하고 모델 답은 쓰지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const member = actorOf({ isAdministrator: false });

    const result = commit(
      store,
      "이 서버는 아침에 조용하다",
      {
        operation: "add",
        scope: "guild",
        category: "server_convention",
        explicit: true
      },
      { actor: member }
    );

    expect(result.status).toBe("success");
    expect(store.listGuild()).toHaveLength(1);
  });
});

describe("관리자 공용 기억 텍스트 명령", () => {
  test("관리자가 아니면 변경·조회 모두 막는다", async () => {
    const mind = engine();
    const { message, replies } = fakeTextCommandMessage({ admin: false });
    await handleSharedMemoryCommand(message, mind, "list");
    await handleSharedMemoryCommand(message, mind, "add fact 비밀");
    expect(replies).toEqual(["서버 관리자만 사용할 수 있습니다.", "서버 관리자만 사용할 수 있습니다."]);
    expect(mind.listGuildMemories()).toHaveLength(0);
  });

  test("관리자는 공용 기억을 추가하고 목록에서 본다", async () => {
    const mind = engine();
    const { message, replies } = fakeTextCommandMessage({ admin: true });
    await handleSharedMemoryCommand(message, mind, "add server_convention 이 서버는 아침에 조용하다");
    expect(replies[0]).toContain("공용 기억 1번 저장 완료");
    await handleSharedMemoryCommand(message, mind, "list");
    expect(replies[1]).toContain("이 서버는 아침에 조용하다");
  });

  test("관리자 별명에 들어간 링크는 안전한 일반 텍스트로 저장한다", async () => {
    const mind = engine();
    const { message, replies } = fakeTextCommandMessage({ admin: true });
    await handleSharedMemoryCommand(message, mind, `nickname <@${OTHER}> https://example.com`);
    expect(replies[0]).toContain("별명 설정 완료");
    expect(mind.listGuildMemories()[0]?.structuredValue).toBe("https://example.com");
  });
});
