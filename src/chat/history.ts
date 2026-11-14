export type HistoryEntry = {
  id: string;
  authorId: string;
  author: string;
  content: string;
  fromBot: boolean;
  /** Decision 모델에 "몇 초 전 발언인지"를 넘기기 위해 필요하다. */
  createdAt: number;
};

const IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_CHANNELS = 100;

export class ChannelHistory {
  private readonly buckets = new Map<string, HistoryEntry[]>();

  constructor(private readonly limit: number) {}

  record(channelId: string, entry: HistoryEntry): void {
    const bucket = this.buckets.get(channelId) ?? [];
    // 같은 메시지를 두 번 기록하면 Decision 문맥에 중복으로 들어간다.
    if (bucket.some((existing) => existing.id === entry.id)) return;

    bucket.push(entry);

    const overflow = bucket.length - (this.limit + 1);
    if (overflow > 0) bucket.splice(0, overflow);

    this.buckets.set(channelId, bucket);
    if (this.buckets.size > MAX_CHANNELS) this.pruneStale(entry.createdAt);
  }

  recent(channelId: string, options: { excludeId?: string } = {}): HistoryEntry[] {
    const bucket = this.buckets.get(channelId) ?? [];
    const entries = options.excludeId
      ? bucket.filter((entry) => entry.id !== options.excludeId)
      : bucket;
    return entries.slice(-this.limit);
  }

  /** 오래 조용한 채널의 캐시를 버린다. 기록이 없는 채널만 정리한다. */
  pruneStale(now = Date.now()): void {
    for (const [channelId, bucket] of this.buckets) {
      const last = bucket.at(-1);
      if (!last || now - last.createdAt > IDLE_MS) this.buckets.delete(channelId);
    }
  }
}
