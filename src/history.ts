import {
  ChannelType,
  PermissionFlagsBits,
  type Collection,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type Snowflake
} from "discord.js";
import { config } from "./config.js";
import { fetchRecentMessages, type StoredChannelRanges } from "./storage.js";

const PAGE_SIZE = 100;

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
      createdTimestamp: message.createdTimestamp
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
