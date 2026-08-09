import { expect, test } from "bun:test";
import { renderVoiceAffinity } from "../src/voice-affinity-card.js";
import { buildVoiceAffinity } from "../src/voice-affinity.js";

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
