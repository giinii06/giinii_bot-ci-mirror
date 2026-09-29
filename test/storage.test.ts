import { existsSync, mkdirSync, statSync, writeFileSync, createReadStream, createWriteStream, readFileSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { ChannelType, type Guild } from "discord.js";
import type { HistoryMessage, MediaRecord, MessageProfile } from "../src/history.js";

process.env.DISCORD_BOT_TOKEN = "test-token";
process.env.AI_PROVIDER = "opencode_zen";
process.env.AI_MODEL = "big-pickle";
process.env.FALLBACK_AI_MODEL = "mimo-v2.5-free";
process.env.OPENCODE_ZEN_API_KEY = "test-key";
process.env.NVIDIA_NIM_API_KEY = "test-nvidia-key";
const directory = mkdtempSync(join(tmpdir(), "giinii-board-"));
process.env.DATABASE_PATH = join(directory, "bot.sqlite");

const storage = await import("../src/storage.js");
const { askGemini } = await import("../src/gemini.js");
const { isDefenseSuccess } = await import("../src/roulette.js");
const { ensureGuildChatStats, recordChatCounts } = await import("../src/activity.js");
const { collectDiscordHistoryInBatches } = await import("../src/history.js");
const { recordMessageRecords, seedProfileHistoryFromMessages, isGuildEnriched, markGuildEnriched } = await import("../src/records.js");
const { drainPendingMedia, normalizeStoredMediaPaths, requeueRetryableMedia, resolveMediaPath } = await import("../src/media.js");
const { isSeedStale, produceChunkedSeed, readSeedManifest } = await import("../src/seed.js");
const PREFIX = "bot.sqlite.part-";
const { chunkedMediaPaths, chunkIfOversized, isChunkable, readChunkedManifest, restoreChunkedMedia, produceChunkedMedia } = await import("../src/media-seed.js");
const { loadStatisticsRows, mergeStatisticsRows } = await import("../src/voice-affinity-command.js");
const { isCommandEnabled, setCommandEnabled, disabledCommandNames } = await import("../src/command-rules.js");
const { isAdminCommand } = await import("../src/admin-commands.js");

const GUILD_A = "1111111111111111111";
const GUILD_B = "2222222222222222222";

test("gives every guild its own sqlite file", () => {
  storage.initDatabase([GUILD_A, GUILD_B]);

  const pathA = storage.guildDatabasePath(GUILD_A);
  const pathB = storage.guildDatabasePath(GUILD_B);
  expect(pathA).not.toBe(pathB);
  expect(existsSync(pathA)).toBe(true);
  expect(existsSync(pathB)).toBe(true);
  expect(storage.dbFor(GUILD_A).filename).toBe(pathA);
  expect(storage.dbFor(GUILD_B).filename).toBe(pathB);
});

test("keeps messages of two guilds in separate databases", () => {
  storage.run(GUILD_A, "INSERT INTO discord_messages (message_id, guild_id, channel_id, channel_name, author_id, author_name, content, created_at, updated_at) VALUES ('m-a', ?, 'c', '채널', 'u', '유저', 'A', 1, 1)", GUILD_A);
  storage.run(GUILD_B, "INSERT INTO discord_messages (message_id, guild_id, channel_id, channel_name, author_id, author_name, content, created_at, updated_at) VALUES ('m-b', ?, 'c', '채널', 'u', '유저', 'B', 1, 1)", GUILD_B);

  const inA = storage.all<{ content: string }>(GUILD_A, "SELECT content FROM discord_messages");
  const inB = storage.all<{ content: string }>(GUILD_B, "SELECT content FROM discord_messages");

  expect(inA.map((row) => row.content)).toEqual(["A"]);
  expect(inB.map((row) => row.content)).toEqual(["B"]);
});

test("keeps voice activity of two guilds in separate databases", () => {
  storage.run(GUILD_A, "INSERT INTO voice_presence_sessions (guild_id, user_id, channel_id, started_at, ended_at) VALUES (?, 'u1', 'v', 1000, 2000)", GUILD_A);
  storage.run(GUILD_B, "INSERT INTO voice_presence_sessions (guild_id, user_id, channel_id, started_at, ended_at) VALUES (?, 'u1', 'v', 3000, 9000)", GUILD_B);

  const secondsOf = (guildId: string) => storage.sql<{ total: number }>(
    guildId, "SELECT COALESCE(SUM(ended_at - started_at), 0) AS total FROM voice_presence_sessions")?.total ?? 0;

  expect(secondsOf(GUILD_A)).toBe(1000);
  expect(secondsOf(GUILD_B)).toBe(6000);
});

test("does not overwrite a configured target role when both guilds set one", () => {
  storage.run(GUILD_A, "INSERT INTO settings (guild_id, target_role_id) VALUES (?, 'role-a')", GUILD_A);
  storage.run(GUILD_B, "INSERT INTO settings (guild_id, target_role_id) VALUES (?, 'role-b')", GUILD_B);

  expect(storage.sql<{ target_role_id: string }>(GUILD_A, "SELECT target_role_id FROM settings WHERE guild_id = ?", GUILD_A)?.target_role_id).toBe("role-a");
  expect(storage.sql<{ target_role_id: string }>(GUILD_B, "SELECT target_role_id FROM settings WHERE guild_id = ?", GUILD_B)?.target_role_id).toBe("role-b");
});

test("allows every slash command until a guild disables one", () => {
  expect(isCommandEnabled(GUILD_A, "통계")).toBe(true);
  expect(disabledCommandNames(GUILD_A)).toEqual([]);

  setCommandEnabled(GUILD_A, "통계", false, "1425196889288212691");

  expect(isCommandEnabled(GUILD_A, "통계")).toBe(false);
  expect(isCommandEnabled(GUILD_A, "친밀도")).toBe(true);
  expect(disabledCommandNames(GUILD_A)).toEqual(["통계"]);
  // 다른 서버 설정은 건드리지 않는다.
  expect(isCommandEnabled(GUILD_B, "통계")).toBe(true);
});

test("restores a disabled command and keeps the default allowed", () => {
  setCommandEnabled(GUILD_A, "question", false, "1425196889288212691");
  expect(isCommandEnabled(GUILD_A, "question")).toBe(false);

  setCommandEnabled(GUILD_A, "question", true, "1425196889288212691");

  expect(isCommandEnabled(GUILD_A, "question")).toBe(true);
  // 다시 켜도 허용 기본값과 같은 뜻이므로 비활성 목록에서만 빠진다.
  expect(disabledCommandNames(GUILD_A)).toEqual(["통계"]);
});

test("persists a disabled command in the guild database across reopen", () => {
  const path = storage.guildDatabasePath(GUILD_A);
  storage.closeAllDatabases();
  setCommandEnabled(GUILD_A, "요약", false, "1425196889288212691");

  const reopened = new Database(path, { readonly: true });
  const row = reopened.query("SELECT enabled FROM guild_command_rules WHERE guild_id = ? AND command_name = ?").get(GUILD_A, "요약") as { enabled: number } | null;
  expect(row?.enabled).toBe(0);
  reopened.close();
});

test("recognises only the management command prefixes", () => {
  expect(isAdminCommand("!서버목록")).toBe(true);
  expect(isAdminCommand("!서버별명령어")).toBe(true);
  expect(isAdminCommand("!도움")).toBe(true);
  expect(isAdminCommand("!서버별명령어 서버 disable 통계")).toBe(true);
  expect(isAdminCommand("!도움말")).toBe(false);
  expect(isAdminCommand("!sync")).toBe(false);
  expect(isAdminCommand("안녕하세요")).toBe(false);
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

const BACKFILL_GUILD = "3333333333333333333";
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
  type: 0,
  pinned: false,
  tts: false,
  flags: { bitfield: 0 },
  editedTimestamp: null,
  webhookId: null,
  reference: null,
  activity: null,
  applicationId: null,
  interaction: null,
  roleSubscriptionData: null,
  embeds: [],
  components: [],
  reactions: { cache: new Map() },
  mentions: { everyone: false, users: new Map(), roles: new Map(), channels: new Map() },
  channel: { isThread: () => false },
  author: { id: message.authorId, bot: message.bot, displayName: `user-${message.authorId}`, username: `user-${message.authorId}`, globalName: null, avatar: null, banner: null, accentColor: null, flags: { bitfield: 0 } },
  member: { displayName: `user-${message.authorId}`, nickname: null, user: { id: message.authorId, bot: message.bot, username: `user-${message.authorId}`, globalName: null, avatar: null, banner: null, accentColor: null, flags: { bitfield: 0 } } },
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
    createdTimestamp: message.createdAt,
    profile: {
      userId: authorId, username: `user-${authorId}`, globalName: `name-${authorId}`, nickname: null,
      displayName: `user-${authorId}`, avatarHash: null, avatarUrl: null, bannerHash: null, bannerUrl: null,
      accentColor: null, bot, publicFlags: 0
    },
    media: [],
    detail: null
  };
};

const drainGuild = async (guild: Guild, guildId: string) => {
  let inserted = 0;
  const history = await collectDiscordHistoryInBatches(guild, {
    batchSize: 100,
    storedRanges: storage.fetchStoredChannelRanges(guildId)
  }, async (messages) => {
    const fresh = storage.upsertMessages(guildId, messages);
    recordChatCounts(guildId, fresh);
    inserted += fresh.length;
  });
  return { ...history, inserted };
};

const storedCount = (guildId: string) =>
  storage.sql<{ total: number }>(guildId, "SELECT COUNT(*) AS total FROM discord_messages WHERE guild_id = ?", guildId)?.total ?? 0;

const chatTotal = (guildId: string) =>
  storage.sql<{ total: number }>(
    guildId, "SELECT COALESCE(SUM(chat_count), 0) AS total FROM chat_stats WHERE guild_id = ? AND bucket_type = 'all'", guildId
  )?.total ?? 0;

test("stores every readable message of every channel when a guild is backfilled", async () => {
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

test("does not leak backfilled messages into another guild database", async () => {
  const other = "4444444444444444444";
  const calls = { count: 0 };
  const guild = createFakeGuild(HISTORY_CHANNELS, calls);

  await drainGuild(guild, BACKFILL_GUILD);

  expect(storedCount(other)).toBe(0);
  expect(chatTotal(other)).toBe(0);
});

test("counts a live message once when the same message is delivered twice", () => {
  const guildId = "live-guild";
  const message = historyMessage(guildId, "l9");

  expect(recordChatCounts(guildId, storage.upsertMessages(guildId, [message]))).toBe(4);
  expect(recordChatCounts(guildId, storage.upsertMessages(guildId, [message]))).toBe(0);
  expect(chatTotal(guildId)).toBe(1);
});

test("serves statistics chat counts from the whole database while live counters stay empty", () => {
  const guildId = "stats-guild";
  const authors = ["s1", "s2", "s3", "s4", "s5"];
  for (let start = 0; start < 12_000; start += 500) {
    const batch = Array.from({ length: 500 }, (_, offset) => historyMessage(guildId, authors[(start + offset) % authors.length] ?? "s1"));
    recordChatCounts(guildId, storage.upsertMessages(guildId, batch));
  }

  const rows = loadStatisticsRows(guildId, "all", BASE_TIME + 86_400_000);

  expect(rows.reduce((sum, row) => sum + row.chat_count, 0)).toBe(12_000);
  expect(storage.sql<{ total: number }>(
    guildId, "SELECT COALESCE(SUM(chat_total), 0) AS total FROM users WHERE guild_id = ?", guildId)?.total).toBe(0);
});

test("rebuilds chat counts once for a guild whose history predates the precomputed table", () => {
  const guildId = "legacy-guild";
  const stored = Array.from({ length: 300 }, (_, index) =>
    historyMessage(guildId, index % 3 === 0 ? "bot" : `l${index % 4}`, index % 3 === 0));
  storage.upsertMessages(guildId, stored);

  expect(ensureGuildChatStats(guildId)).toBeGreaterThan(0);
  expect(chatTotal(guildId)).toBe(200);
  expect(ensureGuildChatStats(guildId)).toBe(0);
});

const profileOf = (overrides: Partial<MessageProfile> = {}): MessageProfile => ({
  userId: "p1", username: "giinii", globalName: "기니", nickname: null, displayName: "기니",
  avatarHash: "hash-a", avatarUrl: "https://cdn.example/avatar-a.png", bannerHash: null, bannerUrl: null,
  accentColor: null, bot: false, publicFlags: 0, ...overrides
});

const mediaOf = (id: string, kind: MediaRecord["kind"] = "attachment"): MediaRecord => ({
  mediaId: id, kind, filename: `${id}.png`, contentType: "image/png",
  bytes: 1024, width: 8, height: 8, duration: null, url: `http://127.0.0.1:1/${id}.png`,
  ownerUserId: "p1"
});

const richMessage = (guildId: string, overrides: {
  messageId?: string; profile?: MessageProfile; media?: MediaRecord[]; at?: number;
} = {}): HistoryMessage => {
  const base = historyMessage(guildId, overrides.profile?.userId ?? "p1");
  return {
    ...base,
    messageId: overrides.messageId ?? nextFakeMessage("p1").id,
    createdTimestamp: overrides.at ?? base.createdTimestamp,
    profile: overrides.profile ?? profileOf(),
    media: overrides.media ?? [mediaOf("m-1-attachment"), mediaOf("m-0-avatar", "avatar")],
    detail: {
      messageType: 0, pinned: true, editedTimestamp: null, webhookId: null, replyToMessageId: null,
      threadId: null, mentionsEveryone: false, mentionUserIds: ["u9"], mentionRoleIds: [], mentionChannelIds: [],
      reactionSummary: [{ emoji: "🔥", count: 3, me: true }], embedCount: 2, componentCount: 1,
      position: null, flags: 0, activity: null, raw: JSON.stringify({ kept: true })
    }
  };
};

const ingest = (guildId: string, messages: HistoryMessage[]) => {
  const inserted = storage.upsertMessages(guildId, messages);
  recordChatCounts(guildId, inserted);
  return recordMessageRecords(guildId, inserted);
};

const countRows = (guildId: string, table: string, where = "1=1", ...params: unknown[]) =>
  storage.sql<{ n: number }>(guildId, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...(params as never[]))?.n ?? 0;

test("records message details, media rows and a profile history row on ingest", () => {
  const guildId = "records-guild";
  const message = richMessage(guildId);

  const recorded = ingest(guildId, [message]);

  expect(recorded.details).toBe(1);
  expect(recorded.media).toBe(2);
  expect(recorded.profiles).toBe(1);
  const detail = storage.sql<{ pinned: number; mention_user_ids: string; reaction_summary: string; embed_count: number; raw: string }>(
    guildId, "SELECT pinned, mention_user_ids, reaction_summary, embed_count, raw FROM message_details WHERE message_id = ?", message.messageId);
  expect(detail?.pinned).toBe(1);
  expect(detail?.mention_user_ids).toBe(JSON.stringify(["u9"]));
  expect(detail?.reaction_summary).toBe(JSON.stringify([{ emoji: "🔥", count: 3, me: true }]));
  expect(detail?.embed_count).toBe(2);
  expect(detail?.raw).toBe(JSON.stringify({ kept: true }));
  const media = storage.all<{ media_id: string; kind: string; status: string }>(
    guildId, "SELECT media_id, kind, status FROM media_files WHERE message_id = ? ORDER BY media_id", message.messageId);
  expect(media.map((row) => row.kind)).toEqual(["avatar", "attachment"]);
  expect(media.every((row) => row.status === "pending")).toBe(true);
});

test("does not duplicate records when the same message arrives twice", () => {
  const guildId = "dupe-guild";
  const message = richMessage(guildId);
  ingest(guildId, [message]);
  const before = {
    details: countRows(guildId, "message_details", "message_id = ?", message.messageId),
    media: countRows(guildId, "media_files", "message_id = ?", message.messageId),
    profiles: countRows(guildId, "user_profiles", "guild_id = ?", guildId)
  };

  const second = ingest(guildId, [message]);

  expect(second).toEqual({ details: 0, media: 0, profiles: 0 });
  expect(countRows(guildId, "message_details", "message_id = ?", message.messageId)).toBe(before.details);
  expect(countRows(guildId, "media_files", "message_id = ?", message.messageId)).toBe(before.media);
  expect(countRows(guildId, "user_profiles", "guild_id = ?", guildId)).toBe(before.profiles);
});

test("appends a profile history row only when the identity actually changes", () => {
  const guildId = "rename-guild";
  ingest(guildId, [richMessage(guildId, { messageId: "m-a", profile: profileOf({ nickname: null }) })]);
  ingest(guildId, [richMessage(guildId, { messageId: "m-b", profile: profileOf({ nickname: "초보" }) })]);
  ingest(guildId, [richMessage(guildId, { messageId: "m-c", profile: profileOf({ nickname: "초보" }) })]);
  ingest(guildId, [richMessage(guildId, { messageId: "m-d", profile: profileOf({ nickname: "초보", avatarHash: "hash-b", avatarUrl: "https://cdn.example/avatar-b.png" }) })]);

  const history = storage.all<{ nickname: string | null; avatar_hash: string | null; source: string }>(
    guildId, "SELECT nickname, avatar_hash, source FROM user_profiles WHERE guild_id = ? ORDER BY id", guildId);
  expect(history.map((row) => [row.nickname, row.avatar_hash])).toEqual([
    [null, "hash-a"], ["초보", "hash-a"], ["초보", "hash-b"]
  ]);
  expect(history.every((row) => row.source === "message")).toBe(true);
});

test("seeds nickname history from the already stored corpus with first seen times", () => {
  const guildId = "seed-guild";
  const author = "seed-user";
  storage.upsertMessages(guildId, [
    historyMessage(guildId, author),
    { ...historyMessage(guildId, author), content: "두번째" },
    { ...historyMessage(guildId, author), content: "세번째", authorName: "바뀐이름" }
  ]);

  const seeded = seedProfileHistoryFromMessages();
  const again = seedProfileHistoryFromMessages();

  expect(countRows(guildId, "user_profiles", "guild_id = ? AND source = 'history-seed'", guildId)).toBe(2);
  expect(again).toBe(0);
  expect(seeded).toBeGreaterThanOrEqual(2);
  const history = storage.all<{ display_name: string; observed_at: number; source: string }>(
    guildId, "SELECT display_name, observed_at, source FROM user_profiles WHERE guild_id = ? ORDER BY observed_at", guildId);
  expect(history.map((row) => row.display_name)).toEqual([`user-${author}`, "바뀐이름"]);
  expect(history.every((row) => row.source === "history-seed")).toBe(true);
  expect(history[1]!.observed_at).toBeGreaterThan(history[0]!.observed_at);
});

test("downloads media to disk and records its hash and byte length", async () => {
  const guildId = "media-guild";
  const png = createCanvas(4, 4).toBuffer("image/png");
  const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(png)) });
  const mediaId = `dl-${Date.now()}`;
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, recorded_at) VALUES (?, 'attachment', 'pixel.png', ?, 'pending', ?)`,
    mediaId, `http://localhost:${server.port}/pixel.png`, Date.now());

  try {
    const tally = await drainPendingMedia(guildId);
    expect(tally.downloaded).toBe(1);
  } finally {
    server.stop(true);
  }

  const row = storage.sql<{ status: string; local_path: string; sha256: string; stored_bytes: number }>(
    guildId, "SELECT status, local_path, sha256, stored_bytes FROM media_files WHERE media_id = ?", mediaId);
  expect(row?.status).toBe("downloaded");
  expect(row?.sha256).toBe(createHash("sha256").update(png).digest("hex"));
  expect(row?.stored_bytes).toBe(png.byteLength);
  expect(row?.local_path.startsWith("/")).toBe(false);
  const onDisk = resolveMediaPath(row!.local_path);
  expect(existsSync(onDisk)).toBe(true);
  expect(Bun.file(onDisk).size).toBe(png.byteLength);
});

