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

const authorized = (token: string) => ({ authorization: `Bearer ${token}` });

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

export const fetchSession = async (token: string): Promise<SessionInfo> => {
  const response = await fetch("/api/session", { headers: authorized(token) });
  return await parse(response) as SessionInfo;
};

export const fetchGraph = async (period: GraphPeriod, token: string, signal?: AbortSignal): Promise<GraphSnapshot> => {
  const response = await fetch(`/api/graph?period=${period}`, { headers: authorized(token), signal });
  return await parse(response) as GraphSnapshot;
};

/**
 * 아바타는 `<img>`가 읽는다. `<img>`에는 Authorization을 붙일 수 없으므로 베어러로 먼저 받아
 * object URL로 바꿔 두고, `avatarPath`를 그 URL로 갈아 끼운다. 토큰을 쿼리로 넘기지 않는다.
 * 돌려준 URL은 화면에 올린 뒤에 해제한다. 실패한 아바타는 null이 되어 이니셜로 떨어진다.
 */
export const hydrateAvatars = async (
  snapshot: GraphSnapshot,
  token: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const created: string[] = [];
  try {
    await Promise.all(snapshot.nodes.map(async (node) => {
      const path = node.avatarPath;
      if (!path) return;
      const response = await fetch(path, { headers: authorized(token), signal }).catch(() => null);
      signal?.throwIfAborted();
      if (!response?.ok) {
        node.avatarPath = null;
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      created.push(url);
      node.avatarPath = url;
    }));
    return created;
  } catch (error) {
    // 중간에 끊기면 이미 만든 URL만 정리하고 다시 던진다. 부른 쪽이 해제할 목록은 없다.
    for (const url of created) URL.revokeObjectURL(url);
    throw error;
  }
};
