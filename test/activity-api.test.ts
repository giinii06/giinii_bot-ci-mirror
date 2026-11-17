import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVERIFY_MS, resetActivityAuth, SESSION_TTL_MS } from "../src/activity-auth.js";
import type { ActivityInstance, DiscordActivityAuth } from "../src/activity-discord.js";
import { createActivityHandler, startActivityWebServer, type ActivityWebDeps } from "../src/activity-web-server.js";
import type { GraphSnapshot } from "../src/voice-graph-contract.js";

const distDir = mkdtempSync(join(tmpdir(), "giinii-activity-"));
writeFileSync(
  join(distDir, "index.html"),
  "<!doctype html><html><head><title>graph</title></head><body><div id=\"scene\"></div></body></html>",
);

afterAll(() => rmSync(distDir, { recursive: true, force: true }));

const snapshot: GraphSnapshot = {
  schemaVersion: 1,
  guildId: "g1",
  period: "all",
  fromMs: null,
  toMs: 1_000_000,
  generatedAtMs: 1_000_000,
  semantics: "shared_voice_channel_presence",
  nodes: [
    { id: "111", name: "가", avatarPath: "/api/graph/avatar/111", voiceMs: 1000, community: null },
    { id: "222", name: "나", avatarPath: null, voiceMs: 500, community: null },
  ],
  links: [{ source: "111", target: "222", sharedMs: 400, kind: "mutual", visibleByDefault: true }],
};

const state = { now: 1_000_000, member: true, enabled: true };
const calls: { guildId: string; period: string }[] = [];
const memberChecks: { guildId: string; userId: string }[] = [];
const avatarCalls: { guildId: string; userId: string }[] = [];

// 인스턴스 조회와 코드 교환만 흉내 낸다. 실제 디스코드 API나 클라이언트 시크릿은 쓰지 않는다.
const instances = new Map<string, ActivityInstance>([
  ["i-abc", { guildId: "g1", userIds: ["u1"] }],
  ["i-two", { guildId: "g1", userIds: ["u1", "u2"] }],
]);
const codes = new Map<string, string>([["code-ok", "u1"], ["code-outsider", "u9"]]);
let lateCalls = 0;

const discord: DiscordActivityAuth = {
  resolveInstance: async (instanceId) => {
    // 방금 입장한 유저가 참가자 목록에 늦게 나타나는 상황을 흉내 낸다.
    if (instanceId === "i-late") {
      lateCalls += 1;
      return { guildId: "g1", userIds: lateCalls === 1 ? [] : ["u1"] };
    }
    return instances.get(instanceId) ?? null;
  },
  exchangeCode: async (code) => {
    const userId = codes.get(code);
    return userId ? { userId } : null;
  },
};

const deps: ActivityWebDeps = {
  clientId: "app1",
  discord,
  distDir,
  snapshot: async (guildId, period) => {
    calls.push({ guildId, period });
    return guildId === "g1" ? { ...snapshot, period } : null;
  },
  avatarUrl: (guildId, userId) => {
    avatarCalls.push({ guildId, userId });
    return userId === "111" ? "https://cdn.test/111.png" : null;
  },
  checkMember: async (guildId, userId) => {
    memberChecks.push({ guildId, userId });
    return state.member && guildId === "g1" && userId === "u1";
  },
  commandEnabled: () => state.enabled,
  fetchImage: async (url) => url === "https://cdn.test/111.png"
    ? { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" }
    : null,
  clock: () => state.now,
};

let handler = createActivityHandler(deps);

const call = (path: string, init: RequestInit = {}) =>
  handler(new Request(`https://graph.test${path}`, init));

const startSession = (body: Record<string, unknown>) =>
  call("/api/session/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const authed = (token: string, instanceId: string) => ({
  authorization: `Bearer ${token}`,
  "x-activity-instance": instanceId,
});

const openSession = async (instanceId = "i-abc", code = "code-ok") => {
  const response = await startSession({ code, instanceId });
  expect(response.status).toBe(200);
  const body = await response.json() as { token: string };
  return { token: body.token, instanceId };
};

beforeEach(() => {
  resetActivityAuth();
  handler = createActivityHandler(deps);
  calls.length = 0;
  memberChecks.length = 0;
  avatarCalls.length = 0;
  lateCalls = 0;
  state.now = 1_000_000;
  state.member = true;
  state.enabled = true;
});

