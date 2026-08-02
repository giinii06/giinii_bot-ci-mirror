export type VoiceInterval = {
  user_id: string;
  channel_id: string;
  started_at: number;
  ended_at: number | null;
};

export type VoiceAffinity = {
  user_id: string;
  shared_ms: number;
  last_together_at: number;
};

export function buildVoiceAffinity(
  targetSessions: VoiceInterval[],
  otherSessions: VoiceInterval[],
  now: number,
): VoiceAffinity[] {
  const totals = new Map<string, VoiceAffinity>();

  for (const target of targetSessions) {
    const targetUserId = String(target.user_id).trim();
    const targetEnd = target.ended_at ?? now;
    for (const other of otherSessions) {
      const otherUserId = String(other.user_id).trim();
      if (target.channel_id !== other.channel_id || targetUserId === otherUserId) continue;
      const start = Math.max(target.started_at, other.started_at);
      const end = Math.min(targetEnd, other.ended_at ?? now);
      if (end <= start) continue;

      const current = totals.get(otherUserId) ?? {
        user_id: otherUserId,
        shared_ms: 0,
        last_together_at: 0,
      };
      current.shared_ms += end - start;
      current.last_together_at = Math.max(current.last_together_at, end);
      totals.set(otherUserId, current);
    }
  }

  return [...totals.values()].sort(
    (a, b) => b.shared_ms - a.shared_ms || b.last_together_at - a.last_together_at || a.user_id.localeCompare(b.user_id),
  );
}
