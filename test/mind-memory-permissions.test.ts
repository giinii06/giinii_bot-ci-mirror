import { describe, expect, test } from "bun:test";
import { mindConfig } from "../src/mind/config.js";
import { handleSharedMemoryCommand } from "../src/mind/commands.js";
import { MindEngine } from "../src/mind/engine.js";
import { commitMemoryOperation } from "../src/mind/memory/operations.js";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import { BotUserRelationshipStore } from "../src/mind/relationship/store.js";
import type { MemoryDecision } from "../src/mind/types.js";
import {
  GUILD,
  OTHER,
  USER,
  actorOf,
  fakeCommandInteraction,
  memoryDecisionOf,
  mindDb,
  rootDb
} from "./mind-fixtures.js";

const commit = (
  store: MindMemoryStore,
  text: string,
  decision: Partial<MemoryDecision>,
  overrides: Partial<Parameters<typeof commitMemoryOperation>[2]> = {}
) =>
  commitMemoryOperation(
    store,
    new BotUserRelationshipStore(mindDb(), GUILD, { enabled: true, updateLimit: 0.03 }),
    {
      actor: actorOf(),
      messageId: "m1",
      channelId: "c1",
      text,
      decision: memoryDecisionOf(decision),
      referencedUsers: [],
      authorDisplayName: "영희",
      autoMemory: true,
      guildAutoNickname: true,
      guildApprovalRequired: false,
      ...overrides
    }
  );

const engine = () =>
  new MindEngine({
    guildId: GUILD,
    db: mindDb(),
    rootDb: rootDb(),
    apiKey: "",
    config: mindConfig
  });

describe("기억 권한", () => {
  test("다른 사람의 개인 기억은 저장할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "민지는 커피를 좋아해", {
      operation: "add",
      scope: "user",
      subjectUserId: OTHER,
      explicit: true
    });

    expect(result.status).toBe("blocked");
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
    const theirs = store.addPersonal({
      ownerUserId: USER,
      createdByUserId: USER,
      content: "민지는 커피를 좋아한다"
    });

    const result = commit(store, "그 기억 지워줘", {
      operation: "delete",
      scope: "user",
      targetMemoryId: theirs!.id
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("/memory delete");
    expect(store.byId(theirs!.id)).not.toBeNull();
  });

  test("공용 기억은 명시적 요청 없이 저장하지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "이 서버는 아침에 조용하다", {
      operation: "add",
      scope: "guild",
      category: "server_convention"
    });

    expect(result.status).toBe("none");
    expect(store.listGuild()).toEqual([]);
  });

  test("민감한 내용은 공용 기억으로 저장하지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);

    const result = commit(store, "내 병원 기록도 공용으로 저장해줘", {
      operation: "add",
      scope: "guild",
      category: "fact",
      explicit: true
    });

    expect(result.status).toBe("blocked");
    expect(store.listGuild()).toEqual([]);
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
      { actor: member, guildApprovalRequired: true }
    );

    expect(result.status).toBe("pending");
    expect(store.listGuild()).toEqual([]);
    expect(store.listPendingGuild()).toHaveLength(1);
  });
});

describe("관리자 공용 기억 명령", () => {
  test("관리자가 아니면 어떤 하위 명령도 실행하지 않는다", async () => {
    const mind = engine();
    const { interaction, replies } = fakeCommandInteraction({
      subcommand: "list",
      admin: false
    });

    await handleSharedMemoryCommand(interaction, mind);

    expect(replies).toEqual(["관리자만 사용할 수 있습니다."]);
  });

  test("관리자는 공용 기억을 추가하고 목록에서 본다", async () => {
    const mind = engine();
    const add = fakeCommandInteraction({
      subcommand: "add",
      admin: true,
      string: (name) => (name === "category" ? "server_convention" : "이 서버는 아침에 조용하다")
    });

    await handleSharedMemoryCommand(add.interaction, mind);
    expect(add.replies[0]).toContain("공용 기억 1번을 저장했어");

    const list = fakeCommandInteraction({ subcommand: "list", admin: true });
    await handleSharedMemoryCommand(list.interaction, mind);
    expect(list.replies[0]).toContain("이 서버는 아침에 조용하다");
  });

  test("관리자도 잘못된 별명은 저장하지 않는다", async () => {
    const mind = engine();
    const { interaction, replies } = fakeCommandInteraction({
      subcommand: "nickname",
      admin: true,
      user: () => ({ id: OTHER, displayName: "민지" }),
      string: () => "https://example.com"
    });

    await handleSharedMemoryCommand(interaction, mind);

    expect(replies[0]).toContain("링크나 멘션");
    expect(mind.listGuildMemories()).toEqual([]);
  });

  test("승인 대기 목록은 관리자만 볼 수 있다", async () => {
    const mind = engine();
    mind.memories.addGuild({
      createdByUserId: USER,
      category: "server_convention",
      subjectUserId: null,
      content: "대기 중인 규칙",
      approval: "pending",
      source: "natural_language"
    });

    const denied = fakeCommandInteraction({ subcommand: "pending", admin: false });
    await handleSharedMemoryCommand(denied.interaction, mind);
    expect(denied.replies[0]).toBe("관리자만 사용할 수 있습니다.");

    const allowed = fakeCommandInteraction({ subcommand: "pending", admin: true });
    await handleSharedMemoryCommand(allowed.interaction, mind);
    expect(allowed.replies[0]).toContain("대기 중인 규칙");
  });
});
