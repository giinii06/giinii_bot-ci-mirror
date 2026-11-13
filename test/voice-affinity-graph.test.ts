import { expect, test } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildVoiceGraph, renderVoiceAffinityGraph, type VoiceGraphMember, type VoiceGraphPair } from "../src/voice-affinity-graph.js";

const members = (count: number): VoiceGraphMember[] => Array.from({ length: count }, (_, index) => ({
  userId: String(index), name: `멤버${index}`, avatarUrl: null, voiceMs: (count - index) * 60_000,
}));
const completePairs = (count: number): VoiceGraphPair[] => members(count).flatMap((a, i) => members(count).slice(i + 1)
  .map((b, j) => ({ source: a.userId, target: b.userId, sharedMs: (count - j) * 1000 })));

test("includes the top20 by voice time and only mutual top7 positive relationships", () => {
  const graph = buildVoiceGraph(members(25).reverse(), [...completePairs(25),
    { source: "0", target: "0", sharedMs: 1_000_000 },
    { source: "1", target: "0", sharedMs: 1 },
    { source: "unknown", target: "0", sharedMs: 1_000_000 },
  ]);
  expect(graph.nodes.map((node) => node.userId)).toEqual(members(20).map((member) => member.userId));
  for (const node of graph.nodes) {
    expect(graph.edges.filter((edge) => edge.source === node.userId || edge.target === node.userId).length).toBeLessThanOrEqual(7);
  }
  expect(graph.edges.every((edge) => edge.source !== edge.target && edge.sharedMs > 0)).toBe(true);
  expect(new Set(graph.edges.map(({ source, target }) => [source, target].sort().join(":"))).size).toBe(graph.edges.length);
  expect(buildVoiceGraph(members(2), [{ source: "0", target: "1", sharedMs: 0 }]).edges).toEqual([]);
});

