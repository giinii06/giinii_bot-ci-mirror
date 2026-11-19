import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbedBuilder, Message, VoiceState } from "discord.js";

process.env.DISCORD_BOT_TOKEN = "test-token";
const directory = mkdtempSync(join(tmpdir(), "giinii-dunk-"));
process.env.DATABASE_PATH = join(directory, "bot.sqlite");

const storage = await import("../src/storage.js");
const {
  createDunkTracker, formatDunkMessage, getDunkIgnoredChannels, getDunkSettings, handleDunkCommand, handleDunkVoiceUpdate, isDunkCommand
} = await import("../src/dunk-detection.js");
const { ALLOWED_GUILD_ID } = await import("../src/command-rules.js");
const { ADMIN_USER_ID } = await import("../src/admin-commands.js");

const GUILD = ALLOWED_GUILD_ID;
const LEAVER = "u-leaver";
const VOICE_CHANNEL = "111111111111111111";
const TEXT_CHANNEL = "222222222222222222";
const channels = new Map<string, { id: string; isVoiceBased: () => boolean }>([
  [VOICE_CHANNEL, { id: VOICE_CHANNEL, isVoiceBased: () => true }],
  [TEXT_CHANNEL, { id: TEXT_CHANNEL, isVoiceBased: () => false }]
]);
const guild = {
  id: GUILD,
  channels: { cache: channels, fetch: async (id: string) => channels.get(id) ?? null }
};

const transition = (overrides: Partial<Parameters<ReturnType<typeof createDunkTracker>["track"]>[0]> = {}) => ({
  guildId: GUILD, userId: LEAVER, isBot: false, oldChannelId: null, newChannelId: "A", now: 0, ...overrides
});

const joinThenLeave = (leaveAt: number, thresholdSeconds: number) => {
  const tracker = createDunkTracker();
  tracker.track(transition({ newChannelId: "A", now: 0 }), thresholdSeconds);
  return tracker.track(transition({ oldChannelId: "A", newChannelId: null, now: leaveAt }), thresholdSeconds);
};

test("detects a leave inside the threshold with rounded seconds", () => {
  expect(joinThenLeave(12_400, 60)).toEqual({ userId: LEAVER, channelId: "A", seconds: 12 });
  expect(joinThenLeave(12_600, 60)).toEqual({ userId: LEAVER, channelId: "A", seconds: 13 });
  expect(joinThenLeave(400, 60)).toEqual({ userId: LEAVER, channelId: "A", seconds: 1 });
});

test("detects a leave at exactly the threshold and ignores anything slower", () => {
  expect(joinThenLeave(60_000, 60)).toEqual({ userId: LEAVER, channelId: "A", seconds: 60 });
  expect(joinThenLeave(60_001, 60)).toBeNull();
});

test("suppresses the leave a bot caused and tracks the next real one", () => {
  const tracker = createDunkTracker();
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60);
  tracker.noteBotMove(GUILD, LEAVER, 1_000);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: null, now: 2_000 }), 60)).toBeNull();
  // 표식은 한 번만 쓰이므로 다시 들어왔다 나가면 잡힌다.
  tracker.track(transition({ newChannelId: "A", now: 3_000 }), 60);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: null, now: 5_000 }), 60))
    .toEqual({ userId: LEAVER, channelId: "A", seconds: 2 });
});

test("ignores an expired bot move marker", () => {
  const tracker = createDunkTracker();
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60);
  tracker.noteBotMove(GUILD, LEAVER, 0);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: null, now: 10_001 }), 60))
    .toEqual({ userId: LEAVER, channelId: "A", seconds: 10 });
});

test("ignores bot users and same-channel updates", () => {
  const tracker = createDunkTracker();
  tracker.track(transition({ isBot: true, newChannelId: "A", now: 0 }), 60);
  expect(tracker.track(transition({ isBot: true, oldChannelId: "A", newChannelId: null, now: 1_000 }), 60)).toBeNull();
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: "A", now: 1_000 }), 60)).toBeNull();
});