test("drains pending media of one guild without touching the other", async () => {
  const guildA = "pending-a";
  const guildB = "pending-b";
  const png = createCanvas(2, 2).toBuffer("image/png");
  const server = Bun.serve({ port: 0, fetch: () => new Response(new Uint8Array(png)) });
  const stamp = Date.now();
  storage.run(guildA, `INSERT INTO media_files (media_id, kind, filename, url, status, recorded_at) VALUES (?, 'attachment', 'a.png', ?, 'pending', ?)`, `pa-${stamp}`, `http://localhost:${server.port}/a.png`, stamp);
  storage.run(guildB, `INSERT INTO media_files (media_id, kind, filename, url, status, recorded_at) VALUES (?, 'attachment', 'b.png', ?, 'pending', ?)`, `pb-${stamp}`, `http://localhost:${server.port}/b.png`, stamp);

  try {
    expect((await drainPendingMedia(guildA)).downloaded).toBe(1);
  } finally {
    server.stop(true);
  }

  expect(storage.sql<{ status: string }>(guildA, "SELECT status FROM media_files WHERE media_id = ?", `pa-${stamp}`)?.status).toBe("downloaded");
  expect(storage.sql<{ status: string }>(guildB, "SELECT status FROM media_files WHERE media_id = ?", `pb-${stamp}`)?.status).toBe("pending");
});

