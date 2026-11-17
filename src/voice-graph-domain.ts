/**
 * 친밀도 그래프의 비시각적 의미 계층.
 * 2D PNG와 3D 화면이 같은 커뮤니티·관계 판정을 쓰도록 여기서 한 번만 계산한다.
 */

import type { EdgeKind } from "./voice-graph-contract.js";

export type VoiceGraphPair = { source: string; target: string; sharedMs: number };
export type VoiceGraphLink = VoiceGraphPair & { kind: EdgeKind; visibleByDefault: boolean };

export type VoiceRelations = {
  /** 양수 공유 시간을 가진 모든 페어. 강한 순서. */
  ranked: VoiceGraphPair[];
  /** `ranked`와 같은 순서. 기본 노출 여부와 강조 종류를 함께 담는다. */
  links: VoiceGraphLink[];
  /** 유저별 top-3 상대. 2D 배치의 인접 판정도 이 값을 쓴다. */
  topThree: Map<string, Set<string>>;
  groups: string[][];
  communities: Map<string, number>;
};

/**
 * 가중치 기반 커뮤니티 병합. 두 그룹을 합칠 때의 modularity gain이 양수인 동안 반복한다.
 * 원본 2D 구현과 동일한 결과를 내야 하므로 계산 순서를 바꾸지 않는다.
 */
export const voiceCommunities = (ids: string[], pairs: VoiceGraphPair[]): string[][] => {
  const groups = ids.map((userId) => new Set([userId]));
  const degrees = new Map(ids.map((id) => [id, 0]));
  const total = pairs.reduce((sum, pair) => sum + pair.sharedMs, 0);
  for (const pair of pairs) {
    degrees.set(pair.source, (degrees.get(pair.source) ?? 0) + pair.sharedMs);
    degrees.set(pair.target, (degrees.get(pair.target) ?? 0) + pair.sharedMs);
  }
  while (total > 0) {
    let best: { a: number; b: number; gain: number } | null = null;
    for (const [a, first] of groups.entries()) {
      for (let b = a + 1; b < groups.length; b++) {
        const second = groups[b]!;
        const between = pairs.reduce((sum, pair) => sum + (
          first.has(pair.source) && second.has(pair.target) || first.has(pair.target) && second.has(pair.source)
            ? pair.sharedMs : 0), 0);
        const degreeA = [...first].reduce((sum, id) => sum + (degrees.get(id) ?? 0), 0);
        const degreeB = [...second].reduce((sum, id) => sum + (degrees.get(id) ?? 0), 0);
        const gain = between / total - degreeA * degreeB / (2 * total * total);
        if (gain > 1e-12 && (!best || gain > best.gain)) best = { a, b, gain };
      }
    }
    if (!best) break;
    for (const id of groups[best.b]!) groups[best.a]!.add(id);
    groups.splice(best.b, 1);
  }
  return groups.filter((group) => group.size > 1).map((group) => [...group]);
};

/**
 * 선택된 인원과 페어 목록에서 화면이 쓸 관계를 만든다.
 * 기본 노출은 서로의 top-7에 든 관계뿐이지만, `links`에는 모든 양수 페어가 남아
 * 포커스·비교에서 숨겨졌던 관계까지 보여줄 수 있다.
 */
export const buildVoiceRelations = (ids: readonly string[], pairs: readonly VoiceGraphPair[]): VoiceRelations => {
  const uniqueIds = [...new Set(ids)];
  const idSet = new Set(uniqueIds);
  const unique = new Map<string, VoiceGraphPair>();
  for (const pair of pairs) {
    if (!idSet.has(pair.source) || !idSet.has(pair.target) || pair.source === pair.target) continue;
    if (!(pair.sharedMs > 0)) continue;
    const source = pair.source < pair.target ? pair.source : pair.target;
    const target = pair.source < pair.target ? pair.target : pair.source;
    const key = `${source}:${target}`;
    const previous = unique.get(key);
    if (!previous || previous.sharedMs < pair.sharedMs) unique.set(key, { source, target, sharedMs: pair.sharedMs });
  }
  const ranked = [...unique.values()].sort((a, b) =>
    b.sharedMs - a.sharedMs || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const neighborsOf = (userId: string, limit: number) => new Set(ranked
    .filter(({ source, target }) => source === userId || target === userId)
    .slice(0, limit)
    .map(({ source, target }) => (source === userId ? target : source)));
  const favorites = new Map(uniqueIds.map((userId) => [userId, neighborsOf(userId, 7)]));
  const topThree = new Map(uniqueIds.map((userId) => [userId, neighborsOf(userId, 3)]));

  const links: VoiceGraphLink[] = ranked.map((pair) => {
    const forward = topThree.get(pair.source)?.has(pair.target) ?? false;
    const reverse = topThree.get(pair.target)?.has(pair.source) ?? false;
    const kind: EdgeKind = forward && reverse ? "mutual" : forward || reverse ? "one-sided" : "other";
    return {
      ...pair,
      kind,
      visibleByDefault: (favorites.get(pair.source)?.has(pair.target) ?? false)
        && (favorites.get(pair.target)?.has(pair.source) ?? false),
    };
  });

  const groups = voiceCommunities(uniqueIds, ranked);
  const communities = new Map(groups.flatMap((group, index) => group.map((id) => [id, index] satisfies [string, number])));
  return { ranked, links, topThree, groups, communities };
};
