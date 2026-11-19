import {
  EmbedBuilder, PermissionFlagsBits, type Guild, type Message, type VoiceBasedChannel, type VoiceState
} from "discord.js";
import { ADMIN_USER_ID } from "./admin-commands.js";
import { ALLOWED_GUILD_ID, isAllowedGuild } from "./command-rules.js";
import { createNoticeEmbed } from "./embeds.js";
import { run, sql } from "./storage.js";

export type DunkSettings = { guildId: string; logChannelId: string | null; thresholdSeconds: number };

export type VoiceTransition = {
  guildId: string; userId: string; isBot: boolean;
  oldChannelId: string | null; newChannelId: string | null; now: number;
};

export type DunkHit = { userId: string; channelId: string; seconds: number };

export type DunkEvent = DunkHit & { witnessIds: string[] };

export type DunkTracker = {
  noteBotMove: (guildId: string, userId: string, now: number) => void;
  track: (transition: VoiceTransition, thresholdSeconds: number) => DunkHit | null;
};

export const DEFAULT_THRESHOLD_SECONDS = 60;
export const MIN_THRESHOLD_SECONDS = 1;
export const MAX_THRESHOLD_SECONDS = 86_400;
export const BOT_MOVE_TTL_MS = 10_000;

const INSTALL_COMMAND = "!들낙감지설치";
const THRESHOLD_COMMAND = "!들낙시간지정";

export const getDunkSettings = (guildId: string): DunkSettings => {
  const row = sql<{ log_channel_id: string | null; threshold_seconds: number }>(
    guildId, "SELECT log_channel_id, threshold_seconds FROM dunk_settings WHERE guild_id = ?", guildId
  );
  return {
    guildId,
    logChannelId: row?.log_channel_id ?? null,
    thresholdSeconds: row?.threshold_seconds ?? DEFAULT_THRESHOLD_SECONDS
  };
};

/**
 * 입장 시각은 메모리에만 둔다. 재시작으로 사라지면 그 한 건을 놓칠 뿐이고,
 * 봇이 끊은 전환은 표식으로 한 번만 건너뛴다.
 */
export const createDunkTracker = (): DunkTracker => {
  const pendingJoins = new Map<string, { channelId: string; joinedAt: number }>();
  const botMoves = new Map<string, number>();
  const keyOf = (guildId: string, userId: string) => `${guildId}:${userId}`;

  const consumeBotMove = (key: string, now: number) => {
    const expiresAt = botMoves.get(key);
    if (expiresAt === undefined) return false;
    botMoves.delete(key);
    return expiresAt > now;
  };

  return {
    noteBotMove: (guildId, userId, now) => {
      botMoves.set(keyOf(guildId, userId), now + BOT_MOVE_TTL_MS);
    },
    track: (transition, thresholdSeconds) => {
      const { guildId, userId, isBot, oldChannelId, newChannelId, now } = transition;
      if (isBot) return null;
      if (oldChannelId === newChannelId) return null;
      const key = keyOf(guildId, userId);

      let hit: DunkHit | null = null;
      if (oldChannelId) {
        const suppressed = consumeBotMove(key, now);
        const joined = pendingJoins.get(key);
        pendingJoins.delete(key);
        if (joined && joined.channelId === oldChannelId && !suppressed) {
          const elapsed = now - joined.joinedAt;
          if (elapsed <= thresholdSeconds * 1000) {
            hit = { userId, channelId: oldChannelId, seconds: Math.max(1, Math.round(elapsed / 1000)) };
          }
        }
      }
      // 봇이 A에서 B로 옮긴 경우 떠난 쪽만 막고, 새 방은 계속 추적해야 다음 이탈을 잡는다.
      if (newChannelId && !consumeBotMove(key, now)) {
        pendingJoins.set(key, { channelId: newChannelId, joinedAt: now });
      }
      return hit;
    }
  };
};

const tracker = createDunkTracker();

export const noteBotVoiceMove = (guildId: string, userId: string) => {
  tracker.noteBotMove(guildId, userId, Date.now());
};

export const formatDunkMessage = (event: DunkEvent) => {
  const leaver = `<@${event.userId}>`;
  const room = `<#${event.channelId}>`;
  const witnesses = event.witnessIds.map((id) => `<@${id}>`).join(", ");
  return witnesses
    ? `${leaver} (이)가 ${witnesses} 등등이 있던 통방 ${room} 을 ${event.seconds}초만에 들낙했습니다!`
    : `${leaver} (이)가 ${room} 을 ${event.seconds}초만에 들낙했습니다!`;
};

const witnessIdsOf = (channel: VoiceBasedChannel | null | undefined, leaverId: string) =>
  channel
    ? [...channel.members.values()]
      .filter((member) => member.id !== leaverId && !member.user.bot)
      .map((member) => member.id)
    : [];

const sendDunkLog = async (guild: Guild, channelId: string, event: DunkEvent) => {
  const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) {
    console.error(`Dunk log channel ${channelId} is missing or not sendable`);
    return;
  }
  await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle("들낙 감지")
      .setColor(0xed4245)
      .setDescription(formatDunkMessage(event))
      .setTimestamp()],
    allowedMentions: { parse: ["users"] }
  });
};

