import type { GraphPeriod, GraphSnapshot } from "../../src/voice-graph-contract.js";

export type SessionInfo = { guildId: string; userId: string; expiresAt: number };
export type ActivityConfig = { clientId: string };
/** 세션을 새로 만들 때만 토큰이 함께 온다. 이후 요청은 헤더로만 보낸다. */
export type IssuedSession = SessionInfo & { token: string };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

const parse = async (response: Response): Promise<unknown> => {
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  throw new ApiError(response.status, (body as { error?: string } | null)?.error ?? "request_failed");
};

const authorized = (token: string, instanceId: string) => ({
  authorization: `Bearer ${token}`,
  "x-activity-instance": instanceId,
});

export const fetchActivityConfig = async (): Promise<ActivityConfig> => {
  const response = await fetch("/api/activity/config");
  return await parse(response) as ActivityConfig;
};

export const createSession = async (code: string, instanceId: string): Promise<IssuedSession> => {
  const response = await fetch("/api/session/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, instanceId }),
  });
  return await parse(response) as IssuedSession;
};

export const fetchSession = async (token: string, instanceId: string): Promise<SessionInfo> => {
  const response = await fetch("/api/session", { headers: authorized(token, instanceId) });
  return await parse(response) as SessionInfo;
};

export const fetchGraph = async (
  period: GraphPeriod, token: string, instanceId: string, signal?: AbortSignal,
): Promise<GraphSnapshot> => {
  const response = await fetch(`/api/graph?period=${period}`, { headers: authorized(token, instanceId), signal });
  return await parse(response) as GraphSnapshot;
};

/**
 * 아바타는 `<img>`가 읽는다. `<img>`에는 Authorization을 붙일 수 없으므로 베어러로 먼저 받아
 * object URL로 바꿔 둔다. 토큰을 쿼리로 넘기지 않는다.
 *
 * 첫 3D 화면은 아바타를 기다리지 않는다. 디스코드 프록시에서 아바타 한 장이 5초까지 걸리므로
 * 전부 기다리면 그만큼 검은 화면이 남는다. 요청은 지금 시작하고, 도착한 것만 나중에 끼운다.
 * `urls`는 살아 있는 목록이라 도착하는 대로 늘어난다. 화면에 붙인 뒤에 해제한다.
 */
export type AvatarSource = {
  urls: string[];
  resolve: (userId: string) => Promise<string | null>;
};

export const startAvatars = (
  snapshot: GraphSnapshot,
  token: string,
  instanceId: string,
  signal?: AbortSignal,
): AvatarSource => {
  const urls: string[] = [];
  const pending = new Map<string, Promise<string | null>>();
  for (const node of snapshot.nodes) {
    const path = node.avatarPath;
    // 이 경로는 인증이 필요하다. 3D 쪽이 그대로 <img>에 넣지 않도록 비운다.
    node.avatarPath = null;
    if (!path?.startsWith("/api/graph/avatar/")) continue;
    pending.set(node.id, (async () => {
      const response = await fetch(path, { headers: authorized(token, instanceId), signal }).catch(() => null);
      signal?.throwIfAborted();
      if (!response?.ok) return null;
      const url = URL.createObjectURL(await response.blob());
      urls.push(url);
      return url;
    })().catch(() => null));
  }
  return { urls, resolve: (userId) => pending.get(userId) ?? Promise.resolve(null) };
};
