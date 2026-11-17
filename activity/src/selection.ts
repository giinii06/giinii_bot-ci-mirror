import type { GraphLink, GraphSnapshot } from "../../src/voice-graph-contract.js";

/** 전체 → 한 명 포커스 → 두 명 비교. 세 번째 클릭이 비교를 만든다. */
export type Selection =
  | { mode: "all" }
  | { mode: "focus"; userId: string }
  | { mode: "compare"; first: string; second: string | null };

export const initialSelection: Selection = { mode: "all" };

export const selectNode = (selection: Selection, userId: string): Selection => {
  if (selection.mode === "all") return { mode: "focus", userId };
  if (selection.mode === "focus") {
    return selection.userId === userId ? initialSelection : { mode: "compare", first: selection.userId, second: userId };
  }
  if (selection.second === null) {
    return selection.first === userId ? initialSelection : { mode: "compare", first: selection.first, second: userId };
  }
  if (selection.first === userId) return { mode: "focus", userId: selection.second };
  if (selection.second === userId) return { mode: "focus", userId: selection.first };
  return { mode: "compare", first: selection.first, second: userId };
};

/** 기간이 바뀌어 사라진 선택만 푼다. 남아 있으면 그대로 유지한다. */
export const pruneSelection = (selection: Selection, snapshot: GraphSnapshot): Selection => {
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  if (selection.mode === "focus") return ids.has(selection.userId) ? selection : initialSelection;
  if (selection.mode === "compare") {
    const first = ids.has(selection.first) ? selection.first : null;
    const second = selection.second && ids.has(selection.second) ? selection.second : null;
    if (first && second) return { mode: "compare", first, second };
    if (first) return { mode: "focus", userId: first };
    if (second) return { mode: "focus", userId: second };
    return initialSelection;
  }
  return selection;
};

export const linkKey = (source: string, target: string) => `${source}|${target}`;

export type Highlight = { nodes: Set<string>; links: Set<string> };

export const highlightFor = (snapshot: GraphSnapshot, selection: Selection): Highlight => {
  const nodes = new Set<string>();
  const links = new Set<string>();
  if (selection.mode === "all") {
    for (const node of snapshot.nodes) nodes.add(node.id);
    return { nodes, links };
  }
  const include = (userId: string) => {
    nodes.add(userId);
    for (const link of snapshot.links) {
      if (link.source !== userId && link.target !== userId) continue;
      nodes.add(link.source);
      nodes.add(link.target);
      links.add(linkKey(link.source, link.target));
    }
  };
  if (selection.mode === "focus") {
    include(selection.userId);
  } else {
    include(selection.first);
    if (selection.second) include(selection.second);
  }
  return { nodes, links };
};

export type NeighborTime = { id: string; sharedMs: number };

const neighborsOf = (links: readonly GraphLink[], userId: string): NeighborTime[] => links
  .filter((link) => link.source === userId || link.target === userId)
  .map((link) => ({ id: link.source === userId ? link.target : link.source, sharedMs: link.sharedMs }))
  .sort((a, b) => b.sharedMs - a.sharedMs || (a.id < b.id ? -1 : 1));

export type FocusReport = { id: string; voiceMs: number; neighbors: NeighborTime[] };

export const focusReport = (snapshot: GraphSnapshot, userId: string): FocusReport => {
  const node = snapshot.nodes.find((entry) => entry.id === userId);
  return { id: userId, voiceMs: node?.voiceMs ?? 0, neighbors: neighborsOf(snapshot.links, userId).slice(0, 7) };
};

export type CompareReport = {
  first: { id: string; voiceMs: number; neighbors: NeighborTime[] };
  second: { id: string; voiceMs: number; neighbors: NeighborTime[] };
  /** 두 사람이 같은 채널에 함께 있던 시간. 기본 화면에서 선이 숨겨져 있어도 정확하다. */
  directMs: number;
  /** A와 B 모두와 양수 관계가 있는 사람. A·B 자신은 제외한다. */
  sharedNeighbors: string[];
};

export const compareReport = (snapshot: GraphSnapshot, first: string, second: string): CompareReport => {
  const voiceMsOf = (id: string) => snapshot.nodes.find((node) => node.id === id)?.voiceMs ?? 0;
  const firstNeighbors = neighborsOf(snapshot.links, first);
  const secondNeighbors = neighborsOf(snapshot.links, second);
  const secondIds = new Set(secondNeighbors.map((entry) => entry.id));
  const sharedNeighbors = firstNeighbors
    .map((entry) => entry.id)
    .filter((id) => id !== second && secondIds.has(id));
  const direct = snapshot.links.find((link) =>
    (link.source === first && link.target === second) || (link.source === second && link.target === first));
  return {
    first: { id: first, voiceMs: voiceMsOf(first), neighbors: firstNeighbors.slice(0, 7) },
    second: { id: second, voiceMs: voiceMsOf(second), neighbors: secondNeighbors.slice(0, 7) },
    directMs: direct?.sharedMs ?? 0,
    sharedNeighbors,
  };
};