export const handleDunkVoiceUpdate = (oldState: VoiceState, newState: VoiceState) => {
  const guildId = newState.guild.id;
  if (!isAllowedGuild(guildId)) return;
  const settings = getDunkSettings(guildId);
  if (!settings.logChannelId) return;
  const hit = tracker.track({
    guildId,
    userId: newState.id,
    isBot: newState.member?.user.bot ?? false,
    oldChannelId: oldState.channelId,
    newChannelId: newState.channelId,
    now: Date.now()
  }, settings.thresholdSeconds);
  if (!hit) return;
  const oldChannel = oldState.channel
    ?? (oldState.channelId ? newState.guild.channels.cache.get(oldState.channelId) : null);
  const witnessIds = witnessIdsOf(oldChannel?.isVoiceBased() ? oldChannel : null, hit.userId);
  void sendDunkLog(newState.guild, settings.logChannelId, { ...hit, witnessIds })
    .catch((error) => console.error("Dunk log send failed", error));
};

export const isDunkCommand = (content: string) => {
  const [head] = content.trim().split(/\s+/);
  return head === INSTALL_COMMAND || head === THRESHOLD_COMMAND;
};

/** 바꾼 컬럼만 덮어쓰고 나머지는 저장된 값을 유지한다. */
const saveDunkSettings = (
  guildId: string, patch: { logChannelId?: string; thresholdSeconds?: number }, userId: string
) => {
  const current = getDunkSettings(guildId);
  run(guildId, `INSERT INTO dunk_settings (guild_id, log_channel_id, threshold_seconds, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      log_channel_id = excluded.log_channel_id, threshold_seconds = excluded.threshold_seconds,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    guildId, patch.logChannelId ?? current.logChannelId, patch.thresholdSeconds ?? current.thresholdSeconds,
    Date.now(), userId);
};

const thresholdLine = (seconds: number) =>
  `현재 기준은 ${seconds}초입니다. \`${THRESHOLD_COMMAND} [초]\` 로 바꿀 수 있어요.`;

const handleInstall = async (message: Message, guildId: string, args: string[]) => {
  if (args.length > 0) {
    await message.reply({ embeds: [createNoticeEmbed("사용법",
      `\`${INSTALL_COMMAND}\` 는 인자 없이 지금 채널에 설치합니다.\n로그 채널을 옮기려면 옮길 채널에서 다시 실행해 주세요.`)] });
    return;
  }
  const channelId = message.channelId;
  const current = getDunkSettings(guildId);
  if (current.logChannelId === channelId) {
    await message.reply({ embeds: [createNoticeEmbed("들낙 감지 설치",
      `<#${channelId}> 에는 이미 설치돼 있어요.\n${thresholdLine(current.thresholdSeconds)}`)] });
    return;
  }
  saveDunkSettings(guildId, { logChannelId: channelId }, message.author.id);
  const moved = current.logChannelId
    ? `들낙 감지 로그 채널을 <#${current.logChannelId}> 에서 <#${channelId}> 로 옮겼어요.`
    : `이제 <#${channelId}> 로 들낙 감지 로그가 옵니다.`;
  await message.reply({ embeds: [createNoticeEmbed("들낙 감지 설치",
    `${moved}\n${thresholdLine(current.thresholdSeconds)}`)] });
};

const handleThreshold = async (message: Message, guildId: string, args: string[]) => {
  const [value, ...rest] = args;
  const invalid = createNoticeEmbed("숫자를 확인해 주세요",
    `들낙 기준은 ${MIN_THRESHOLD_SECONDS}초부터 ${MAX_THRESHOLD_SECONDS}초까지의 정수여야 해요.\n예) \`${THRESHOLD_COMMAND} 30\``);
  if (!value || rest.length > 0) {
    await message.reply({ embeds: [createNoticeEmbed("사용법",
      `\`${THRESHOLD_COMMAND} [초]\` 처럼 숫자 하나를 붙여 주세요.\n예) \`${THRESHOLD_COMMAND} 30\``)] });
    return;
  }
  if (!/^\d+$/.test(value)) {
    await message.reply({ embeds: [invalid] });
    return;
  }
  const seconds = Number(value);
  if (seconds < MIN_THRESHOLD_SECONDS || seconds > MAX_THRESHOLD_SECONDS) {
    await message.reply({ embeds: [invalid] });
    return;
  }
  saveDunkSettings(guildId, { thresholdSeconds: seconds }, message.author.id);
  const settings = getDunkSettings(guildId);
  const installHint = settings.logChannelId
    ? ""
    : `\n로그를 받을 채널이 아직 없어요. \`${INSTALL_COMMAND}\` 로 먼저 설치해 주세요.`;
  await message.reply({ embeds: [createNoticeEmbed("들낙 시간 지정",
    `들낙 기준을 ${seconds}초로 바꿨어요. 이 시간 안에 들어왔다 나가면 감지합니다.${installHint}`)] });
};

export const handleDunkCommand = async (message: Message): Promise<boolean> => {
  if (message.author.bot) return false;
  const content = message.content.trim();
  if (!isDunkCommand(content)) return false;
  const guildId = message.guildId;
  if (guildId !== ALLOWED_GUILD_ID) {
    await message.reply({ embeds: [createNoticeEmbed("이 서버에서는 쓸 수 없어요",
      "들낙 감지는 지정된 서버에서만 동작합니다.", "error")] });
    return true;
  }
  const isAdministrator = message.author.id === ADMIN_USER_ID
    || (message.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false);
  if (!isAdministrator) {
    await message.reply({ embeds: [createNoticeEmbed("권한이 없어요",
      "이 명령어는 서버 관리자만 쓸 수 있어요.", "error")] });
    return true;
  }
  const [head, ...args] = content.split(/\s+/);
  if (head === INSTALL_COMMAND) await handleInstall(message, guildId, args);
  else await handleThreshold(message, guildId, args);
  return true;
};
