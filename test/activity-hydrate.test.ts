import { expect, test } from "bun:test";
import { hydrateAvatars } from "../activity/src/api.js";
import type { GraphSnapshot } from "../src/voice-graph-contract.js";

const graph = (): GraphSnapshot => ({
  schemaVersion: 1,
  guildId: "g1",
  period: "all",
  fromMs: null,
  toMs: 1,
  generatedAtMs: 1,
  semantics: "shared_voice_channel_presence",
  nodes: [
    { id: "111", name: "가", avatarPath: "/api/graph/avatar/111", voiceMs: 10, community: null },
    { id: "222", name: "나", avatarPath: null, voiceMs: 5, community: null },
  ],
  links: [],
});

test("never sends the bearer to an avatar path outside the server route", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;

  globalThis.fetch = (async () => {
    fetched = true;
    return new Response(new Blob([new Uint8Array([1])], { type: "image/png" }));
  }) as unknown as typeof fetch;

  try {
    const snapshot = graph();
    snapshot.nodes[0]!.avatarPath = "https://evil.test/avatar.png";
    const urls = await hydrateAvatars(snapshot, "tok", "i-abc");

    expect(urls).toEqual([]);
    expect(snapshot.nodes[0]!.avatarPath).toBeNull();
    expect(fetched).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetches a protected avatar with the bearer and swaps in an object URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const seen: { url: string; auth: string | null; instance: string | null }[] = [];
  let created = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      auth: headers.get("authorization"),
      instance: headers.get("x-activity-instance"),
    });
    return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  }) as unknown as typeof fetch;
  URL.createObjectURL = (() => `blob:test/${++created}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  try {
    const snapshot = graph();
    const urls = await hydrateAvatars(snapshot, "tok", "i-abc");

    expect(urls).toEqual(["blob:test/1"]);
    expect(snapshot.nodes[0]!.avatarPath).toBe("blob:test/1");
    expect(snapshot.nodes[1]!.avatarPath).toBeNull();
    expect(seen).toEqual([{ url: "/api/graph/avatar/111", auth: "Bearer tok", instance: "i-abc" }]);
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