test("keeps twenty avatars and labels apart inside the FHD canvas with deterministic placement", () => {
  const graph = buildVoiceGraph(members(20), completePairs(20));
  expect(buildVoiceGraph(members(20), completePairs(20))).toEqual(graph);
  for (const [index, a] of graph.nodes.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(136);
    expect(a.x).toBeLessThanOrEqual(1784);
    expect(a.y).toBeGreaterThanOrEqual(242);
    expect(a.y).toBeLessThanOrEqual(922);
    for (const b of graph.nodes.slice(index + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(194);
  }
});

test("places a stronger relationship closer than a weaker relationship", () => {
  const { nodes } = buildVoiceGraph(members(4), [
    { source: "0", target: "1", sharedMs: 100_000 },
    { source: "2", target: "3", sharedMs: 1000 },
  ]);
  const [a, b, c, d] = nodes;
  if (!a || !b || !c || !d) throw new Error("Expected all four members");
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(Math.hypot(c.x - d.x, c.y - d.y));
});

test("gives the three nearest places to the longest shared calls when callers compete for a neighbor", () => {
  const people = members(8);
  const graph = buildVoiceGraph(people, people.slice(1).map((person, index) => ({
    source: "0", target: person.userId, sharedMs: (7 - index) * 60_000,
  })).reverse());
  const center = graph.nodes.find((node) => node.userId === "0");
  if (!center) throw new Error("Expected the shared call partner");
  const nearest = graph.nodes.filter((node) => node !== center).sort((a, b) =>
    Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
  expect(nearest.slice(0, 3).map((node) => node.userId).sort()).toEqual(["1", "2", "3"]);
});

test("keeps disconnected and differently weighted dense graphs separated", () => {
  for (const seed of [0, 7, 19]) {
    const pairs = completePairs(20).map((pair, index) => ({ ...pair,
      sharedMs: seed === 0 ? 0 : Math.abs(Math.sin(seed * 129 + index * 179)) * 100_000,
    }));
    const { nodes } = buildVoiceGraph(members(20), pairs);
    for (const [index, a] of nodes.entries()) {
      for (const b of nodes.slice(index + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(194);
    }
  }
});

test("renders a real 1920x1080 PNG with avatars and fallback initials when an avatar cannot load", async () => {
  const people = members(2);
  const avatar = createCanvas(1, 1);
  const avatarContext = avatar.getContext("2d");
  avatarContext.fillStyle = "#ff0000";
  avatarContext.fillRect(0, 0, 1, 1);
  people[0]!.avatarUrl = `data:image/png;base64,${avatar.toBuffer("image/png").toString("base64")}`;
  people[1]!.avatarUrl = "http://127.0.0.1:1/missing.png";
  const graph = buildVoiceGraph(people, completePairs(2));
  const png = await renderVoiceAffinityGraph(graph);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(1920);
  expect(png.readUInt32BE(20)).toBe(1080);
  const rendered = createCanvas(1920, 1080).getContext("2d");
  rendered.drawImage(await loadImage(png), 0, 0);
  expect([...rendered.getImageData(Math.round(graph.nodes[0]!.x), Math.round(graph.nodes[0]!.y), 1, 1).data]).toEqual([255, 0, 0, 255]);
  const empty = await renderVoiceAffinityGraph(buildVoiceGraph([], []));
  expect(empty.readUInt32BE(16)).toBe(1920);
});

test("keeps two frequent-calling communities distinct across a brief bridge and leaves an isolated caller neutral", () => {
  const pairs: VoiceGraphPair[] = [];
  for (const offset of [0, 4]) for (let a = offset; a < offset + 4; a++) for (let b = a + 1; b < offset + 4; b++) {
    pairs.push({ source: String(a), target: String(b), sharedMs: 3_600_000 });
  }
  pairs.push({ source: "3", target: "4", sharedMs: 1000 });
  const { nodes } = buildVoiceGraph(members(9), pairs);
  const first = nodes.find((node) => node.userId === "0")?.community;
  const second = nodes.find((node) => node.userId === "4")?.community;
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first).not.toBe(second);
  expect(nodes.filter((node) => Number(node.userId) < 4).every((node) => node.community === first)).toBe(true);
  expect(nodes.filter((node) => Number(node.userId) >= 4 && Number(node.userId) < 8).every((node) => node.community === second)).toBe(true);
  expect(nodes.find((node) => node.userId === "8")?.community).toBeNull();
});

test("emphasizes mutual and one-sided top-three relationships using even the partners hidden by the seven-line limit", () => {
  const pairs = [
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
  const { edges } = buildVoiceGraph(members(10), pairs);
  const edge = (source: string, target: string) => edges.find((pair) => pair.source === source && pair.target === target);
  expect(edge("0", "1")).toBeUndefined();
  expect(edge("0", "2")?.kind).toBe("mutual");
  expect(edge("0", "4")?.kind).toBe("one-sided");
  expect(edge("4", "5")?.kind).toBe("other");
});

test("keeps every photo the same size despite an extreme total voice time", async () => {
  const people = members(2);
  const avatar = createCanvas(1, 1);
  avatar.getContext("2d").fillStyle = "#ff0000";
  avatar.getContext("2d").fillRect(0, 0, 1, 1);
  const avatarUrl = `data:image/png;base64,${avatar.toBuffer("image/png").toString("base64")}`;
  people[0]!.voiceMs = Number.MAX_SAFE_INTEGER;
  for (const person of people) person.avatarUrl = avatarUrl;
  const graph = buildVoiceGraph(people, []);
  const png = await renderVoiceAffinityGraph(graph);
  const ctx = createCanvas(1920, 1080).getContext("2d");
  ctx.drawImage(await loadImage(png), 0, 0);
  for (const node of graph.nodes) {
    const center = Math.round(node.x);
    const row = Math.round(node.y);
    for (const offset of [-55, 0, 55]) expect([...ctx.getImageData(center + offset, row, 1, 1).data]).toEqual([255, 0, 0, 255]);
    for (const offset of [-65, 65]) expect([...ctx.getImageData(center + offset, row, 1, 1).data]).not.toEqual([255, 0, 0, 255]);
  }
});
