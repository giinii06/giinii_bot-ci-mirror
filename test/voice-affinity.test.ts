import { expect, test } from "bun:test";
import { rankingCards, renderVoiceAffinity } from "../src/voice-affinity-card.js";
import { buildVoiceAffinity } from "../src/voice-affinity.js";

const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const makeEntries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `멤버${index}`,
    username: `member${index}`,
    sharedMs: (count - index) * 60_000
  }));

test("voice affinity sums overlapping sessions and ranks by shared time", () => {
  const result = buildVoiceAffinity(
    [
      { user_id: "target", channel_id: "room", started_at: 0, ended_at: 10_000 },
      { user_id: "target", channel_id: "room", started_at: 20_000, ended_at: 30_000 },
    ],
    [
      { user_id: "short", channel_id: "room", started_at: 7_000, ended_at: 12_000 },
      { user_id: "long", channel_id: "room", started_at: 1_000, ended_at: 9_000 },
      { user_id: "long", channel_id: "room", started_at: 22_000, ended_at: 25_000 },
      { user_id: "other-room", channel_id: "elsewhere", started_at: 0, ended_at: 20_000 },
    ],
    20_000,
  );

  expect(result.map(({ user_id, shared_ms }) => [user_id, shared_ms])).toEqual([
    ["long", 11_000],
    ["short", 3_000],
  ]);
});

test("normalizes equivalent user IDs before merging", () => {
  const result = buildVoiceAffinity(
    [{ user_id: "target", channel_id: "room", started_at: 0, ended_at: 10_000 }],
    [
      { user_id: "  same-user ", channel_id: "room", started_at: 0, ended_at: 4_000 },
      { user_id: "same-user", channel_id: "room", started_at: 4_000, ended_at: 9_000 },
    ],
    10_000,
  );

  expect(result).toEqual([{ user_id: "same-user", shared_ms: 9_000, last_together_at: 9_000 }]);
});

test("renders a voice affinity PNG card", () => {
  const png = renderVoiceAffinity("테스트", [{ name: "멤버", username: "member", sharedMs: 120_000 }]);

  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("renders a voice volume PNG card", () => {
  const png = renderVoiceAffinity("전체", [{ name: "멤버", username: "member", sharedMs: 120_000 }], 1, 1, "volume");

  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("renders chat and combined activity PNG cards", () => {
  const entries = [{ name: "멤버", username: "member", sharedMs: 12 }];

  expect(renderVoiceAffinity("오늘", entries, 1, 1, "chat").subarray(0, 8).toString("hex"))
    .toBe("89504e470d0a1a0a");
  expect(renderVoiceAffinity("오늘", entries, 1, 1, "activity").subarray(0, 8).toString("hex"))
    .toBe("89504e470d0a1a0a");
});

test("uses a podium on the first page and adds height for rows below it", () => {
  const empty = pngSize(renderVoiceAffinity("전체", [], 1, 0, "volume"));
  const one = pngSize(renderVoiceAffinity("전체", makeEntries(1), 1, 1, "volume"));
  const three = pngSize(renderVoiceAffinity("전체", makeEntries(3), 1, 3, "volume"));
  const four = pngSize(renderVoiceAffinity("전체", makeEntries(4), 1, 4, "volume"));
  const seven = pngSize(renderVoiceAffinity("전체", makeEntries(7), 1, 7, "volume"));

  expect([empty.width, one.width, four.width, seven.width]).toEqual([2400, 2400, 2400, 2400]);
  expect(empty.height).toBeLessThanOrEqual(one.height);
  expect(three).toEqual(one);
  expect(one.height).toBeLessThan(four.height);
  expect(four.height).toBeLessThan(seven.height);
});

test("uses the same seven-row layout for both continuation pages", () => {
  const entries = makeEntries(7);
  const first = pngSize(renderVoiceAffinity("전체", entries, 1, 21, "volume"));
  const second = pngSize(renderVoiceAffinity("전체", entries, 8, 21, "volume"));
  const third = pngSize(renderVoiceAffinity("전체", entries, 15, 21, "volume"));

  expect(second).toEqual(third);
  expect(second.width).toBe(first.width);
  expect(second.height).toBeLessThan(first.height);
});

test("gives every mode the same geometry for the same row count", () => {
  const entries = makeEntries(5);
  const sizes = (["affinity", "volume", "chat", "activity"] as const)
    .map((mode) => pngSize(renderVoiceAffinity("테스트", entries, 1, 5, mode)));

  expect(new Set(sizes.map((size) => size.height)).size).toBe(1);
});

test("pages the affinity ranking seven people at a time", () => {
  const threePages = rankingCards("테스트", makeEntries(21), "affinity", "voice-affinity.png");

  expect(threePages).toHaveLength(3);
  expect(threePages.every((card) => card.name === "voice-affinity.png")).toBe(true);
  expect(rankingCards("테스트", makeEntries(7), "affinity", "voice-affinity.png")).toHaveLength(1);
});

test("drops the podium from the second page onward", () => {
  const cards = rankingCards("테스트", makeEntries(21), "affinity", "voice-affinity.png");
  const [first, second, third] = cards.map((card) => card.attachment);
  const [firstSize, secondSize, thirdSize] = cards.map((card) => pngSize(card.attachment));

  expect(second.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(secondSize.height).toBeLessThan(firstSize.height);
  expect(secondSize).toEqual(thirdSize);
  expect([first.equals(second), second.equals(third), first.equals(third)]).toEqual([false, false, false]);
});
