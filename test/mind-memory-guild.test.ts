import { describe, expect, test } from "bun:test";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import { GUILD, OTHER, OTHER_GUILD, USER, actorOf, mindDb } from "./mind-fixtures.js";

const admin = actorOf({ userId: "100000000000000003", isAdministrator: true, source: "slash_command" });
const member = actorOf({ isAdministrator: false, source: "discord_message" });

const guildMemory = (
  store: MindMemoryStore,
  content: string,
  overrides: Partial<Parameters<MindMemoryStore["addGuild"]>[0]> = {}
) =>
  store.addGuild({
    createdByUserId: admin.userId,
    category: "server_convention",
    subjectUserId: null,
    content,
    source: "slash_command",
    ...overrides
  });

describe("공용 기억 저장소", () => {
  test("저장하면 목록에 나오고 감사 로그가 남는다", () => {
    const db = mindDb();
    const store = new MindMemoryStore(db, GUILD);

    const saved = guildMemory(store, "이 서버는 아침에 조용하다");

    expect(saved?.scope).toBe("guild");
    expect(saved?.visibility).toBe("shareable");
    expect(store.listGuild().map((memory) => memory.content)).toEqual([
      "이 서버는 아침에 조용하다"
    ]);

    const audit = db
      .query<{ action: string; actor_user_id: string; source: string }, []>(
        "SELECT action, actor_user_id, source FROM mind_memory_audit"
      )
      .all();
    expect(audit).toEqual([
      { action: "ADD", actor_user_id: admin.userId, source: "slash_command" }
    ]);
  });

  test("관리자가 아니면 수정·삭제·승인·거절을 할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = guildMemory(store, "서버 규칙");
    const pending = guildMemory(store, "대기 중인 규칙", { approval: "pending" });

    expect(saved).not.toBeNull();
    expect(store.updateGuild(saved!.id, member, { content: "바꾼 규칙" })).toBeNull();
    expect(store.deleteGuild(saved!.id, member)).toBe(false);
    expect(store.approveGuild(pending!.id, member)).toBeNull();
    expect(store.rejectGuild(pending!.id, member)).toBeNull();
    expect(store.byId(saved!.id)?.content).toBe("서버 규칙");
  });

  test("승인 대기 기억은 활성 목록에 없고 대기 목록에만 있다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    guildMemory(store, "활성 규칙");
    guildMemory(store, "대기 규칙", { approval: "pending" });

    expect(store.listGuild().map((memory) => memory.content)).toEqual(["활성 규칙"]);
    expect(store.listPendingGuild().map((memory) => memory.content)).toEqual(["대기 규칙"]);
  });

  test("승인하면 활성 목록으로 옮겨가고 감사 로그가 남는다", () => {
    const db = mindDb();
    const store = new MindMemoryStore(db, GUILD);
    const pending = guildMemory(store, "대기 규칙", { approval: "pending" });

    const approved = store.approveGuild(pending!.id, admin);

    expect(approved?.approval).toBe("active");
    expect(store.listGuild().map((memory) => memory.content)).toEqual(["대기 규칙"]);
    expect(store.listPendingGuild()).toEqual([]);
    const actions = db
      .query<{ action: string }, []>("SELECT action FROM mind_memory_audit ORDER BY audit_id")
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(["ADD", "APPROVE"]);
  });

  test("새 별명을 승인하면 같은 대상의 기존 별명은 거절된다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const first = guildMemory(store, "민지의 별명은 \"천재\"이다.", {
      category: "nickname",
      subjectUserId: USER,
      structuredValue: "천재"
    });
    const second = guildMemory(store, "민지의 별명은 \"바보\"이다.", {
      category: "nickname",
      subjectUserId: USER,
      structuredValue: "바보",
      approval: "pending"
    });

    expect(store.approveGuild(second!.id, admin)?.structuredValue).toBe("바보");
    expect(store.byId(first!.id)?.approval).toBe("rejected");
    expect(store.findGuildNickname(USER)?.structuredValue).toBe("바보");
  });

  test("거절하면 대기 목록에서 빠지고 활성 목록에 들어가지 않는다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const pending = guildMemory(store, "대기 규칙", { approval: "pending" });

    const rejected = store.rejectGuild(pending!.id, admin);

    expect(rejected?.approval).toBe("rejected");
    expect(store.listPendingGuild()).toEqual([]);
    expect(store.listGuild()).toEqual([]);
  });

  test("삭제는 표시만 남기고 목록과 검색에서 뺀다", () => {
    const db = mindDb();
    const store = new MindMemoryStore(db, GUILD);
    const saved = guildMemory(store, "이 서버는 아침에 조용하다");

    expect(store.deleteGuild(saved!.id, admin)).toBe(true);

    expect(store.listGuild()).toEqual([]);
    expect(store.byId(saved!.id)).toBeNull();
    expect(store.searchGuild("아침에 조용하다", 5)).toEqual([]);
    const row = db
      .query<{ deleted_at: number | null }, [number]>(
        "SELECT deleted_at FROM mind_memories WHERE id = ?"
      )
      .get(saved!.id);
    expect(row?.deleted_at).not.toBeNull();
  });

  test("다른 서버의 공용 기억은 보이지 않는다", () => {
    const db = mindDb();
    const here = new MindMemoryStore(db, GUILD);
    const elsewhere = new MindMemoryStore(db, OTHER_GUILD);
    guildMemory(here, "이 서버 규칙");
    guildMemory(elsewhere, "저 서버 규칙");

    expect(here.listGuild().map((memory) => memory.content)).toEqual(["이 서버 규칙"]);
    expect(elsewhere.listGuild().map((memory) => memory.content)).toEqual(["저 서버 규칙"]);
  });

  test("같은 출처 메시지의 같은 내용은 한 번만 저장한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const input = { sourceMessageId: "m1" };

    expect(guildMemory(store, "서버 규칙", input)).not.toBeNull();
    expect(guildMemory(store, "서버 규칙", input)).toBeNull();
    expect(store.listGuild()).toHaveLength(1);
  });
});
