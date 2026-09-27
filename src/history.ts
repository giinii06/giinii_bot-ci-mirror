import {
  ChannelType,
  PermissionFlagsBits,
  type Collection,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type Snowflake
} from "discord.js";
import { config } from "./config.js";
import { fetchRecentMessages, type StoredChannelRanges } from "./storage.js";

const PAGE_SIZE = 100;

export type MessageProfile = {
  userId: Snowflake;
  username: string;
  globalName: string | null;
  nickname: string | null;
  displayName: string;
  avatarHash: string | null;
  avatarUrl: string | null;
  bannerHash: string | null;
  bannerUrl: string | null;
  accentColor: number | null;
  bot: boolean;
  publicFlags: number;
};

export type MediaRecord = {
  mediaId: string;
  kind: "attachment" | "sticker" | "avatar" | "banner";
  filename: string;
  contentType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  url: string;
  ownerUserId: string | null;
};

export type MessageDetail = {
  messageType: number;
  pinned: boolean;
  editedTimestamp: number | null;
  webhookId: string | null;
  replyToMessageId: string | null;
  threadId: string | null;
  mentionsEveryone: boolean;
  mentionUserIds: string[];
  mentionRoleIds: string[];
  mentionChannelIds: string[];
  reactionSummary: { emoji: string; count: number; me: boolean }[];
  embedCount: number;
  componentCount: number;
  position: number | null;
  flags: number;
  activity: string | null;
  raw: string;
};

export type HistoryMessage = {
  messageId: Snowflake;
  guildId: Snowflake;
  channelId: Snowflake;
  channelName: string;
  authorId: Snowflake;
  authorName: string;
  authorIsBot: boolean;
  content: string;
  createdTimestamp: number;
  profile: MessageProfile | null;
  media: MediaRecord[];
  detail: MessageDetail | null;
};

const textChannelTypes = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread
]);

export type HistoryDrainOptions = { batchSize: number; storedRanges?: StoredChannelRanges };

/** 눈덩이 ID는 자릿수가 자를 수 있어 길이 우선, 길이가 같으면 사전순으로 비교한다. */
const compareSnowflake = (left: Snowflake, right: Snowflake) =>
  left.length === right.length ? (left < right ? -1 : left > right ? 1 : 0) : left.length - right.length;

const reachedStoredHead = (messages: HistoryMessage[], head: Snowflake | undefined) =>
  head !== undefined && messages.some((message) => compareSnowflake(message.messageId, head) <= 0);

/**
 * 읽을 수 있는 모든 채널의 전체 기록을 더 이상 못 가져올 때까지 읽어낸다.
 * storedRanges에 이미 저장된 구간이 있으면 그 구간 위(새 메시지)와 아래(누락된 과거)만 읽고,
 * 저장된 구간 자체는 커서를 아래로 한 번에 옮겨 건너뛴다.
 */
export const collectDiscordHistoryInBatches = async (
  guild: Guild,
  options: HistoryDrainOptions,
  onBatch: (messages: HistoryMessage[], totalCollected: number) => Promise<void>
) => {
  await guild.channels.fetch();
  const channels = selectChannels(guild);
  const cursors = new Map<Snowflake, Snowflake | undefined>();
  const exhausted = new Set<Snowflake>();
  let totalCollected = 0;
  let failedChannels = 0;

  while (exhausted.size < channels.length) {
    const batch: HistoryMessage[] = [];

    for (const channel of channels) {
      if (batch.length >= options.batchSize) break;
      if (exhausted.has(channel.id)) continue;

      try {
        const stored = options.storedRanges?.get(channel.id);
        const page = await fetchChannelMessagePage(channel, options.batchSize - batch.length, cursors.get(channel.id));
        cursors.set(channel.id, page.before);

        if (page.messages.length === 0 || !page.before) {
          exhausted.add(channel.id);
        } else if (reachedStoredHead(page.messages, stored?.newest)) {
          cursors.set(channel.id, stored?.oldest);
        }
        batch.push(...page.messages);
      } catch {
        exhausted.add(channel.id);
        failedChannels += 1;
      }
    }

    if (batch.length === 0) break;

    batch.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    totalCollected += batch.length;
    await onBatch(batch, totalCollected);
  }

  return {
    messageCount: totalCollected,
    scannedChannelCount: channels.length,
    failedChannels
  };
};

export const collectHistory = async (guild: Guild, limit: number, channelInput?: string | null) => {
  await guild.channels.fetch();
  const channelIds = selectChannels(guild, channelInput).map((channel) => channel.id);
  const messages = await fetchRecentMessages(
    guild.id,
    limit,
    channelIds,
    config.includeBotMessages
  );

  return {
    text: formatForPrompt(messages, config.maxContextChars),
    messageCount: messages.length,
    channelCount: new Set(messages.map((message) => message.channelId)).size,
    scannedChannelCount: 0,
    failedChannels: 0
  };
};

