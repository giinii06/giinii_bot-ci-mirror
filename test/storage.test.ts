import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

process.env.DISCORD_BOT_TOKEN = "test-token";
process.env.AI_PROVIDER = "opencode_zen";
process.env.AI_MODEL = "big-pickle";
process.env.FALLBACK_AI_MODEL = "mimo-v2.5-free";
process.env.OPENCODE_ZEN_API_KEY = "test-key";
process.env.NVIDIA_NIM_API_KEY = "test-nvidia-key";
const directory = mkdtempSync(join(tmpdir(), "giinii-board-"));
const databasePath = join(directory, "bot.sqlite");
const legacyDb = new Database(databasePath);
legacyDb.exec(`
  CREATE TABLE command_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
    user_name TEXT NOT NULL, command_name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    output TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
  CREATE TABLE settings (guild_id TEXT PRIMARY KEY, target_role_id TEXT);
  INSERT INTO settings (guild_id, target_role_id) VALUES ('guild', 'new-role');
  CREATE TABLE roulette_target_roles (guild_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (guild_id, role_id));
  INSERT INTO roulette_target_roles (guild_id, role_id) VALUES ('guild', 'old-role')
`);
legacyDb.close();
process.env.DATABASE_PATH = databasePath;

const storage = await import("../src/storage.js");
const { askGemini } = await import("../src/gemini.js");

test("migrates and stores AI questions in command logs", () => {
  storage.initDatabase();
  storage.insertCommandLog({
    guildId: "guild", channelId: "channel", userId: "user", userName: "tester",
    commandName: "question", question: "최근 분위기는?", provider: "gemini", model: "test-model", output: "평온합니다."
  });

  expect(storage.sql<{ question: string; output: string }>("SELECT question, output FROM command_logs LIMIT 1")).toEqual({
    question: "최근 분위기는?", output: "평온합니다."
  });
});

test("does not overwrite a configured target role during migration", () => {
  expect(storage.sql<{ target_role_id: string }>("SELECT target_role_id FROM settings WHERE guild_id = ?", "guild"))
    .toEqual({ target_role_id: "new-role" });
});

test("falls back to the configured model after an AI request error", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let fallbackCalled = false;
  globalThis.fetch = (async (_input, init) => {
    requests.push(String(init?.body));
    if (requests.length === 1) throw new Error("primary request failed");
    return new Response(JSON.stringify({ choices: [{ message: { content: "fallback answer" } }] }), { status: 200 });
  }) as typeof fetch;

  try {
    await expect(askGemini("질문", "기록", undefined, "프롬프트", { onFallback: () => { fallbackCalled = true; } }))
      .resolves.toBe("fallback answer");
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(fallbackCalled).toBe(true);
  expect(requests).toHaveLength(2);
  expect(JSON.parse(requests[1]!).model).toBe("mimo-v2.5-free");
});

test("uses provider and model overrides for concurrent playground requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; model: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    requests.push({ url: String(input), model: body.model });
    return new Response(JSON.stringify({ choices: [{ message: { content: body.model } }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      askGemini("질문 A", "기록", undefined, "프롬프트", {
        provider: "opencode_zen", model: "mimo-v2.5-free", allowFallback: false
      }),
      askGemini("질문 B", "기록", undefined, "프롬프트", {
        provider: "nvidia_nim", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", allowFallback: false
      })
    ]);
    expect([first, second].sort()).toEqual(["mimo-v2.5-free", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(requests).toHaveLength(2);
  expect(requests.some((request) => request.url.includes("opencode.ai") && request.model === "mimo-v2.5-free")).toBe(true);
  expect(requests.some((request) => request.url.includes("integrate.api.nvidia.com") && request.model === "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")).toBe(true);
});

afterAll(() => {
  storage.db.close();
  rmSync(directory, { recursive: true, force: true });
});
