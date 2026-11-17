import { all } from "./storage.js";
import type { GraphPeriod } from "./voice-graph-contract.js";
import type { VoiceGraphPair } from "./voice-graph-domain.js";

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<Exclude<GraphPeriod, "all">, number> = { "7d": 7, "30d": 30 };

export { MAX_GRAPH_NODES } from "./voice-graph-contract.js";

export type Interval = { start: number; end: number };

export type VoiceSessionRow = {
  user_id: string;
  channel_id: string;
  started_at: number;
  ended_at: number | null;
};

export type VoicePresence = {
  userId: string;
  totalMs: number;
  /** 채널별로 병합된 구간. 채널이 다르면 겹쳐도 함께한 시간이 아니다. */
  channels: Map<string, Interval[]>;
};

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 기간 시작 시각. `all`은 제한이 없으므로 null. 자정이 아니라 요청 시점 기준 rolling window다. */
export const periodStart = (period: GraphPeriod, now: number): number | null =>
  period === "all" ? null : now - PERIOD_DAYS[period] * DAY_MS;

/**
 * 겹치거나 중복된 구간을 하나로 합친다. 같은 유저가 같은 채널에 남긴 두 row가
 * 겹치면 단순 합산은 체류 시간을 초과 집계한다.
 */
export const mergeIntervals = (intervals: readonly Interval[]): Interval[] => {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      continue;
    }
    merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
};

export type AggregateWindow = { from: number; to: number };

/**
 * 세션 row를 기간 경계로 자른 뒤 유저별 체류 시간을 만든다.
 * 열린 세션(`ended_at === null`)은 `to`에서 끝난 것으로 본다. 경계는 [from, to).
 */
export const aggregateVoicePresence = (
  rows: readonly VoiceSessionRow[],
  { from, to }: AggregateWindow,
): Map<string, VoicePresence> => {
  const grouped = new Map<string, Map<string, Interval[]>>();
  for (const row of rows) {
    const start = Math.max(row.started_at, from);
    const end = Math.min(row.ended_at ?? to, to);
    if (!(end > start)) continue;
    const channels = grouped.get(row.user_id) ?? new Map<string, Interval[]>();
    grouped.set(row.user_id, channels);
    const intervals = channels.get(row.channel_id) ?? [];
    channels.set(row.channel_id, intervals);
    intervals.push({ start, end });
  }

  const presence = new Map<string, VoicePresence>();
  for (const [userId, channels] of grouped) {
    let totalMs = 0;
    for (const [channelId, intervals] of channels) {
      const merged = mergeIntervals(intervals);
      channels.set(channelId, merged);
      for (const interval of merged) totalMs += interval.end - interval.start;
    }
    presence.set(userId, { userId, totalMs, channels });
  }
  return presence;
};

const overlapMs = (a: readonly Interval[], b: readonly Interval[]): number => {
  let total = 0;
  let left = 0;
  let right = 0;
  while (left < a.length && right < b.length) {
    const start = Math.max(a[left]!.start, b[right]!.start);
    const end = Math.min(a[left]!.end, b[right]!.end);
    if (end > start) total += end - start;
    if (a[left]!.end <= b[right]!.end) left += 1;
    else right += 1;
  }
  return total;
};

/** 선택된 인원 사이의 동시 체류 시간. 같은 채널에서 겹친 구간만 센다. */
export const pairSharedTimes = (
  presence: Map<string, VoicePresence>,
  userIds: readonly string[],
): VoiceGraphPair[] => {
  const ids = [...new Set(userIds)].sort(compareIds);
  const pairs: VoiceGraphPair[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const first = presence.get(ids[i]!);
      const second = presence.get(ids[j]!);
      if (!first || !second) continue;
      let sharedMs = 0;
      for (const [channelId, intervals] of first.channels) {
        const other = second.channels.get(channelId);
        if (other) sharedMs += overlapMs(intervals, other);
      }
      if (sharedMs > 0) pairs.push({ source: ids[i]!, target: ids[j]!, sharedMs });
    }
  }
  return pairs;
};

/** 기간 안 체류 시간 내림차순, 동률은 user ID 오름차순. */
export const rankUserIds = (presence: Map<string, VoicePresence>, limit: number): string[] =>
  [...presence.values()]
    .sort((a, b) => b.totalMs - a.totalMs || compareIds(a.userId, b.userId))
    .slice(0, limit)
    .map((entry) => entry.userId);

export const loadVoiceSessions = (guildId: string, from: number | null): VoiceSessionRow[] =>
  all<VoiceSessionRow>(
    guildId,
    `SELECT user_id, channel_id, started_at, ended_at
     FROM voice_presence_sessions
     WHERE guild_id = ? AND (ended_at IS NULL OR ended_at > ?)
     ORDER BY user_id, channel_id, started_at`,
    guildId,
    from ?? 0,
  );

/**
 * 누적 통화량 순위. `all` 그래프에서 기존 PNG와 같은 20명을 고르기 위해서만 쓴다.
 * 60초 틱으로 쌓인 값이라 세션 합계와 몇 초 어긋날 수 있다.
 */
export const loadLifetimeVoiceTotals = (guildId: string, limit: number) =>
  all<{ user_id: string; voice_total: number }>(
    guildId,
    `SELECT user_id, voice_total FROM users
     WHERE guild_id = ? AND voice_total > 0
     ORDER BY voice_total DESC, user_id ASC LIMIT ?`,
    guildId,
    limit,
  );
