import type { Client } from "discord.js";
import {
  MAX_GRAPH_NODES, aggregateVoicePresence, loadLifetimeVoiceTotals, loadVoiceSessions,
  pairSharedTimes, periodStart, rankUserIds,
} from "./voice-graph-data.js";
import { buildVoiceRelations } from "./voice-graph-domain.js";
import type { GraphLink, GraphNode, GraphPeriod, GraphSnapshot } from "./voice-graph-contract.js";
import { resolveVoiceGraphMembers, type MemberCache } from "./voice-graph-members.js";

export type GraphResult = { snapshot: GraphSnapshot; avatarUrls: Map<string, string> };

export type ActivityGraphService = {
  snapshot: (guildId: string, period: GraphPeriod) => Promise<GraphResult | null>;
  avatarUrl: (guildId: string, userId: string) => string | null;
};

const CACHE_TTL_MS = 60_000;
const AVATAR_ALLOWLIST_LIMIT = 500;

/**
 * 한 요청 안의 모든 계산은 같은 `now`를 쓴다. 유저 총량과 페어 시간이 서로 다른
 * 시점을 기준으로 삼으면 합이 맞지 않는 화면이 나온다.
 */
export const buildGraphResult = async (
  client: Client,
  guildId: string,
  period: GraphPeriod,
  now: number,
  memberCache?: MemberCache,
): Promise<GraphResult | null> => {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const from = periodStart(period, now);
  const presence = aggregateVoicePresence(loadVoiceSessions(guildId, from), {
    from: from ?? Number.NEGATIVE_INFINITY,
    to: now,
  });

  // `all`은 기존 PNG와 같은 20명을 고르려고 누적 통화량 순위를 쓴다.
  // 그 외 기간은 그 기간 안에서 실제로 머문 시간으로 다시 뽑는다.
  const lifetime = period === "all" ? loadLifetimeVoiceTotals(guildId, MAX_GRAPH_NODES) : [];
  const ids = lifetime.length
    ? lifetime.map((row) => row.user_id)
    : rankUserIds(presence, MAX_GRAPH_NODES);

  const voiceMs = new Map<string, number>();
  for (const row of lifetime) voiceMs.set(row.user_id, row.voice_total * 1000);
  for (const id of ids) {
    if (!voiceMs.has(id)) voiceMs.set(id, presence.get(id)?.totalMs ?? 0);
  }

  const relations = buildVoiceRelations(ids, pairSharedTimes(presence, ids));
  const members = await resolveVoiceGraphMembers(guild, client, ids, memberCache, now);
  const byId = new Map(members.map((member) => [member.userId, member]));

  const nodes: GraphNode[] = ids.map((id) => {
    const member = byId.get(id);
    return {
      id,
      name: member?.name ?? "알 수 없는 유저",
      avatarPath: member?.avatarUrl ? `/api/graph/avatar/${id}` : null,
      voiceMs: voiceMs.get(id) ?? 0,
      community: relations.communities.get(id) ?? null,
    };
  });
  const links: GraphLink[] = relations.links;

  const avatarUrls = new Map<string, string>();
  for (const member of members) {
    if (member.avatarUrl) avatarUrls.set(member.userId, member.avatarUrl);
  }

  return {
    snapshot: {
      schemaVersion: 1,
      guildId,
      period,
      fromMs: from,
      toMs: now,
      generatedAtMs: now,
      semantics: "shared_voice_channel_presence",
      nodes,
      links,
    },
    avatarUrls,
  };
};

export const createActivityGraphService = (
  client: Client,
  clock: () => number = Date.now,
): ActivityGraphService => {
  const cache = new Map<string, { builtAt: number; result: GraphResult }>();
  const inflight = new Map<string, Promise<GraphResult | null>>();
  const avatarAllowlist = new Map<string, Map<string, string>>();
  const memberCache: MemberCache = new Map();

  const snapshot = async (guildId: string, period: GraphPeriod) => {
    const key = `${guildId}:${period}`;
    const now = clock();
    const cached = cache.get(key);
    if (cached && now - cached.builtAt < CACHE_TTL_MS) return cached.result;

    const pending = inflight.get(key);
    if (pending) return pending;

    const build = buildGraphResult(client, guildId, period, now, memberCache)
      .then((result) => {
        if (!result) return null;
        cache.set(key, { builtAt: now, result });
        let allowed = avatarAllowlist.get(guildId);
        if (!allowed || allowed.size > AVATAR_ALLOWLIST_LIMIT) {
          allowed = new Map();
          avatarAllowlist.set(guildId, allowed);
        }
        for (const [userId, url] of result.avatarUrls) allowed.set(userId, url);
        return result;
      })
      .finally(() => { inflight.delete(key); });
    inflight.set(key, build);
    return build;
  };

  return {
    snapshot,
    avatarUrl: (guildId, userId) => avatarAllowlist.get(guildId)?.get(userId) ?? null,
  };
};