const selectChannels = (guild: Guild, channelInput?: string | null) => {
  const requestedIds = parseChannelIds(channelInput);
  const allChannels = Array.from(guild.channels.cache.values()).filter((channel): channel is GuildTextBasedChannel => {
    if (!textChannelTypes.has(channel.type)) return false;
    if (!("messages" in channel)) return false;
    if (!channel.permissionsFor(guild.roles.everyone, false).has(PermissionFlagsBits.ViewChannel, false)) return false;
    if (requestedIds.size > 0 && !requestedIds.has(channel.id)) return false;
    return true;
  });

  return allChannels.sort((a, b) => channelPosition(a) - channelPosition(b) || a.name.localeCompare(b.name));
};

const channelPosition = (channel: GuildTextBasedChannel) => ("position" in channel ? channel.position : 10_000);

export const parseChannelIds = (value?: string | null) => {
  const ids = new Set<Snowflake>();
  for (const match of value?.matchAll(/\d{15,25}/g) ?? []) {
    if (match[0]) ids.add(match[0]);
  }
  return ids;
};

const safeJson = (value: unknown) => {
  try { return JSON.stringify(value) ?? "{}"; } catch { return "{}"; }
};

const tryUrl = (build: () => string | null | undefined) => {
  try { return build() ?? null; } catch { return null; }
};

/** 부가 정보 추출이 실패해도 메시지 자체를 잃지 않도록 감싼다. */
export const safeCapture = <T>(label: string, build: () => T, fallback: T): T => {
  try {
    return build();
  } catch (error) {
    console.error(`Failed to capture ${label}`, error);
    return fallback;
  }
};

export const captureProfile = (message: Message): MessageProfile | null => {
  const user = message.member?.user;
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    nickname: message.member?.nickname ?? null,
    displayName: message.member?.displayName || user.displayName || user.username,
    avatarHash: user.avatar ?? null,
    avatarUrl: tryUrl(() => message.member?.avatarURL({ extension: "png", size: 512 }) ?? user.avatarURL({ extension: "png", size: 512 })),
    bannerHash: user.banner ?? null,
    bannerUrl: tryUrl(() => user.bannerURL({ extension: "png", size: 600 })),
    accentColor: user.accentColor ?? null,
    bot: user.bot,
    publicFlags: user.flags?.bitfield ?? 0
  };
};

export const avatarMedia = (profile: MessageProfile): MediaRecord | null =>
  profile.avatarHash && profile.avatarUrl ? {
    mediaId: `avatar-${profile.userId}-${profile.avatarHash}`,
    kind: "avatar",
    filename: `${profile.avatarHash}.png`,
    contentType: "image/png",
    bytes: null, width: null, height: null, duration: null,
    url: profile.avatarUrl,
    ownerUserId: profile.userId
  } : null;

export const bannerMedia = (profile: MessageProfile): MediaRecord | null =>
  profile.bannerHash && profile.bannerUrl ? {
    mediaId: `banner-${profile.userId}-${profile.bannerHash}`,
    kind: "banner",
    filename: `${profile.bannerHash}.png`,
    contentType: "image/png",
    bytes: null, width: null, height: null, duration: null,
    url: profile.bannerUrl,
    ownerUserId: profile.userId
  } : null;

export const profileFromMember = (member: GuildMember): MessageProfile | null => {
  const user = member.user;
  if (!user) return null;
  return {
    userId: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    nickname: member.nickname ?? null,
    displayName: member.displayName || user.displayName || user.username,
    avatarHash: user.avatar ?? null,
    avatarUrl: tryUrl(() => member.avatarURL({ extension: "png", size: 512 }) ?? user.avatarURL({ extension: "png", size: 512 })),
    bannerHash: user.banner ?? null,
    bannerUrl: tryUrl(() => user.bannerURL({ extension: "png", size: 600 })),
    accentColor: user.accentColor ?? null,
    bot: user.bot,
    publicFlags: user.flags?.bitfield ?? 0
  };
};

export const captureMedia = (message: Message): MediaRecord[] => {
  const media: MediaRecord[] = [];
  for (const attachment of message.attachments.values()) {
    media.push({
      mediaId: attachment.id,
      kind: "attachment",
      filename: attachment.name ?? "",
      contentType: attachment.contentType ?? null,
      bytes: attachment.size ?? null,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      duration: attachment.duration ?? null,
      url: attachment.url,
      ownerUserId: message.author.id
    });
  }
  for (const sticker of message.stickers.values()) {
    media.push({
      mediaId: `sticker-${sticker.id}`,
      kind: "sticker",
      filename: `${sticker.name}.${sticker.format}`,
      contentType: null,
      bytes: null,
      width: null,
      height: null,
      duration: null,
      url: sticker.url,
      ownerUserId: null
    });
  }
  const profile = captureProfile(message);
  const avatar = profile ? avatarMedia(profile) : null;
  const banner = profile ? bannerMedia(profile) : null;
  return [...media, ...(avatar ? [avatar] : []), ...(banner ? [banner] : [])];
};