test("rewrites environment absolute media paths to relative ones", () => {
  const guildId = "abs-guild";
  const mediaId = `abs-${Date.now()}`;
  const absolute = resolveMediaPath("avatar/relative-only.png");
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, local_path, recorded_at) VALUES (?, 'avatar', 'a.png', 'http://127.0.0.1:1/a.png', 'downloaded', ?, ?)`,
    mediaId, absolute, Date.now());

  const normalized = normalizeStoredMediaPaths(guildId);

  expect(normalized).toBeGreaterThan(0);
  expect(storage.sql<{ local_path: string }>(guildId, "SELECT local_path FROM media_files WHERE media_id = ?", mediaId)?.local_path)
    .toBe("avatar/relative-only.png");
  expect(normalizeStoredMediaPaths(guildId)).toBe(0);
});

test("marks a guild as enriched only once so restarts skip the full re-walk", () => {
  const guildId = "enrich-guild";
  expect(isGuildEnriched(guildId)).toBe(false);

  markGuildEnriched(guildId, 42);

  expect(isGuildEnriched(guildId)).toBe(true);
  expect(storage.sql<{ message_count: number }>(guildId, "SELECT message_count FROM enrichment_state WHERE guild_id = ?", guildId)?.message_count).toBe(42);
  markGuildEnriched(guildId, 99);
  expect(storage.sql<{ message_count: number }>(guildId, "SELECT message_count FROM enrichment_state WHERE guild_id = ?", guildId)?.message_count).toBe(99);
  expect(countRows(guildId, "enrichment_state", "guild_id = ?", guildId)).toBe(1);
});

test("splits each guild database into chunks whose reassembled bytes match the manifest sha256", async () => {
  const guildId = "5555555555555555555";
  storage.run(guildId, "INSERT OR REPLACE INTO settings (guild_id, target_role_id) VALUES (?, ?)", guildId, "role-1");
  const seedDir = join(directory, "seed-split", guildId);

  const manifest = await produceChunkedSeed(guildId, { seedDir, chunkBytes: 4096 });

  expect(manifest.parts.length).toBeGreaterThan(1);
  expect(manifest.totalBytes).toBeGreaterThan(manifest.chunkBytes);
  for (const part of manifest.parts.slice(0, -1)) expect(part.bytes).toBe(4096);
  expect(manifest.parts.at(-1)!.bytes).toBeLessThanOrEqual(4096);

  const reassembled = join(directory, "reassembled.sqlite");
  const out = createWriteStream(reassembled);
  for (const part of manifest.parts) {
    for await (const chunk of createReadStream(join(seedDir, part.name))) out.write(chunk);
  }
  await new Promise((r) => out.end(r));

  const bytes = Buffer.from(await Bun.file(reassembled).arrayBuffer());
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
  const restored = new Database(reassembled, { readonly: true });
  expect((restored.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check).toBe("ok");
  restored.close();
  rmSync(reassembled, { force: true });
});

test("keeps the previous seed intact when the new split is rejected", async () => {
  const guildId = "6666666666666666666";
  const seedDir = join(directory, "seed-keep", guildId);
  const first = await produceChunkedSeed(guildId, { seedDir, chunkBytes: 1024 * 1024 });
  const keptSha = first.sha256;

  // staging 은 seedDir 과 다른 경로라 조각 쓰기가 성공한다. 그래서 실패를 강제하려면
  // 조각 크기 검증처럼 분할 전에 걸러지는 조건을 쓴다.
  await expect(produceChunkedSeed(guildId, { seedDir, chunkBytes: -1 })).rejects.toThrow(/조각 크기/);

  const after = await readSeedManifest(seedDir);
  expect(after?.sha256).toBe(keptSha);
  expect((await readdirSync(seedDir)).filter((name) => name.startsWith(PREFIX))).toHaveLength(first.parts.length);
});

test("rejects a non positive chunk size before writing any part", async () => {
  const guildId = "6666666666666666666";
  const seedDir = join(directory, "seed-keep", guildId);
  const keptSha = (await readSeedManifest(seedDir))?.sha256;

  await expect(produceChunkedSeed(guildId, { seedDir, chunkBytes: 0 })).rejects.toThrow(/조각 크기/);

  expect((await readSeedManifest(seedDir))?.sha256).toBe(keptSha);
});

test("only reports a stale seed once the database grows past the threshold", async () => {
  const guildId = "7777777777777777777";
  const seedDir = join(directory, "seed-stale", guildId);
  const manifest = await produceChunkedSeed(guildId, { seedDir, chunkBytes: 1024 * 1024 });
  const { size } = statSync(storage.dbFor(guildId).filename);

  expect(manifest.sourceBytes).toBe(size);
  expect(await isSeedStale(guildId, 30 * 1024 * 1024, seedDir)).toBe(false);
  expect(await isSeedStale(guildId, 0, seedDir)).toBe(false);
  expect(await isSeedStale(guildId, -1, seedDir)).toBe(true);
});

test("requeues oversized media once the limit allows it and retries transient failures", () => {
  const guildId = "requeue-guild";
  const oversizedId = `oversize-${Date.now()}`;
  const failedId = `failed-${Date.now()}`;
  const missingId = `missing-${Date.now()}`;
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, bytes, recorded_at) VALUES (?, 'attachment', 'big.mp4', 'http://127.0.0.1:1/big.mp4', 'too_large', ?, ?)`,
    oversizedId, 300 * 1024 * 1024, Date.now());
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, bytes, recorded_at) VALUES (?, 'attachment', 'flaky.png', 'http://127.0.0.1:1/flaky.png', 'failed', ?, ?)`,
    failedId, 1024, Date.now());
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, bytes, recorded_at) VALUES (?, 'attachment', 'gone.png', 'http://127.0.0.1:1/gone.png', 'missing', ?, ?)`,
    missingId, 1024, Date.now());

  const requeued = requeueRetryableMedia(guildId);
  const statusOf = (id: string) => storage.sql<{ status: string }>(guildId, "SELECT status FROM media_files WHERE media_id = ?", id)?.status;

  expect(requeued.oversized).toBeGreaterThanOrEqual(1);
  expect(requeued.failed).toBeGreaterThanOrEqual(1);
  expect(statusOf(oversizedId)).toBe("pending");
  expect(statusOf(failedId)).toBe("pending");
  expect(statusOf(missingId)).toBe("missing");
});