test("publishes the client id before any session exists", async () => {
  const response = await call("/api/activity/config");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ clientId: "app1" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("opens a bearer session from an OAuth code and answers with it", async () => {
  const response = await startSession({ code: "code-ok", instanceId: "i-abc" });
  expect(response.status).toBe(200);
  const body = await response.json() as { token: string; guildId: string; userId: string; expiresAt: number };
  expect(body.guildId).toBe("g1");
  expect(body.userId).toBe("u1");
  expect(body.expiresAt).toBe(state.now + SESSION_TTL_MS);
  expect(body.token.length).toBeGreaterThanOrEqual(32);
  // 세션은 쿠키가 아니라 베어러 토큰이다. 브라우저가 자동으로 붙일 수 있는 자격 증명을 남기지 않는다.
  expect(response.headers.get("set-cookie")).toBeNull();

  const session = await call("/api/session", { headers: authed(body.token, "i-abc") });
  expect(session.status).toBe(200);
  expect(await session.json()).toEqual({ guildId: "g1", userId: "u1", expiresAt: body.expiresAt });
});

test("resumes a session only from the activity instance that issued it", async () => {
  const session = await openSession("i-abc");
  // 다른 인스턴스에서 저장된 토큰을 되살리려 하면 거절한다. 그러면 SPA가 새로 인증한다.
  const mismatch = await call("/api/session", { headers: authed(session.token, "i-two") });
  expect(mismatch.status).toBe(401);
  expect(await mismatch.json()).toEqual({ error: "unauthorized" });
  // 인스턴스를 아예 밝히지 않는 예전 형식도 통과시키지 않는다.
  expect((await call("/api/session", {
    headers: { authorization: `Bearer ${session.token}` },
  })).status).toBe(401);
  expect((await call("/api/session", { headers: authed(session.token, "i-abc") })).status).toBe(200);
});

test("takes the guild from the activity instance even when the body names another one", async () => {
  const response = await startSession({ code: "code-ok", instanceId: "i-abc", guildId: "g2", userId: "u1" });
  expect(response.status).toBe(200);
  expect((await response.json() as { guildId: string }).guildId).toBe("g1");

  const session = await openSession();
  const graph = await call("/api/graph?period=all", { headers: authed(session.token, session.instanceId) });
  expect(graph.status).toBe(200);
  expect(calls).toEqual([{ guildId: "g1", period: "all" }]);
  expect(memberChecks.every((check) => check.guildId === "g1")).toBe(true);
});

test("refuses a user the activity instance does not list", async () => {
  const response = await startSession({ code: "code-outsider", instanceId: "i-abc" });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "not_in_activity" });
  expect(calls).toEqual([]);
});

test("retries the instance when the participant list lags behind the OAuth exchange", async () => {
  const response = await startSession({ code: "code-ok", instanceId: "i-late" });
  expect(response.status).toBe(200);
  expect(lateCalls).toBe(2);
  expect((await response.json() as { guildId: string }).guildId).toBe("g1");
});

test("refuses an unknown instance and a code the exchange rejects", async () => {
  const unknown = await startSession({ code: "code-ok", instanceId: "i-missing" });
  expect(unknown.status).toBe(403);
  expect(await unknown.json()).toEqual({ error: "activity_instance_unavailable" });

  const badCode = await startSession({ code: "code-missing", instanceId: "i-abc" });
  expect(badCode.status).toBe(401);
  expect(await badCode.json()).toEqual({ error: "oauth_failed" });
});

test("refuses to open a session where the command is off or the user left the guild", async () => {
  state.enabled = false;
  const disabled = await startSession({ code: "code-ok", instanceId: "i-abc" });
  expect(disabled.status).toBe(403);
  expect(await disabled.json()).toEqual({ error: "command_disabled" });

  state.enabled = true;
  state.member = false;
  const outsider = await startSession({ code: "code-ok", instanceId: "i-abc" });
  expect(outsider.status).toBe(403);
  expect(await outsider.json()).toEqual({ error: "not_a_member" });
});

test("rejects a session body that is not JSON or misses a field", async () => {
  const notJson = await call("/api/session/activity", { method: "POST", body: "code=abc" });
  expect(notJson.status).toBe(400);
  expect(await notJson.json()).toEqual({ error: "invalid_request" });

  expect((await startSession({ instanceId: "i-abc" })).status).toBe(400);
  expect((await startSession({ code: "code-ok" })).status).toBe(400);
});