export const captureDetail = (message: Message): MessageDetail => {
  const reactions = [...message.reactions.cache.values()].map((reaction) => ({
    emoji: reaction.emoji.name ?? reaction.emoji.id ?? "",
    count: reaction.count,
    me: reaction.me
  }));
  return {
    messageType: message.type,
    pinned: message.pinned,
    editedTimestamp: message.editedTimestamp ?? null,
    webhookId: message.webhookId ?? null,
    replyToMessageId: message.reference?.messageId ?? null,
    threadId: message.channel.isThread() ? message.channel.id : null,
    mentionsEveryone: message.mentions.everyone,
    mentionUserIds: [...message.mentions.users.keys()],
    mentionRoleIds: [...message.mentions.roles.keys()],
    mentionChannelIds: [...message.mentions.channels.keys()],
    reactionSummary: reactions,
    embedCount: message.embeds.length,
    componentCount: Array.isArray(message.components) ? message.components.length : 0,
    position: "position" in message && typeof message.position === "number" ? message.position : null,
    flags: message.flags.bitfield,
    activity: message.activity ? String(message.activity.type) : null,
    raw: safeJson({
      type: message.type, pinned: message.pinned, tts: message.tts,
      editedTimestamp: message.editedTimestamp, webhookId: message.webhookId,
      reference: message.reference, activity: message.activity,
      applicationId: message.applicationId, interaction: message.interaction,
      roleSubscriptionData: message.roleSubscriptionData, flags: message.flags.bitfield,
      mentions: {
        everyone: message.mentions.everyone,
        users: [...message.mentions.users.keys()],
        roles: [...message.mentions.roles.keys()],
        channels: [...message.mentions.channels.keys()]
      },
      reactions: [...message.reactions.cache.values()].map((reaction) => ({
        emoji: reaction.emoji.name ?? reaction.emoji.id ?? "", count: reaction.count, me: reaction.me
      })),
      attachments: [...message.attachments.values()].map((attachment) => ({
        id: attachment.id, name: attachment.name, description: attachment.description,
        contentType: attachment.contentType, size: attachment.size,
        width: attachment.width, height: attachment.height, duration: attachment.duration,
        ephemeral: attachment.ephemeral, waveform: attachment.waveform,
        url: attachment.url, proxyURL: attachment.proxyURL
      })),
      stickers: [...message.stickers.values()].map((sticker) => ({
        id: sticker.id, name: sticker.name, description: sticker.description, format: sticker.format
      })),
      embeds: message.embeds.map((embed) => embed.toJSON()),
      components: message.components, thread: message.channel.isThread() ? { id: message.channel.id } : null
    })
  };
};

const fetchChannelMessagePage = async (channel: GuildTextBasedChannel, limit: number, before?: Snowflake) => {
  const batch: Collection<Snowflake, Message> = await channel.messages.fetch({
    limit: Math.min(PAGE_SIZE, limit),
    before
  });

  const messages: HistoryMessage[] = [];
  for (const message of batch.values()) {
    const content = cleanMessage(message);
    if (!content) continue;

    messages.push({
      messageId: message.id,
      guildId: channel.guild.id,
      channelId: channel.id,
      channelName: channel.name,
      authorId: message.author.id,
      authorName: message.member?.displayName || message.author.displayName || message.author.username,
      authorIsBot: message.author.bot,
      content,
      createdTimestamp: message.createdTimestamp,
      profile: safeCapture("profile", () => captureProfile(message), null),
      media: safeCapture("media", () => captureMedia(message), [] as MediaRecord[]),
      detail: safeCapture("detail", () => captureDetail(message), null)
    });
  }

  return {
    messages,
    before: batch.last()?.id
  };
};

export const cleanMessage = (message: Message) => {
  const attachmentSummary = message.attachments.size
    ? ` ${Array.from(message.attachments.values()).map((attachment) => `[첨부:${attachment.name ?? attachment.url}]`).join(" ")}`
    : "";
  const stickerSummary = message.stickers.size
    ? ` ${Array.from(message.stickers.values()).map((sticker) => `[스티커:${sticker.name}]`).join(" ")}`
    : "";

  return `${message.cleanContent}${attachmentSummary}${stickerSummary}`.replace(/\s+/g, " ").trim();
};

const formatForPrompt = (messages: HistoryMessage[], maxChars: number) => {
  const chronologicalMessages = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const grouped = new Map<Snowflake, { channelName: string; messages: HistoryMessage[] }>();

  for (const message of chronologicalMessages) {
    const group = grouped.get(message.channelId);
    if (group) {
      group.messages.push(message);
    } else {
      grouped.set(message.channelId, {
        channelName: message.channelName,
        messages: [message]
      });
    }
  }

  const chunks: string[] = [];
  let used = 0;
  let wroteChannel = false;

  for (const { channelName, messages: channelMessages } of grouped.values()) {
    const header = `${wroteChannel ? "\n" : ""}[${channelName}]\n`;
    if (used + header.length > maxChars) break;
    chunks.push(header);
    used += header.length;
    wroteChannel = true;

    for (const message of channelMessages) {
      const line = `${message.authorName}: ${message.content}\n`;
      if (used + line.length > maxChars) {
        chunks.push("\n[이후 기록은 컨텍스트 길이 제한으로 생략됨]\n");
        return chunks.join("");
      }
      chunks.push(line);
      used += line.length;
    }
  }

  return chunks.join("").trim();
};