test("keeps media over the 30 MB commit ceiling out of the direct media tree", async () => {
  const relative = `attachment/chunked-${Date.now()}.bin`;
  const chunkDir = join(directory, "media-seed", relative);
  mkdirSync(chunkDir, { recursive: true });
  const bytes = Buffer.alloc(1024 * 1024, 7);
  writeFileSync(join(chunkDir, "part-001"), bytes.subarray(0, 600 * 1024));
  writeFileSync(join(chunkDir, "part-002"), bytes.subarray(600 * 1024));
  writeFileSync(join(chunkDir, "manifest.json"), JSON.stringify({
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    parts: [{ name: "part-001", bytes: 600 * 1024 }, { name: "part-002", bytes: 424 * 1024 }]
  }));

  expect(isChunkable(29 * 1024 * 1024)).toBe(false);
  expect(isChunkable(50 * 1024 * 1024)).toBe(true);
  expect(isChunkable(294 * 1024 * 1024)).toBe(true);

  const result = await restoreChunkedMedia();

  expect(result.restored).toBeGreaterThanOrEqual(1);
  const restoredPath = join(directory, "media", relative);
  expect(existsSync(restoredPath)).toBe(true);
  expect(statSync(restoredPath).size).toBe(bytes.length);
  expect(createHash("sha256").update(readFileSync(restoredPath)).digest("hex"))
    .toBe(createHash("sha256").update(bytes).digest("hex"));
});

