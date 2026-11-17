import { expect, test } from "bun:test";
import { createDiscordActivityAuth } from "../src/activity-discord.js";

const apiBase = "https://api.test/v10";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 요청을 기록하고 정해진 응답을 돌려주는 fetch. 실제 디스코드 API는 부르지 않는다. */
const recorder = (handler: (url: string) => Response) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};

const auth = (fetchImpl: typeof fetch) => createDiscordActivityAuth({
  clientId: "app1", clientSecret: "secret1", botToken: "bot1", apiBase, fetchImpl,
});

const header = (init: RequestInit | undefined, name: string) =>
  new Headers(init?.headers).get(name);

test("reads the guild from a guild-instance activity instance with the bot token", async () => {
  const { fetchImpl, calls } = recorder(() => json({
    application_id: "app1", instance_id: "i-abc",
    location: { kind: "gc", guild_id: "g1", channel_id: "c1" },
    users: ["u1", "u2"],
  }));

  expect(await auth(fetchImpl).resolveInstance("i-abc")).toEqual({ guildId: "g1", userIds: ["u1", "u2"] });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(`${apiBase}/applications/app1/activity-instances/i-abc`);
  expect(header(calls[0]!.init, "authorization")).toBe("Bot bot1");
});

test("rejects an instance that belongs to another application or another instance id", async () => {
  const otherApp = recorder(() => json({
    application_id: "app2", instance_id: "i-abc",
    location: { kind: "gc", guild_id: "g1" }, users: ["u1"],
  }));
  expect(await auth(otherApp.fetchImpl).resolveInstance("i-abc")).toBeNull();

  const otherInstance = recorder(() => json({
    application_id: "app1", instance_id: "i-other",
    location: { kind: "gc", guild_id: "g1" }, users: ["u1"],
  }));
  expect(await auth(otherInstance.fetchImpl).resolveInstance("i-abc")).toBeNull();
});

test("treats a DM or group-DM instance as unusable", async () => {
  const { fetchImpl } = recorder(() => json({
    application_id: "app1", instance_id: "i-abc",
    location: { kind: "pc", channel_id: "c1" },
    users: ["u1"],
  }));
  expect(await auth(fetchImpl).resolveInstance("i-abc")).toBeNull();
});

test("rejects a malformed instance id without calling Discord", async () => {
  const { fetchImpl, calls } = recorder(() => json({ location: { kind: "gc", guild_id: "g1" }, users: [] }));
  const resolve = auth(fetchImpl).resolveInstance;

  expect(await resolve("")).toBeNull();
  expect(await resolve("abc")).toBeNull();
  expect(await resolve("i_abc")).toBeNull();
  expect(await resolve(`i-${"a".repeat(200)}`)).toBeNull();
  expect(calls).toHaveLength(0);
});

test("returns null when the instance lookup fails or the payload is unusable", async () => {
  const failed = recorder(() => json({ message: "Missing Access" }, 403));
  expect(await auth(failed.fetchImpl).resolveInstance("i-abc")).toBeNull();

  const noUsers = recorder(() => json({ application_id: "app1", instance_id: "i-abc", location: { kind: "gc", guild_id: "g1" } }));
  expect(await auth(noUsers.fetchImpl).resolveInstance("i-abc")).toBeNull();

  const noGuild = recorder(() => json({ application_id: "app1", instance_id: "i-abc", location: { kind: "gc" }, users: [] }));
  expect(await auth(noGuild.fetchImpl).resolveInstance("i-abc")).toBeNull();

  const notJson = recorder(() => new Response("<html>nope</html>", { status: 200 }));
  expect(await auth(notJson.fetchImpl).resolveInstance("i-abc")).toBeNull();
});

test("exchanges an OAuth code for the user id behind it", async () => {
  const { fetchImpl, calls } = recorder((url) => url.endsWith("/oauth2/token")
    ? json({ access_token: "at1", token_type: "Bearer" })
    : json({ id: "u1", username: "가" }));

  expect(await auth(fetchImpl).exchangeCode("the-code")).toEqual({ userId: "u1" });
  expect(calls).toHaveLength(2);

  const [exchange, profile] = calls;
  expect(exchange!.url).toBe(`${apiBase}/oauth2/token`);
  expect(exchange!.init?.method).toBe("POST");
  expect(header(exchange!.init, "content-type")).toBe("application/x-www-form-urlencoded");
  const form = new URLSearchParams(String(exchange!.init?.body));
  expect(form.get("client_id")).toBe("app1");
  expect(form.get("client_secret")).toBe("secret1");
  expect(form.get("grant_type")).toBe("authorization_code");
  expect(form.get("code")).toBe("the-code");

  expect(profile!.url).toBe(`${apiBase}/users/@me`);
  expect(header(profile!.init, "authorization")).toBe("Bearer at1");
});

test("returns null when the token exchange is rejected and skips the profile call", async () => {
  const { fetchImpl, calls } = recorder(() => json({ error: "invalid_grant" }, 400));
  expect(await auth(fetchImpl).exchangeCode("the-code")).toBeNull();
  expect(calls).toHaveLength(1);
});

test("returns null when the exchange has no access token or the profile fails", async () => {
  const noToken = recorder(() => json({ token_type: "Bearer" }));
  expect(await auth(noToken.fetchImpl).exchangeCode("the-code")).toBeNull();

  const profileFails = recorder((url) => url.endsWith("/oauth2/token") ? json({ access_token: "at1" }) : json({}, 401));
  expect(await auth(profileFails.fetchImpl).exchangeCode("the-code")).toBeNull();

  const noId = recorder((url) => url.endsWith("/oauth2/token") ? json({ access_token: "at1" }) : json({ username: "가" }));
  expect(await auth(noId.fetchImpl).exchangeCode("the-code")).toBeNull();
});

test("rejects an empty or oversized code without calling Discord", async () => {
  const { fetchImpl, calls } = recorder(() => json({ access_token: "at1" }));
  const exchange = auth(fetchImpl).exchangeCode;

  expect(await exchange("")).toBeNull();
  expect(await exchange("c".repeat(513))).toBeNull();
  expect(calls).toHaveLength(0);
});