test("reports a fast room move and keeps tracking the new room", () => {
  const tracker = createDunkTracker();
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: "B", now: 5_000 }), 60))
    .toEqual({ userId: LEAVER, channelId: "A", seconds: 5 });
  expect(tracker.track(transition({ oldChannelId: "B", newChannelId: null, now: 8_000 }), 60))
    .toEqual({ userId: LEAVER, channelId: "B", seconds: 3 });
});

test("suppresses only the leaving side of a bot move and still tracks the new room", () => {
  const tracker = createDunkTracker();
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60);
  tracker.noteBotMove(GUILD, LEAVER, 1_000);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: "B", now: 2_000 }), 60)).toBeNull();
  expect(tracker.track(transition({ oldChannelId: "B", newChannelId: null, now: 4_000 }), 60))
    .toEqual({ userId: LEAVER, channelId: "B", seconds: 2 });
});

test("ignores joins and leaves in an ignored channel", () => {
  const tracker = createDunkTracker();
  const ignored = new Set(["A"]);
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60, ignored);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: null, now: 1_000 }), 60, ignored)).toBeNull();
});

test("still reports the leave from a normal channel into an ignored one", () => {
  const tracker = createDunkTracker();
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: "B", now: 2_000 }), 60, new Set(["B"])))
    .toEqual({ userId: LEAVER, channelId: "A", seconds: 2 });
  expect(tracker.track(transition({ oldChannelId: "B", newChannelId: null, now: 3_000 }), 60, new Set(["B"])))
    .toBeNull();
});

test("starts tracking after leaving an ignored channel for a normal one", () => {
  const tracker = createDunkTracker();
  const ignored = new Set(["A"]);
  tracker.track(transition({ newChannelId: "A", now: 0 }), 60, ignored);
  expect(tracker.track(transition({ oldChannelId: "A", newChannelId: "B", now: 1_000 }), 60, ignored)).toBeNull();
  expect(tracker.track(transition({ oldChannelId: "B", newChannelId: null, now: 3_000 }), 60, ignored))
    .toEqual({ userId: LEAVER, channelId: "B", seconds: 2 });
});

test("formats the log line with and without witnesses", () => {
  expect(formatDunkMessage({ userId: "111", channelId: "222", seconds: 7, witnessIds: ["333", "444"] }))
    .toBe("<@111> (이)가 <@333>, <@444> 등등이 있던 통방 <#222> 을 7초만에 들낙했습니다!");
  expect(formatDunkMessage({ userId: "111", channelId: "222", seconds: 7, witnessIds: [] }))
    .toBe("<@111> (이)가 <#222> 을 7초만에 들낙했습니다!");
});

test("recognises the dunk commands", () => {
  expect(isDunkCommand("!들낙감지설치")).toBe(true);
  expect(isDunkCommand("!들낙시간지정 30")).toBe(true);
  expect(isDunkCommand(`!들낙무시 ${VOICE_CHANNEL}`)).toBe(true);
  expect(isDunkCommand("  !들낙감지설치  ")).toBe(true);
  expect(isDunkCommand("!들낙")).toBe(false);
  expect(isDunkCommand("안녕 !들낙감지설치")).toBe(false);
});

type Reply = { embeds: EmbedBuilder[] };

const fakeMessage = (content: string, options: {
  guildId?: string; channelId?: string; userId?: string; serverAdmin?: boolean; bot?: boolean;
} = {}) => {
  const replies: Reply[] = [];
  const message = {
    content,
    guildId: options.guildId ?? GUILD,
    guild,
    channelId: options.channelId ?? "log-channel",
    author: { bot: options.bot ?? false, id: options.userId ?? "plain-user" },
    member: { permissions: { has: () => options.serverAdmin === true } },
    reply: async (payload: Reply) => { replies.push(payload); }
  } as unknown as Message;
  return { message, replies };
};

