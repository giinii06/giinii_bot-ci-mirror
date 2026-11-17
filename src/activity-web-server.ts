import { join } from "node:path";
import { createAvatarProxy, type AvatarImage } from "./activity-avatar.js";
import {
  REVERIFY_MS, createSession, findSession, markSessionVerified, revokeSession,
  type ActivitySession,
} from "./activity-auth.js";
import type { DiscordActivityAuth } from "./activity-discord.js";
import { isGraphPeriod, type GraphPeriod, type GraphSnapshot } from "./voice-graph-contract.js";

export type ActivityWebDeps = {
  clientId: string;
  discord: DiscordActivityAuth;
  distDir: string;
  snapshot: (guildId: string, period: GraphPeriod) => Promise<GraphSnapshot | null>;
  avatarUrl: (guildId: string, userId: string) => string | null;
  checkMember: (guildId: string, userId: string) => Promise<boolean>;
  commandEnabled: (guildId: string) => boolean;
  clock?: () => number;
  fetchImage?: (url: string) => Promise<AvatarImage | null>;
};

const AVATAR_PREFIX = "/api/graph/avatar/";
const BEARER_PREFIX = "bearer ";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // 디스코드 클라이언트가 iframe으로 띄운다. 다른 사이트가 감싸는 것은 여전히 막는다.
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self'; connect-src 'self'; worker-src 'self' blob:; "
    + "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });

const failure = (status: number, error: string, headers: Record<string, string> = {}) =>
  json({ error }, status, headers);

const bearerToken = (request: Request): string | undefined => {
  const header = request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith(BEARER_PREFIX)) return undefined;
  return header.slice(BEARER_PREFIX.length).trim() || undefined;
};

const clientKey = (request: Request) => {
  // Funnel이 앞에 붙인 실제 홉을 쓴다. 클라이언트가 보낸 첫 값은 위조할 수 있다.
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",").map((part) => part.trim()).filter(Boolean);
  return forwarded?.at(-1) || request.headers.get("x-real-ip")?.trim() || "local";
};

const createLimiter = (limit: number, windowMs: number) => {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now: number) => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size > 4096) for (const [entry, value] of buckets) if (value.resetAt <= now) buckets.delete(entry);
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  };
};

const readJson = async (request: Request): Promise<Record<string, unknown> | null> => {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? body as Record<string, unknown> : null;
};

/** 깨진 퍼센트 인코딩은 URIError로 올라와 500이 된다. 경로가 잘못된 것이므로 null로 낮춘다. */
const decodeSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/**
 * Activity SPA가 쓰는 HTTP 표면. 서버는 JSON과 정적 파일만 돌려주며
 * WebGL·물리 계산은 전부 브라우저에서 일어난다.
 */