test("chunks an over-cap file at save time and leaves no copy in the media tree", async () => {
  const relative = `attachment/big-${Date.now()}.bin`;
  const absolute = join(directory, "media", relative);
  mkdirSync(join(directory, "media", "attachment"), { recursive: true });
  const bytes = Buffer.alloc(2 * 1024 * 1024, 3);
  writeFileSync(absolute, bytes);

  const chunked = await chunkIfOversized(relative, 1024);

  expect(chunked).toBe(true);
  expect(existsSync(absolute)).toBe(false);
  const manifest = await readChunkedManifest(relative);
  expect(manifest?.bytes).toBe(bytes.length);
  expect(manifest?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect((await chunkedMediaPaths())).toContain(relative);
});

test("leaves a file under the cap in the media tree unchunked", async () => {
  const relative = `attachment/small-${Date.now()}.bin`;
  const absolute = join(directory, "media", relative);
  mkdirSync(join(directory, "media", "attachment"), { recursive: true });
  writeFileSync(absolute, Buffer.alloc(1024, 5));

  expect(await chunkIfOversized(relative, 1024 * 1024)).toBe(false);
  expect(existsSync(absolute)).toBe(true);
});

test("chunks oversized media of the given guilds only", async () => {
  const guildId = "8888888888888888888";
  const relative = `attachment/seeded-${Date.now()}.bin`;
  // 30 MB 상한을 실제로 넘겨야 조각이 된다. 작은 파일을 넣으면 걸러지는 게 맞다.
  const bytes = Buffer.alloc(31 * 1024 * 1024, 9);
  const absolute = join(directory, "media", relative);
  mkdirSync(join(directory, "media", "attachment"), { recursive: true });
  writeFileSync(absolute, bytes);
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, bytes, local_path, recorded_at) VALUES (?, 'attachment', 'x.bin', 'http://127.0.0.1:1/x.bin', 'downloaded', ?, ?, ?)`,
    `${guildId}-media`, bytes.length, relative, Date.now());

  const produced = await produceChunkedMedia([guildId]);

  expect(produced).toContain(relative);
  // 이 스크립트는 조각만 만들고 원본은 지우지 않는다(아카이브 크기만큼 복사본을 남기지 않는 건
  // 저장 시점 경로인 chunkIfOversized 의 몫이다). 조각이 실제로 만들어졌는지로 판단한다.
  const manifest = await readChunkedManifest(relative);
  expect(manifest?.bytes).toBe(bytes.length);
  expect(manifest?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
});

test("leaves a small downloaded file unchunked for the given guilds", async () => {
  const guildId = "9999999999999999999";
  const relative = `attachment/tiny-${Date.now()}.bin`;
  const bytes = Buffer.alloc(2 * 1024 * 1024, 4);
  const absolute = join(directory, "media", relative);
  mkdirSync(join(directory, "media", "attachment"), { recursive: true });
  writeFileSync(absolute, bytes);
  storage.run(guildId, `INSERT INTO media_files (media_id, kind, filename, url, status, bytes, local_path, recorded_at) VALUES (?, 'attachment', 'y.bin', 'http://127.0.0.1:1/y.bin', 'downloaded', ?, ?, ?)`,
    `${guildId}-tiny`, bytes.length, relative, Date.now());

  const produced = await produceChunkedMedia([guildId]);

  expect(produced).not.toContain(relative);
  expect(existsSync(absolute)).toBe(true);
});

test("keeps chat-only and voice-only users in the same statistics ranking", () => {  expect(mergeStatisticsRows(
    [{ user_id: "a", chat_count: 5 }],
    [{ user_id: "a", voice_seconds: 60 }, { user_id: "b", voice_seconds: 30 }]
  )).toEqual([
    { user_id: "a", chat_count: 5, voice_seconds: 60 },
    { user_id: "b", chat_count: 0, voice_seconds: 30 }
  ]);
});

afterAll(() => {
  storage.closeAllDatabases();
  rmSync(directory, { recursive: true, force: true });
});