const embedData = (replies: Reply[]) => replies[0]!.embeds[0]!.data;

test("defaults to 60 seconds and no log channel", () => {
  expect(getDunkSettings("9999999999999999999")).toEqual({
    guildId: "9999999999999999999", logChannelId: null, thresholdSeconds: 60
  });
});

test("refuses every dunk command outside the dedicated guild", async () => {
  const { message, replies } = fakeMessage("!들낙감지설치", { guildId: "123", serverAdmin: true });
  expect(await handleDunkCommand(message)).toBe(true);
  expect(embedData(replies).title).toBe("이 서버에서는 쓸 수 없어요");
  expect(getDunkSettings("123").logChannelId).toBeNull();
});

test("refuses a member who is neither the bot admin nor a server administrator", async () => {
  const { message, replies } = fakeMessage("!들낙감지설치", { userId: "plain-user" });
  expect(await handleDunkCommand(message)).toBe(true);
  expect(embedData(replies).title).toBe("권한이 없어요");
  expect(getDunkSettings(GUILD).logChannelId).toBeNull();
});

test("lets a server administrator install the current channel", async () => {
  const { message, replies } = fakeMessage("!들낙감지설치", { channelId: "log-1", serverAdmin: true });
  expect(await handleDunkCommand(message)).toBe(true);
  expect(getDunkSettings(GUILD).logChannelId).toBe("log-1");
  const data = embedData(replies);
  expect(data.title).toBe("들낙 감지 설치");
  expect(data.description).toContain("<#log-1>");
  expect(data.description).toContain("60초");
  expect(data.description).toContain("!들낙시간지정");
});

test("says so when the same channel is installed twice and names the old one when it moves", async () => {
  const same = fakeMessage("!들낙감지설치", { channelId: "log-1", serverAdmin: true });
  await handleDunkCommand(same.message);
  expect(embedData(same.replies).title).toBe("들낙 감지 설치");
  expect(embedData(same.replies).description).toContain("이미 설치돼 있어요");

  const moved = fakeMessage("!들낙감지설치", { channelId: "log-2", serverAdmin: true });
  await handleDunkCommand(moved.message);
  expect(getDunkSettings(GUILD).logChannelId).toBe("log-2");
  expect(embedData(moved.replies).description).toContain("<#log-1>");
  expect(embedData(moved.replies).description).toContain("<#log-2>");
});

test("rejects install arguments with a usage notice", async () => {
  const { message, replies } = fakeMessage("!들낙감지설치 지금", { channelId: "log-3", serverAdmin: true });
  await handleDunkCommand(message);
  expect(embedData(replies).title).toBe("사용법");
  expect(getDunkSettings(GUILD).logChannelId).toBe("log-2");
});

test("rejects every malformed threshold and keeps the stored one", async () => {
  for (const content of ["!들낙시간지정", "!들낙시간지정 abc", "!들낙시간지정 0", "!들낙시간지정 86401", "!들낙시간지정 30 40"]) {
    const { message, replies } = fakeMessage(content, { serverAdmin: true });
    expect(await handleDunkCommand(message)).toBe(true);
    expect(["사용법", "숫자를 확인해 주세요"]).toContain(embedData(replies).title!);
    expect(getDunkSettings(GUILD).thresholdSeconds).toBe(60);
  }
});

test("lets the bot admin set a valid threshold", async () => {
  const { message, replies } = fakeMessage("!들낙시간지정 30", { userId: ADMIN_USER_ID });
  expect(await handleDunkCommand(message)).toBe(true);
  expect(getDunkSettings(GUILD).thresholdSeconds).toBe(30);
  expect(getDunkSettings(GUILD).logChannelId).toBe("log-2");
  const data = embedData(replies);
  expect(data.title).toBe("들낙 시간 지정");
  expect(data.description).toContain("30초");
});

