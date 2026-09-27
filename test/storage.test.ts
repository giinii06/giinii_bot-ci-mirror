import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ChannelType, type Guild } from "discord.js";
import type { HistoryMessage } from "../src/history.js";

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
const { isDefenseSuccess } = await import("../src/roulette.js");
const { ensureGuildChatStats, recordChatCounts } = await import("../src/activity.js");
const { collectDiscordHistoryInBatches } = await import("../src/history.js");
const { loadStatisticsRows, mergeStatisticsRows } = await import("../src/voice-affinity-command.js");

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

test("persists roulette role settings in SQLite", () => {
  storage.initDatabase();
  storage.run(`INSERT INTO settings (guild_id, target_role_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET target_role_id = excluded.target_role_id`, "persist-guild", "target-role");
  storage.run("INSERT INTO admin_target_roles (guild_id, role_id) VALUES (?, ?)", "persist-guild", "admin-role");
  storage.run("INSERT INTO admin_defense_roles (guild_id, role_id) VALUES (?, ?)", "persist-guild", "defense-role");

  const reopened = new Database(databasePath);
  expect(reopened.query("SELECT target_role_id FROM settings WHERE guild_id = ?").get("persist-guild"))
    .toEqual({ target_role_id: "target-role" });
  expect(reopened.query("SELECT role_id FROM admin_target_roles WHERE guild_id = ?").get("persist-guild"))
    .toEqual({ role_id: "admin-role" });
  expect(reopened.query("SELECT role_id FROM admin_defense_roles WHERE guild_id = ?").get("persist-guild"))
    .toEqual({ role_id: "defense-role" });
  reopened.close();
});

