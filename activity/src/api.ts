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
 * object URL로 바꿔 두고, `avatarPath`를 그 URL로 갈아 끼운다. 토큰을 쿼리로 넘기지 않는다.
 * 돌려준 URL은 화면에 올린 뒤에 해제한다. 실패한 아바타는 null이 되어 이니셜로 떨어진다.
 */
export const hydrateAvatars = async (
  snapshot: GraphSnapshot,
  token: string,
  instanceId: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  const created: string[] = [];
  try {
    await Promise.all(snapshot.nodes.map(async (node) => {
      const path = node.avatarPath;
      if (!path) return;
      // 스냅샷이 외부 URL을 들고 오면 베어러 토큰이 그쪽으로 나간다. 서버 경로만 받는다.
      if (!path.startsWith("/api/graph/avatar/")) {
        node.avatarPath = null;
        return;
      }
      const response = await fetch(path, { headers: authorized(token, instanceId), signal }).catch(() => null);
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