test("keeps the channel and threshold after every database closes", () => {
  storage.closeAllDatabases();
  expect(getDunkSettings(GUILD)).toEqual({ guildId: GUILD, logChannelId: "log-2", thresholdSeconds: 30 });
});

test("adds, lists, and removes an ignored voice channel", async () => {
  const add = fakeMessage(`!들낙무시 <#${VOICE_CHANNEL}>`, { serverAdmin: true });
  expect(await handleDunkCommand(add.message)).toBe(true);
  expect(embedData(add.replies).title).toBe("들낙 무시 채널");
  expect([...getDunkIgnoredChannels(GUILD)]).toEqual([VOICE_CHANNEL]);

  const list = fakeMessage("!들낙무시", { serverAdmin: true });
  await handleDunkCommand(list.message);
  expect(embedData(list.replies).description).toContain(`<#${VOICE_CHANNEL}>`);

  const remove = fakeMessage(`!들낙무시 해제 ${VOICE_CHANNEL}`, { serverAdmin: true });
  await handleDunkCommand(remove.message);
  expect(getDunkIgnoredChannels(GUILD).size).toBe(0);
  expect(embedData(remove.replies).title).toBe("들낙 무시 해제");
});

test("rejects a text channel and a malformed channel id for dunk ignore", async () => {
  for (const content of [`!들낙무시 ${TEXT_CHANNEL}`, "!들낙무시 abc", "!들낙무시 123"]) {
    const { message, replies } = fakeMessage(content, { serverAdmin: true });
    expect(await handleDunkCommand(message)).toBe(true);
    expect(["음성 채널이 아니에요", "채널 ID를 확인해 주세요"]).toContain(embedData(replies).title!);
  }
  expect(getDunkIgnoredChannels(GUILD).size).toBe(0);
});

test("ignores ordinary messages and bot authors", async () => {
  expect(await handleDunkCommand(fakeMessage("안녕하세요").message)).toBe(false);
  expect(await handleDunkCommand(fakeMessage("!들낙감지설치", { bot: true }).message)).toBe(false);
});

test("sends one log embed with the leaver, witnesses, and room", async () => {
  const install = fakeMessage("!들낙감지설치", { channelId: "log-2", serverAdmin: true });
  await handleDunkCommand(install.message);

  type SentLog = { embeds: EmbedBuilder[]; allowedMentions: unknown };
  const sent: SentLog[] = [];
  const voiceRoom = {
    isVoiceBased: () => true,
    members: new Map([
      [LEAVER, { id: LEAVER, user: { bot: false } }],
      ["witness", { id: "witness", user: { bot: false } }],
      ["bot", { id: "bot", user: { bot: true } }]
    ])
  };
  const logChannel = {
    isSendable: () => true,
    send: async (payload: SentLog) => { sent.push(payload); }
  };
  const guild = {
    id: GUILD,
    channels: {
      cache: new Map<string, unknown>([["log-2", logChannel]]),
      fetch: async () => null
    }
  };
  const state = (channelId: string | null, channel: unknown) =>
    ({ guild, id: LEAVER, channelId, channel, member: { user: { bot: false } } }) as unknown as VoiceState;

  handleDunkVoiceUpdate(state(null, null), state("room-1", voiceRoom));
  handleDunkVoiceUpdate(state("room-1", voiceRoom), state(null, null));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(sent).toHaveLength(1);
  const embed = sent[0]!.embeds[0]!.data;
  expect(embed.title).toBe("들낙 감지");
  expect(embed.description).toContain(`<@${LEAVER}>`);
  expect(embed.description).toContain("<@witness>");
  expect(embed.description).toContain("<#room-1>");
  expect(embed.description).not.toContain("<@bot>");
  expect(sent[0]!.allowedMentions).toEqual({ parse: ["users"] });
});

afterAll(() => {
  storage.closeAllDatabases();
  rmSync(directory, { recursive: true, force: true });
});
