export type HistoryEntry = {
  id: string;
  authorId: string;
  author: string;
  content: string;
  fromBot: boolean;
};

export class ChannelHistory {
  private readonly buckets = new Map<string, HistoryEntry[]>();

  constructor(private readonly limit: number) {}

  record(channelId: string, entry: HistoryEntry): void {
    const bucket = this.buckets.get(channelId) ?? [];
    bucket.push(entry);

    const overflow = bucket.length - (this.limit + 1);
    if (overflow > 0) bucket.splice(0, overflow);

    this.buckets.set(channelId, bucket);
  }

  recent(channelId: string, options: { excludeId?: string } = {}): HistoryEntry[] {
    const bucket = this.buckets.get(channelId) ?? [];
    const entries = options.excludeId
      ? bucket.filter((entry) => entry.id !== options.excludeId)
      : bucket;
    return entries.slice(-this.limit);
  }
}
