import { describe, expect, test } from "bun:test";
import { MindMemoryStore } from "../src/mind/memory/store.js";
import { GUILD, OTHER, USER, mindDb } from "./mind-fixtures.js";

const storeOf = () => new MindMemoryStore(mindDb(), GUILD);

const personal = (
  store: MindMemoryStore,
  ownerUserId: string,
  content: string,
  overrides: { visibility?: "private" | "shareable" } = {}
) =>
  store.addPersonal({
    ownerUserId,
    createdByUserId: ownerUserId,
    content,
    ...overrides
  });

describe("개인 기억 공유 범위", () => {
  test("다른 사람의 비공개 기억은 검색되지 않는다", () => {
    const store = storeOf();
    personal(store, OTHER, "영희는 커피를 좋아한다");

    expect(store.searchOtherShareable([OTHER], "커피", 10)).toEqual([]);
  });

  test("공유 가능으로 바꾼 기억만 다른 사람 검색에 나온다", () => {
    const store = storeOf();
    const hidden = personal(store, OTHER, "영희는 커피를 좋아한다");
    const shared = personal(store, OTHER, "영희는 커피를 싫어한다");

    expect(store.setPersonalVisibility(shared!.id, OTHER, "shareable")).toBe(true);

    const found = store.searchOtherShareable([OTHER], "커피", 10);
    expect(found.map((candidate) => candidate.memory.id)).toEqual([shared!.id]);
    expect(store.byId(hidden!.id)?.visibility).toBe("private");
  });

  test("소유자 본인 검색에는 비공개 기억도 나온다", () => {
    const store = storeOf();
    personal(store, OTHER, "영희는 커피를 좋아한다");

    expect(store.searchOwn(OTHER, "커피", 10)).toHaveLength(1);
    expect(store.searchOwn(USER, "커피", 10)).toEqual([]);
  });

  test("본인 기억의 공개 범위는 본인만 바꿀 수 있다", () => {
    const store = storeOf();
    const memory = personal(store, OTHER, "영희는 커피를 좋아한다");

    expect(store.setPersonalVisibility(memory!.id, USER, "shareable")).toBe(false);
    expect(store.byId(memory!.id)?.visibility).toBe("private");
  });

  test("검색은 후보 예산을 넘지 않는다", () => {
    const store = storeOf();
    for (let index = 0; index < 20; index += 1) {
      personal(store, OTHER, `영희의 커피 취향 ${index}`, { visibility: "shareable" });
    }

    expect(store.searchOtherShareable([OTHER], "커피", 4)).toHaveLength(4);
  });
});

describe("세 갈래 기억 조회", () => {
  test("본인·타인 공유·공용 기억을 한 예산 안에서 합친다", () => {
    const store = storeOf();
    personal(store, USER, "민지는 커피를 좋아한다");
    personal(store, OTHER, "영희는 커피를 싫어한다", { visibility: "shareable" });
    store.addGuild({
      createdByUserId: USER,
      category: "server_convention",
      subjectUserId: null,
      content: "이 서버는 커피를 아침에 마신다",
      source: "slash_command"
    });

    const result = store.retrieve({
      actorUserId: USER,
      referencedUserIds: [OTHER],
      query: "커피",
      candidateLimit: 3
    });

    expect(result.candidates.map((candidate) => candidate.memory.scope)).toEqual([
      "user",
      "user",
      "guild"
    ]);
    expect(result.candidates.map((candidate) => candidate.memory.ownerUserId)).toEqual([
      USER,
      OTHER,
      null
    ]);
  });

  test("조회 범위를 끄면 그 경로는 비어 있다", () => {
    const store = storeOf();
    personal(store, USER, "민지는 커피를 좋아한다");
    personal(store, OTHER, "영희는 커피를 싫어한다", { visibility: "shareable" });

    const result = store.retrieve({
      actorUserId: USER,
      referencedUserIds: [OTHER],
      query: "커피",
      candidateLimit: 10,
      includeOwn: false,
      includeOther: false
    });

    expect(result.candidates).toEqual([]);
  });

  test("본인은 타인 공유 경로에서 중복 조회하지 않는다", () => {
    const store = storeOf();
    personal(store, USER, "민지는 커피를 좋아한다", { visibility: "shareable" });

    const result = store.retrieve({
      actorUserId: USER,
      referencedUserIds: [USER],
      query: "커피",
      candidateLimit: 10
    });

    expect(result.candidates).toHaveLength(1);
  });

  test("공용 기억 검색은 호칭을 빼고 돌려준다", () => {
    const store = storeOf();
    store.addGuild({
      createdByUserId: USER,
      category: "server_convention",
      subjectUserId: null,
      content: "이 서버는 커피를 아침에 마신다",
      source: "slash_command"
    });
    store.addGuild({
      createdByUserId: USER,
      category: "nickname",
      subjectUserId: OTHER,
      content: "영희의 별명은 \"커피왕\"이다.",
      structuredValue: "커피왕",
      source: "slash_command"
    });

    const found = store.searchGuild("커피", 10);
    expect(found.map((candidate) => candidate.memory.category)).toEqual(["server_convention"]);
  });

  test("호칭은 검색이 아니라 대상 사용자 기준으로 붙인다", () => {
    const store = storeOf();
    store.addGuild({
      createdByUserId: USER,
      category: "nickname",
      subjectUserId: OTHER,
      content: "영희의 별명은 \"천재\"이다.",
      structuredValue: "천재",
      source: "slash_command"
    });

    const result = store.retrieve({
      actorUserId: USER,
      referencedUserIds: [OTHER],
      query: "오늘 뭐 먹지",
      candidateLimit: 10
    });

    expect(result.candidates).toEqual([]);
    expect(result.conventions.map((memory) => memory.structuredValue)).toEqual(["천재"]);
  });

  test("거절된 호칭은 적용되지 않는다", () => {
    const store = storeOf();
    const nickname = store.addGuild({
      createdByUserId: USER,
      category: "nickname",
      subjectUserId: OTHER,
      content: "영희의 별명은 \"천재\"이다.",
      structuredValue: "천재",
      source: "slash_command"
    });

    store.releaseGuildNickname(OTHER, OTHER);

    const result = store.retrieve({
      actorUserId: USER,
      referencedUserIds: [OTHER],
      query: "안녕",
      candidateLimit: 10
    });
    expect(result.conventions).toEqual([]);
    expect(store.byId(nickname!.id)?.approval).toBe("rejected");
  });
});
