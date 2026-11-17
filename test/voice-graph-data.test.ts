import { expect, test } from "bun:test";
import {
  aggregateVoicePresence,
  mergeIntervals,
  pairSharedTimes,
  periodStart,
  rankUserIds,
  type VoiceSessionRow,
} from "../src/voice-graph-data.js";

const session = (user_id: string, channel_id: string, started_at: number, ended_at: number | null): VoiceSessionRow =>
  ({ user_id, channel_id, started_at, ended_at });

test("starts 7d and 30d at rolling windows and leaves all unbounded", () => {
  const now = 1_000_000_000;
  expect(periodStart("7d", now)).toBe(now - 7 * 86_400_000);
  expect(periodStart("30d", now)).toBe(now - 30 * 86_400_000);
  expect(periodStart("all", now)).toBeNull();
});

test("clips a session that crosses both period boundaries", () => {
  const presence = aggregateVoicePresence([session("a", "ch", 0, 1000)], { from: 200, to: 800 });
  expect(presence.get("a")?.totalMs).toBe(600);
});

test("treats an open session as ending at the snapshot time", () => {
  const presence = aggregateVoicePresence([session("a", "ch", 100, null)], { from: 0, to: 300 });
  expect(presence.get("a")?.totalMs).toBe(200);
});

test("merges overlapping duplicate rows instead of double counting them", () => {
  expect(mergeIntervals([{ start: 0, end: 100 }, { start: 50, end: 150 }])).toEqual([{ start: 0, end: 150 }]);
  expect(mergeIntervals([{ start: 200, end: 300 }, { start: 0, end: 100 }])).toEqual([
    { start: 0, end: 100 }, { start: 200, end: 300 },
  ]);
  const presence = aggregateVoicePresence([
    session("a", "ch", 0, 100),
    session("a", "ch", 50, 150),
    session("a", "ch", 140, 200),
  ], { from: 0, to: 1000 });
  expect(presence.get("a")?.totalMs).toBe(200);
});

test("drops zero length and fully out of window sessions", () => {
  const presence = aggregateVoicePresence([
    session("a", "ch", 100, 100),
    session("b", "ch", 0, 50),
    session("c", "ch", 900, 1000),
  ], { from: 100, to: 900 });
  expect([...presence.keys()]).toEqual([]);
});

test("only counts shared time inside the same channel", () => {
  const presence = aggregateVoicePresence([
    session("a", "ch1", 0, 100),
    session("b", "ch2", 0, 100),
  ], { from: 0, to: 1000 });
  expect(pairSharedTimes(presence, ["a", "b"])).toEqual([]);
  expect(pairSharedTimes(presence, ["b", "a"])).toEqual([]);

  const together = aggregateVoicePresence([
    session("a", "ch1", 0, 100),
    session("b", "ch1", 50, 150),
  ], { from: 0, to: 1000 });
  expect(pairSharedTimes(together, ["b", "a"])).toEqual([{ source: "a", target: "b", sharedMs: 50 }]);
});

test("counts a channel move once per channel without merging across them", () => {
  const presence = aggregateVoicePresence([
    session("a", "ch1", 0, 100),
    session("a", "ch2", 100, 200),
    session("b", "ch1", 0, 200),
  ], { from: 0, to: 1000 });
  expect(presence.get("a")?.totalMs).toBe(200);
  expect(pairSharedTimes(presence, ["a", "b"])).toEqual([{ source: "a", target: "b", sharedMs: 100 }]);
});

test("sums repeated overlaps across channels and rows", () => {
  const presence = aggregateVoicePresence([
    session("a", "ch1", 0, 100),
    session("a", "ch1", 200, 300),
    session("a", "ch2", 400, 500),
    session("b", "ch1", 0, 300),
    session("b", "ch2", 450, 500),
  ], { from: 0, to: 1000 });
  expect(pairSharedTimes(presence, ["a", "b"])).toEqual([{ source: "a", target: "b", sharedMs: 250 }]);
});

test("ranks the top twenty by time inside the selected period, not by lifetime totals", () => {
  const rows: VoiceSessionRow[] = [
    ...Array.from({ length: 25 }, (_, index) => session(`user${index}`, "ch", 0, (index + 1) * 1000)),
  ];
  const presence = aggregateVoicePresence(rows, { from: 0, to: 1_000_000 });
  const ranked = rankUserIds(presence, 20);
  expect(ranked).toHaveLength(20);
  expect(ranked[0]).toBe("user24");
  expect(ranked[19]).toBe("user5");
  expect(ranked).not.toContain("user4");
});

test("breaks ties by user id so the snapshot is deterministic", () => {
  const presence = aggregateVoicePresence([
    session("b", "ch", 0, 100),
    session("a", "ch", 0, 100),
    session("c", "ch", 0, 50),
  ], { from: 0, to: 1000 });
  expect(rankUserIds(presence, 3)).toEqual(["a", "b", "c"]);
});
