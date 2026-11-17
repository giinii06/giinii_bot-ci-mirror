import { expect, test } from "bun:test";
import {
  compareReport, focusReport, highlightFor, initialSelection, linkKey, pruneSelection, selectNode,
  type Selection,
} from "../activity/src/selection.js";
import type { GraphSnapshot } from "../src/voice-graph-contract.js";

const snapshot: GraphSnapshot = {
  schemaVersion: 1,
  guildId: "g1",
  period: "all",
  fromMs: null,
  toMs: 1_000_000,
  generatedAtMs: 1_000_000,
  semantics: "shared_voice_channel_presence",
  nodes: ["a", "b", "c", "d", "e"].map((id, index) => ({
    id, name: id.toUpperCase(), avatarPath: null, voiceMs: (5 - index) * 1000, community: null,
  })),
  links: [
    { source: "a", target: "b", sharedMs: 100, kind: "mutual", visibleByDefault: true },
    { source: "a", target: "c", sharedMs: 50, kind: "one-sided", visibleByDefault: false },
    { source: "b", target: "c", sharedMs: 40, kind: "other", visibleByDefault: false },
    { source: "d", target: "e", sharedMs: 10, kind: "other", visibleByDefault: false },
  ],
};

const compare = (first: string, second: string | null): Selection => ({ mode: "compare", first, second });

test("walks all, focus, and compare with reversible clicks", () => {
  expect(selectNode(initialSelection, "a")).toEqual({ mode: "focus", userId: "a" });
  expect(selectNode({ mode: "focus", userId: "a" }, "a")).toEqual(initialSelection);
  expect(selectNode({ mode: "focus", userId: "a" }, "b")).toEqual(compare("a", "b"));
  expect(selectNode(compare("a", "b"), "b")).toEqual({ mode: "focus", userId: "a" });
  expect(selectNode(compare("a", "b"), "a")).toEqual({ mode: "focus", userId: "b" });
  expect(selectNode(compare("a", "b"), "c")).toEqual(compare("a", "c"));
  expect(selectNode(compare("a", null), "a")).toEqual(initialSelection);
  expect(selectNode(compare("a", null), "c")).toEqual(compare("a", "c"));
});

test("drops only the selections the new period no longer contains", () => {
  const shorter: GraphSnapshot = { ...snapshot, nodes: snapshot.nodes.filter((node) => node.id !== "b") };
  expect(pruneSelection({ mode: "focus", userId: "b" }, shorter)).toEqual(initialSelection);
  expect(pruneSelection({ mode: "focus", userId: "a" }, shorter)).toEqual({ mode: "focus", userId: "a" });
  expect(pruneSelection(compare("a", "b"), shorter)).toEqual({ mode: "focus", userId: "a" });
  expect(pruneSelection(compare("x", "c"), shorter)).toEqual({ mode: "focus", userId: "c" });
  expect(pruneSelection(compare("a", "c"), shorter)).toEqual(compare("a", "c"));
  expect(pruneSelection(compare("b", "x"), shorter)).toEqual(initialSelection);
});

test("highlights every node and no link in the default view", () => {
  const highlight = highlightFor(snapshot, initialSelection);
  expect([...highlight.nodes].sort()).toEqual(["a", "b", "c", "d", "e"]);
  expect(highlight.links.size).toBe(0);
});

test("focus exposes relationships the default view hid", () => {
  const highlight = highlightFor(snapshot, { mode: "focus", userId: "a" });
  expect([...highlight.nodes].sort()).toEqual(["a", "b", "c"]);
  expect([...highlight.links].sort()).toEqual([linkKey("a", "b"), linkKey("a", "c")]);
});

test("compare keeps both neighbourhoods and the direct link", () => {
  const highlight = highlightFor(snapshot, compare("a", "b"));
  expect([...highlight.nodes].sort()).toEqual(["a", "b", "c"]);
  expect([...highlight.links].sort()).toEqual([linkKey("a", "b"), linkKey("a", "c"), linkKey("b", "c")]);
});

test("reports focus neighbours by shared time", () => {
  expect(focusReport(snapshot, "a")).toEqual({
    id: "a",
    voiceMs: 5000,
    neighbors: [{ id: "b", sharedMs: 100 }, { id: "c", sharedMs: 50 }],
  });
});

test("compares two people with direct time, shared neighbours, and each side's list", () => {
  expect(compareReport(snapshot, "a", "b")).toEqual({
    first: { id: "a", voiceMs: 5000, neighbors: [{ id: "b", sharedMs: 100 }, { id: "c", sharedMs: 50 }] },
    second: { id: "b", voiceMs: 4000, neighbors: [{ id: "a", sharedMs: 100 }, { id: "c", sharedMs: 40 }] },
    directMs: 100,
    sharedNeighbors: ["c"],
  });
});

test("says there is no shared call instead of inventing a score", () => {
  const report = compareReport(snapshot, "a", "e");
  expect(report.directMs).toBe(0);
  expect(report.sharedNeighbors).toEqual([]);
});
