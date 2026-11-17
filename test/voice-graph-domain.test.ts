import { expect, test } from "bun:test";
import { buildVoiceRelations, voiceCommunities, type VoiceGraphPair } from "../src/voice-graph-domain.js";

const ids = Array.from({ length: 10 }, (_, index) => String(index));

test("keeps every positive pair available even when the default view hides it", () => {
  const pairs: VoiceGraphPair[] = [1, 2, 3, 4, 5, 6, 7, 8].map((target) => ({
    source: "0", target: String(target), sharedMs: 100 - target * 10,
  }));
  const { links } = buildVoiceRelations(ids, pairs);
  const visible = links.filter((link) => link.visibleByDefault);
  const hidden = links.find((link) => link.source === "0" && link.target === "8");
  expect(visible.map((link) => `${link.source}-${link.target}`)).not.toContain("0-8");
  expect(hidden).toEqual({ source: "0", target: "8", sharedMs: 20, kind: "one-sided", visibleByDefault: false });
  expect(links).toHaveLength(8);
});

test("orders links by strength and normalizes direction", () => {
  const { ranked, links } = buildVoiceRelations(["b", "a", "c"], [
    { source: "b", target: "a", sharedMs: 10 },
    { source: "a", target: "b", sharedMs: 90 },
    { source: "c", target: "a", sharedMs: 50 },
    { source: "c", target: "c", sharedMs: 999 },
    { source: "c", target: "unknown", sharedMs: 999 },
    { source: "c", target: "a", sharedMs: 0 },
  ]);
  expect(ranked).toEqual([
    { source: "a", target: "b", sharedMs: 90 },
    { source: "a", target: "c", sharedMs: 50 },
  ]);
  expect(links.map((link) => link.kind)).toEqual(["mutual", "mutual"]);
});

test("marks the strongest three as mutual and the rest as one-sided or other", () => {
  const pairs: VoiceGraphPair[] = [
    { source: "0", target: "1", sharedMs: 100 },
    { source: "0", target: "2", sharedMs: 90 },
    { source: "0", target: "3", sharedMs: 80 },
    { source: "0", target: "4", sharedMs: 70 },
    { source: "4", target: "5", sharedMs: 1 },
    { source: "4", target: "6", sharedMs: 30 },
    { source: "4", target: "7", sharedMs: 20 },
    { source: "5", target: "6", sharedMs: 30 },
    { source: "5", target: "7", sharedMs: 20 },
  ];
  for (let target = 2; target < 10; target++) pairs.push({ source: "1", target: String(target), sharedMs: 200 + target });
  const { links } = buildVoiceRelations(ids, pairs);
  const visible = links.filter((entry) => entry.visibleByDefault);
  const link = (source: string, target: string) => visible.find((entry) => entry.source === source && entry.target === target);
  expect(link("0", "1")).toBeUndefined();
  expect(link("0", "2")?.kind).toBe("mutual");
  expect(link("0", "4")?.kind).toBe("one-sided");
  expect(link("4", "5")?.kind).toBe("other");
});

test("groups dense communities and leaves a lone caller without one", () => {
  const pairs: VoiceGraphPair[] = [];
  for (const offset of [0, 4]) for (let a = offset; a < offset + 4; a++) for (let b = a + 1; b < offset + 4; b++) {
    pairs.push({ source: String(a), target: String(b), sharedMs: 3_600_000 });
  }
  pairs.push({ source: "3", target: "4", sharedMs: 1000 });
  const { communities } = buildVoiceRelations(ids, pairs);
  expect(communities.get("0")).toBe(communities.get("3"));
  expect(communities.get("4")).toBe(communities.get("7"));
  expect(communities.get("0")).not.toBe(communities.get("4"));
  expect(communities.has("8")).toBe(false);
  expect(communities.has("9")).toBe(false);
});

test("returns no community for a graph with no shared time", () => {
  expect(voiceCommunities(["a", "b"], [])).toEqual([]);
  expect(buildVoiceRelations(["a", "b"], []).links).toEqual([]);
});
