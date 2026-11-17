import { randomBytes } from "node:crypto";

/**
 * Activity가 들고 다니는 서버 세션. 세션 ID 자체가 베어러 토큰이고
 * 쿠키가 아니므로 브라우저가 임의로 붙일 수 있는 자격 증명이 아니다.
 * 길드와 유저는 세션을 만들 때 한 번 정해지며, 세션은 길드 멤버 재확인을 통과해야 유지된다.
 */
export type ActivitySession = {
  id: string;
  guildId: string;
  userId: string;
  /** 세션을 만든 Activity 인스턴스. 감사와 재검증의 기준점이다. */
  instanceId: string;
  expiresAt: number;
  /** 마지막으로 길드 멤버·명령 활성 여부를 확인한 시각 */
  verifiedAt: number;
};

export const SESSION_TTL_MS = 30 * 60_000;
/** 이 시간이 지난 세션은 다음 요청에서 멤버 자격을 다시 확인한다. */
export const REVERIFY_MS = 60_000;

const sessions = new Map<string, ActivitySession>();

const createId = () => randomBytes(32).toString("base64url");

const sweep = (now: number) => {
  if (sessions.size > 256) for (const [key, entry] of sessions) if (entry.expiresAt <= now) sessions.delete(key);
};

export const createSession = (
  guildId: string, userId: string, instanceId: string, now = Date.now(),
): ActivitySession => {
  sweep(now);
  const session: ActivitySession = {
    id: createId(),
    guildId,
    userId,
    instanceId,
    expiresAt: now + SESSION_TTL_MS,
    verifiedAt: now,
  };
  sessions.set(session.id, session);
  return session;
};

export const findSession = (id: string | undefined, now = Date.now()): ActivitySession | null => {
  if (!id) return null;
  // 만료된 세션은 다시 조회되지 않으면 남는다. 조회가 잦은 쪽에서도 한 번씩 쓸어낸다.
  if (sessions.size > 256) sweep(now);
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= now) {
    sessions.delete(id);
    return null;
  }
  return session;
};

export const markSessionVerified = (session: ActivitySession, now = Date.now()) => {
  session.verifiedAt = now;
};

export const revokeSession = (id: string | undefined) => {
  if (id) sessions.delete(id);
};

/** 테스트가 모듈 상태를 비울 때만 쓴다. */
export const resetActivityAuth = () => {
  sessions.clear();
};