test("serves the snapshot only to a bearer session and rejects unknown periods", async () => {
  expect((await call("/api/graph?period=all")).status).toBe(401);
  expect((await call("/api/graph?period=all", { headers: authed("nope", "i-abc") })).status).toBe(401);
  // 링크 시절의 쿠키는 더 이상 어떤 경로로도 통하지 않는다.
  expect((await call("/api/graph?period=all", { headers: { cookie: "gfg_session=nope" } })).status).toBe(401);

  const session = await openSession();
  const ok = await call("/api/graph?period=7d", { headers: authed(session.token, session.instanceId) });
  expect(ok.status).toBe(200);
  const body = await ok.json() as GraphSnapshot;
  expect(body.period).toBe("7d");
  expect(body.nodes.map((node) => node.id)).toEqual(["111", "222"]);
  expect(ok.headers.get("cache-control")).toBe("private, no-store");
  expect(calls).toEqual([{ guildId: "g1", period: "7d" }]);
  expect((await call("/api/graph?period=1y", { headers: authed(session.token, session.instanceId) })).status).toBe(422);
});

test("proxies only avatars that belong to the current graph", async () => {
  const session = await openSession();
  const headers = authed(session.token, session.instanceId);
  const allowed = await call("/api/graph/avatar/111", { headers });
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await allowed.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  expect((await call("/api/graph/avatar/222", { headers })).status).toBe(404);
  expect((await call("/api/graph/avatar/abc", { headers })).status).toBe(404);
  // 아바타 조회도 세션의 길드로만 나간다. 다른 길드 ID가 섞이면 안 된다.
  expect(avatarCalls.length).toBeGreaterThan(0);
  expect(avatarCalls.every((entry) => entry.guildId === "g1")).toBe(true);
});

test("answers 404 for a malformed percent escape instead of failing", async () => {
  const session = await openSession();
  const response = await call("/api/graph/avatar/%E0%A4%A", { headers: authed(session.token, session.instanceId) });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});

test("re-checks membership after the freshness window and fails closed", async () => {
  const session = await openSession();
  const headers = authed(session.token, session.instanceId);
  state.now += REVERIFY_MS + 1;
  expect((await call("/api/graph?period=all", { headers })).status).toBe(200);
  state.now += REVERIFY_MS + 1;
  state.member = false;
  expect((await call("/api/graph?period=all", { headers })).status).toBe(401);
  expect((await call("/api/session", { headers })).status).toBe(401);
});

test("expires the session after its lifetime", async () => {
  const session = await openSession();
  state.now += SESSION_TTL_MS + 1;
  expect((await call("/api/session", { headers: authed(session.token, session.instanceId) })).status).toBe(401);
});

test("serves the built index and nothing outside it", async () => {
  const index = await call("/");
  expect(index.status).toBe(200);
  expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await index.text()).toContain("graph");
  expect((await call("/package.json")).status).toBe(404);
  expect((await call("/api")).status).toBe(404);
  expect((await call("/api/unknown")).status).toBe(404);
});

test("inlines the client id into the index so the first paint needs no extra request", async () => {
  const index = await call("/");
  expect(await index.text()).toContain('<meta name="activity-client-id" content="app1">');
  // SPA 경로도 같은 문서를 받으므로 설정이 함께 실린다.
  const spa = await call("/graph/anything");
  expect(spa.status).toBe(200);
  expect(await spa.text()).toContain('content="app1"');
});

test("limits repeated session attempts from one client", async () => {
  const attempt = () => call("/api/session/activity", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ code: "code-missing", instanceId: "i-abc" }),
  });
  for (let round = 0; round < 10; round += 1) {
    expect((await attempt()).status).toBe(401);
  }
  expect((await attempt()).status).toBe(429);
});

test("keys the session limit on the last forwarded hop, not a spoofable first one", async () => {
  const attempt = (forwardedFor: string) => call("/api/session/activity", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
    body: JSON.stringify({ code: "code-missing", instanceId: "i-abc" }),
  });
  for (let round = 0; round < 10; round += 1) {
    expect((await attempt("spoofed, 203.0.113.7")).status).toBe(401);
  }
  expect((await attempt("spoofed, 203.0.113.7")).status).toBe(429);
  expect((await attempt("spoofed, 203.0.113.8")).status).toBe(401);
});

test("starts on a real port and serves the built index", async () => {
  const server = startActivityWebServer({ ...deps, hostname: "127.0.0.1", port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("graph");
  } finally {
    server.stop(true);
  }
});
