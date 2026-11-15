import { describe, expect, test } from "bun:test";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import { GUILD, OTHER, OTHER_GUILD, USER, actorOf, mindDb } from "./mind-fixtures.js";

const admin = actorOf({
  userId: "100000000000000003",
  isAdministrator: true,
  source: "slash_command"
});
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

  test("관리자가 아니면 수정·삭제를 할 수 없다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const saved = guildMemory(store, "서버 규칙");

    expect(saved).not.toBeNull();
    expect(store.updateGuild(saved!.id, member, { content: "바꾼 규칙" })).toBeNull();
    expect(store.deleteGuild(saved!.id, member)).toBe(false);
    expect(store.byId(saved!.id)?.content).toBe("서버 규칙");
  });

  test("공용 기억은 승인 없이 저장 즉시 활성화된다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    guildMemory(store, "바로 쓰는 규칙");

    expect(store.listGuild().map((memory) => memory.content)).toEqual(["바로 쓰는 규칙"]);
  });

  test("같은 대상의 별명을 교체하면 행 하나만 남는다", () => {
    const db = mindDb();
    const store = new MindMemoryStore(db, GUILD);
    const first = store.replaceGuildNickname({
      subjectUserId: OTHER,
      nickname: "천재",
      content: '민지의 별명은 "천재"이다.',
      actorUserId: admin.userId,
      source: "slash_command"
    });
    const second = store.replaceGuildNickname({
      subjectUserId: OTHER,
      nickname: "바보",
      content: '민지의 별명은 "바보"이다.',
      actorUserId: admin.userId,
      source: "slash_command"
    });

    expect(second?.id).toBe(first?.id);
    expect(store.findGuildNickname(OTHER)?.structuredValue).toBe("바보");
    expect(store.listGuild()).toHaveLength(1);
    const actions = db
      .query<{ action: string }, []>("SELECT action FROM mind_memory_audit ORDER BY audit_id")
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(["ADD", "UPDATE"]);
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

  test("여러 사용자가 등장하는 기억은 모두 색인한다", () => {
    const store = new MindMemoryStore(mindDb(), GUILD);
    const other = "100000000000000005";
    const saved = store.addGuild({
      createdByUserId: USER,
      category: "fact",
      subjectUserId: OTHER,
      relatedUserIds: [OTHER, other],
      content: "철수랑 빅시는 친구야",
      source: "natural_language"
    });

    expect(store.subjectIdsOf(saved!.id)).toEqual([OTHER, other].sort());
    expect(store.searchGuild("친구", 5).map((hit) => hit.memory.id)).toEqual([saved!.id]);
  });
});