test("uses a 65 percent defense boundary", () => {
  expect(isDefenseSuccess(0.64)).toBe(true);
  expect(isDefenseSuccess(0.65)).toBe(false);
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

const BACKFILL_GUILD = "backfill-guild";
const BASE_TIME = Date.UTC(2026, 0, 15, 12, 0, 0);

let messageSeq = 0;
const nextFakeMessage = (authorId: string, bot = false) => {
  messageSeq += 1;
  return {
    id: String(1_000_000_000_000_000_000n + BigInt(messageSeq)),
    authorId,
    bot,
    content: `메시지 ${messageSeq}`,
    createdAt: BASE_TIME + messageSeq * 60_000
  };
};

type FakeMessage = ReturnType<typeof nextFakeMessage>;
type ChannelSpec = { id: string; name: string; messages: FakeMessage[] };

const HISTORY_CHANNELS: ChannelSpec[] = (() => {
  const authors = ["u1", "u2", "u3", "u4", "u5", "u6"];
  const build = (id: string, name: string, count: number): ChannelSpec => {
    const messages: FakeMessage[] = [];
    for (let index = 0; index < count; index += 1) {
      const bot = index % 10 === 0;
      messages.push(nextFakeMessage(bot ? "bot" : authors[index % authors.length] ?? "u1", bot));
    }
    return { id, name, messages };
  };
  return [build("c1", "하나", 250), build("c2", "둘", 180), build("c3", "셋", 97)];
})();

const HISTORY_TOTAL = HISTORY_CHANNELS.reduce((sum, channel) => sum + channel.messages.length, 0);
const HISTORY_BOT_MESSAGES = HISTORY_CHANNELS.reduce(
  (sum, channel) => sum + channel.messages.filter((message) => message.bot).length, 0);

class FakeCollection<T> extends Map<string, T> {
  last(): T | undefined {
    let oldest: T | undefined;
    for (const value of this.values()) oldest = value;
    return oldest;
  }
}

const toDiscordMessage = (message: FakeMessage) => ({
  id: message.id,
  author: { id: message.authorId, bot: message.bot, displayName: `user-${message.authorId}`, username: `user-${message.authorId}` },
  member: { displayName: `user-${message.authorId}` },
  createdTimestamp: message.createdAt,
  cleanContent: message.content,
  attachments: { size: 0, values: () => [] },
  stickers: { size: 0, values: () => [] }
});

/** 디스코드가 실제로 하는 것과 같은 커서 규칙(최신순, before는 exclusive, 100개)으로 페이징한다. */
const createFakeGuild = (specs: ChannelSpec[], calls: { count: number }) => {
  const cache = new Map<string, unknown>();
  const guild = {
    id: BACKFILL_GUILD,
    name: "백필 서버",
    roles: { everyone: {} },
    channels: { fetch: async () => cache, cache }
  } as unknown as Guild;

  for (const spec of specs) {
    const ordered = [...spec.messages].sort((left, right) => (left.id < right.id ? -1 : 1));
    cache.set(spec.id, {
      id: spec.id,
      guild,
      name: spec.name,
      type: ChannelType.GuildText,
      position: 0,
      permissionsFor: () => ({ has: () => true }),
      messages: {
        fetch: async ({ limit, before }: { limit: number; before?: string }) => {
          calls.count += 1;
          const older = before ? ordered.filter((message) => message.id < before) : ordered;
          const page = older.slice(Math.max(0, older.length - limit));
          return new FakeCollection(page.reverse().map((message) => [message.id, toDiscordMessage(message)]));
        }
      }
    });
  }
  return guild;
};

const historyMessage = (guildId: string, authorId: string, bot = false): HistoryMessage => {
  const message = nextFakeMessage(authorId, bot);
  return {
    messageId: message.id, guildId, channelId: "c1", channelName: "하나",
    authorId, authorName: `user-${authorId}`, authorIsBot: bot, content: message.content,
    createdTimestamp: message.createdAt
  };
};

const drainGuild = async (guild: Guild, guildId: string) => {
  let inserted = 0;
  const history = await collectDiscordHistoryInBatches(guild, {
    batchSize: 100,
    storedRanges: storage.fetchStoredChannelRanges(guildId)
  }, async (messages) => {
    const fresh = storage.upsertMessages(messages);
    recordChatCounts(guildId, fresh);
    inserted += fresh.length;
  });
  return { ...history, inserted };
};

const storedCount = (guildId: string) =>
  storage.sql<{ total: number }>("SELECT COUNT(*) AS total FROM discord_messages WHERE guild_id = ?", guildId)?.total ?? 0;

const chatTotal = (guildId: string) =>
  storage.sql<{ total: number }>(
    "SELECT COALESCE(SUM(chat_count), 0) AS total FROM chat_stats WHERE guild_id = ? AND bucket_type = 'all'", guildId
  )?.total ?? 0;

test("stores every readable message of every channel when a guild is backfilled", async () => {
  storage.initDatabase();
  const calls = { count: 0 };
  const guild = createFakeGuild(HISTORY_CHANNELS, calls);

  const history = await drainGuild(guild, BACKFILL_GUILD);

  expect(history.inserted).toBe(HISTORY_TOTAL);
  expect(history.failedChannels).toBe(0);
  expect(history.scannedChannelCount).toBe(3);
  expect(storedCount(BACKFILL_GUILD)).toBe(HISTORY_TOTAL);
  expect(chatTotal(BACKFILL_GUILD)).toBe(HISTORY_TOTAL - HISTORY_BOT_MESSAGES);
});

test("skips the already stored range when the same guild is backfilled again", async () => {
  storage.initDatabase();
  const calls = { count: 0 };
  const guild = createFakeGuild(HISTORY_CHANNELS, calls);
  await drainGuild(guild, BACKFILL_GUILD);
  calls.count = 0;

  const history = await drainGuild(guild, BACKFILL_GUILD);

  expect(history.inserted).toBe(0);
  expect(storedCount(BACKFILL_GUILD)).toBe(HISTORY_TOTAL);
  expect(chatTotal(BACKFILL_GUILD)).toBe(HISTORY_TOTAL - HISTORY_BOT_MESSAGES);
  expect(calls.count).toBe(6);
});

test("counts a live message once when the same message is delivered twice", () => {
  storage.initDatabase();
  const message = historyMessage("live-guild", "l9");

  expect(recordChatCounts("live-guild", storage.upsertMessages([message]))).toBe(4);
  expect(recordChatCounts("live-guild", storage.upsertMessages([message]))).toBe(0);
  expect(chatTotal("live-guild")).toBe(1);
});

test("serves statistics chat counts from the whole database while live counters stay empty", () => {
  storage.initDatabase();
  const guildId = "stats-guild";
  const authors = ["s1", "s2", "s3", "s4", "s5"];
  for (let start = 0; start < 12_000; start += 500) {
    const batch = Array.from({ length: 500 }, (_, offset) => historyMessage(guildId, authors[(start + offset) % authors.length] ?? "s1"));
    recordChatCounts(guildId, storage.upsertMessages(batch));
  }

  const rows = loadStatisticsRows(guildId, "all", BASE_TIME + 86_400_000);

  expect(rows.reduce((sum, row) => sum + row.chat_count, 0)).toBe(12_000);
  expect(storage.sql<{ total: number }>(
    "SELECT COALESCE(SUM(chat_total), 0) AS total FROM users WHERE guild_id = ?", guildId)?.total).toBe(0);
});

test("rebuilds chat counts once for a guild whose history predates the precomputed table", () => {
  storage.initDatabase();
  const guildId = "legacy-guild";
  const stored = Array.from({ length: 300 }, (_, index) =>
    historyMessage(guildId, index % 3 === 0 ? "bot" : `l${index % 4}`, index % 3 === 0));
  storage.upsertMessages(stored);

  expect(ensureGuildChatStats(guildId)).toBeGreaterThan(0);
  expect(chatTotal(guildId)).toBe(200);
  expect(ensureGuildChatStats(guildId)).toBe(0);
});

test("keeps chat-only and voice-only users in the same statistics ranking", () => {
  expect(mergeStatisticsRows(
    [{ user_id: "a", chat_count: 5 }],
    [{ user_id: "a", voice_seconds: 60 }, { user_id: "b", voice_seconds: 30 }]
  )).toEqual([
    { user_id: "a", chat_count: 5, voice_seconds: 60 },
    { user_id: "b", chat_count: 0, voice_seconds: 30 }
  ]);
});

afterAll(() => {
  storage.db.close();
  rmSync(directory, { recursive: true, force: true });
});
