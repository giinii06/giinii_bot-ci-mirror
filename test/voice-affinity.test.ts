import { expect, test } from "bun:test";
import { renderVoiceAffinity } from "../src/voice-affinity-card.js";
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
  const png = renderVoiceAffinity("테스트", [{ name: "멤버", username: "member", sharedMs: 120_000 }], Date.now());

  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("renders a voice volume PNG card", () => {
  const png = renderVoiceAffinity("전체", [{ name: "멤버", username: "member", sharedMs: 120_000 }], Date.now(), 1, 1, "volume", 3_600_000);

  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("renders chat and combined activity PNG cards", () => {
  const entries = [{ name: "멤버", username: "member", sharedMs: 12 }];

  expect(renderVoiceAffinity("오늘", entries, Date.now(), 1, 1, "chat", 24).subarray(0, 8).toString("hex"))
    .toBe("89504e470d0a1a0a");
  expect(renderVoiceAffinity("오늘", entries, Date.now(), 1, 1, "activity", 36).subarray(0, 8).toString("hex"))
    .toBe("89504e470d0a1a0a");
});

test("keeps a fixed width and grows the card with the row count", () => {
  const now = Date.now();
  const empty = pngSize(renderVoiceAffinity("전체", [], now, 1, 0, "volume", 0));
  const one = pngSize(renderVoiceAffinity("전체", makeEntries(1), now, 1, 1, "volume"));
  const four = pngSize(renderVoiceAffinity("전체", makeEntries(4), now, 1, 4, "volume"));
  const seven = pngSize(renderVoiceAffinity("전체", makeEntries(7), now, 1, 7, "volume"));

  expect([empty.width, one.width, four.width, seven.width]).toEqual([2400, 2400, 2400, 2400]);
  expect(empty.height).toBeLessThanOrEqual(one.height);
  expect(one.height).toBeLessThan(four.height);
  expect(four.height).toBeLessThan(seven.height);
});

test("gives every mode the same geometry for the same row count", () => {
  const now = Date.now();
  const entries = makeEntries(5);
  const sizes = (["affinity", "volume", "chat", "activity"] as const)
    .map((mode) => pngSize(renderVoiceAffinity("테스트", entries, now, 1, 5, mode)));

  expect(new Set(sizes.map((size) => size.height)).size).toBe(1);
});
