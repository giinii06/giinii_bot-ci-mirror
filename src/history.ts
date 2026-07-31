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
import { fetchRecentMessages } from "./storage.js";

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

export const collectDiscordHistory = async (guild: Guild, limit: number, channelInput?: string | null) => {
  await guild.channels.fetch();
  const channels = selectChannels(guild, channelInput);
  const perChannelLimit = Math.min(limit, PAGE_SIZE * 20);
  const settled = await Promise.allSettled(channels.map((channel) => fetchChannelMessages(channel, perChannelLimit)));
  const messages = settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    .slice(0, limit);

  const failedChannels = settled.filter((result) => result.status === "rejected").length;
  return {
    messages,
    text: formatForPrompt(messages, config.maxContextChars),
    messageCount: messages.length,
    channelCount: new Set(messages.map((message) => message.channelId)).size,
    scannedChannelCount: channels.length,
    failedChannels
  };
};

export const collectDiscordHistoryInBatches = async (
  guild: Guild,
  totalLimit: number,
  batchSize: number,
  onBatch: (messages: HistoryMessage[], totalCollected: number) => Promise<void>
) => {
  await guild.channels.fetch();
  const channels = selectChannels(guild);
  const cursors = new Map<Snowflake, Snowflake | undefined>();
  const exhausted = new Set<Snowflake>();
  let totalCollected = 0;
  let failedChannels = 0;

  while (totalCollected < totalLimit && exhausted.size < channels.length) {
    const batch: HistoryMessage[] = [];

    for (const channel of channels) {
      if (batch.length >= batchSize || totalCollected + batch.length >= totalLimit) break;
      if (exhausted.has(channel.id)) continue;

      try {
        const remaining = Math.min(batchSize - batch.length, totalLimit - totalCollected - batch.length);
        const page = await fetchChannelMessagePage(channel, remaining, cursors.get(channel.id));
        cursors.set(channel.id, page.before);

        if (page.messages.length === 0 || !page.before) exhausted.add(channel.id);
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

const fetchChannelMessages = async (channel: GuildTextBasedChannel, limit: number) => {
  const collected: HistoryMessage[] = [];
  let before: Snowflake | undefined;

  while (collected.length < limit) {
    const batch: Collection<Snowflake, Message> = await channel.messages.fetch({
      limit: Math.min(PAGE_SIZE, limit - collected.length),
      before
    });

    if (batch.size === 0) break;

    for (const message of batch.values()) {
      const content = cleanMessage(message);
      if (!content) continue;

      collected.push({
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

    before = batch.last()?.id;
    if (!before) break;
  }

  return collected;
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