export const createActivityHandler = (deps: ActivityWebDeps) => {
  const clock = deps.clock ?? Date.now;
  const avatars = createAvatarProxy(clock);
  const fetchImage = deps.fetchImage ?? avatars.load;
  const sessionLimit = createLimiter(10, 60_000);
  const graphLimit = createLimiter(120, 60_000);
  const avatarLimit = createLimiter(300, 60_000);

  const requireSession = async (request: Request, now: number): Promise<ActivitySession | null> => {
    const session = findSession(bearerToken(request), now);
    if (!session) return null;
    // 토큰이 다른 Activity 인스턴스로 옮겨 쓰이지 않게 요청마다 확인한다.
    const instanceId = request.headers.get("x-activity-instance")?.trim();
    if (!instanceId || instanceId !== session.instanceId) return null;
    if (now - session.verifiedAt <= REVERIFY_MS) return session;
    const allowed = deps.commandEnabled(session.guildId)
      && await deps.checkMember(session.guildId, session.userId).catch(() => false);
    if (!allowed) {
      revokeSession(session.id);
      return null;
    }
    markSessionVerified(session, now);
    return session;
  };

  /**
   * 클라이언트가 보낸 것은 코드와 인스턴스 ID 둘뿐이다. 길드 ID와 유저 ID는
   * 각각 인스턴스 조회와 코드 교환에서만 나오므로 요청 본문으로는 바꿀 수 없다.
   */
  const handleActivitySession = async (request: Request, now: number): Promise<Response> => {
    if (!sessionLimit(clientKey(request), now)) return failure(429, "rate_limited");
    const body = await readJson(request);
    const code = typeof body?.code === "string" ? body.code : "";
    const instanceId = typeof body?.instanceId === "string" ? body.instanceId : "";
    if (!code || !instanceId) return failure(400, "invalid_request");

    let instance = await deps.discord.resolveInstance(instanceId);
    if (!instance) return failure(403, "activity_instance_unavailable");
    if (!deps.commandEnabled(instance.guildId)) return failure(403, "command_disabled");

    const identity = await deps.discord.exchangeCode(code);
    if (!identity) return failure(401, "oauth_failed");
    // 방금 입장한 유저가 인스턴스 참가자 목록에 아직 반영되지 않을 수 있다. 짧게 다시 확인한다.
    for (let attempt = 0; attempt < 2 && !instance.userIds.includes(identity.userId); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const refreshed = await deps.discord.resolveInstance(instanceId);
      if (!refreshed || refreshed.guildId !== instance.guildId) break;
      instance = refreshed;
    }
    if (!instance.userIds.includes(identity.userId)) return failure(403, "not_in_activity");
    if (!await deps.checkMember(instance.guildId, identity.userId).catch(() => false)) {
      return failure(403, "not_a_member");
    }

    const session = createSession(instance.guildId, identity.userId, instanceId, now);
    return json({ token: session.id, guildId: session.guildId, userId: session.userId, expiresAt: session.expiresAt });
  };

  const handleApi = async (request: Request, url: URL, now: number): Promise<Response> => {
    const path = url.pathname;

    if (path === "/api/activity/config") {
      if (request.method !== "GET") return failure(405, "method_not_allowed");
      return json({ clientId: deps.clientId });
    }

    if (path === "/api/session/activity") {
      if (request.method !== "POST") return failure(405, "method_not_allowed");
      return handleActivitySession(request, now);
    }

    const session = await requireSession(request, now);

    if (path === "/api/session") {
      if (request.method !== "GET") return failure(405, "method_not_allowed");
      if (!session) return failure(401, "unauthorized");
      return json({ guildId: session.guildId, userId: session.userId, expiresAt: session.expiresAt });
    }

    if (path === "/api/graph") {
      if (request.method !== "GET") return failure(405, "method_not_allowed");
      if (!session) return failure(401, "unauthorized");
      if (!graphLimit(session.id, now)) return failure(429, "rate_limited");
      const period = url.searchParams.get("period") ?? "all";
      if (!isGraphPeriod(period)) return failure(422, "invalid_period");
      const started = performance.now();
      const snapshot = await deps.snapshot(session.guildId, period).catch(() => null);
      if (!snapshot) return failure(404, "guild_unavailable");
      // 프록시 왕복과 서버 계산을 분리해서 읽는다. 브라우저는 같은 출처라 헤더를 볼 수 있다.
      return json(snapshot, 200, { "server-timing": `graph;dur=${Math.round(performance.now() - started)}` });
    }

    if (path.startsWith(AVATAR_PREFIX)) {
      if (request.method !== "GET") return failure(405, "method_not_allowed");
      if (!session) return failure(401, "unauthorized");
      if (!avatarLimit(session.id, now)) return failure(429, "rate_limited");
      const userId = decodeSegment(path.slice(AVATAR_PREFIX.length));
      if (!userId || !/^\d{1,32}$/.test(userId)) return failure(404, "not_found");
      const avatarSource = deps.avatarUrl(session.guildId, userId);
      if (!avatarSource) return failure(404, "not_found");
      const image = await fetchImage(avatarSource).catch(() => null);
      if (!image) return failure(404, "not_found");
      return new Response(image.bytes, {
        headers: {
          "content-type": image.contentType,
          "content-length": String(image.bytes.byteLength),
          "cache-control": "private, max-age=300",
          ...SECURITY_HEADERS,
        },
      });
    }

    return failure(404, "not_found");
  };

  const serveStatic = async (pathname: string): Promise<Response> => {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relative.includes("..") || relative.includes("\0")) return failure(404, "not_found");
    const file = Bun.file(join(deps.distDir, relative));
    if (await file.exists()) {
      const immutable = relative.startsWith("assets/");
      return new Response(file, {
        headers: {
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
          ...SECURITY_HEADERS,
        },
      });
    }
    if (!relative.includes(".")) {
      const index = Bun.file(join(deps.distDir, "index.html"));
      if (await index.exists()) {
        return new Response(index, { headers: { "cache-control": "no-cache", ...SECURITY_HEADERS } });
      }
    }
    return failure(404, "not_found");
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const now = clock();
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(request, url, now);
    if (request.method !== "GET" && request.method !== "HEAD") return failure(405, "method_not_allowed");
    return serveStatic(url.pathname);
  };
};

export const startActivityWebServer = (
  deps: ActivityWebDeps & { hostname: string; port: number },
) => Bun.serve({
  hostname: deps.hostname,
  port: deps.port,
  maxRequestBodySize: 64 * 1024,
  fetch: createActivityHandler(deps),
});
