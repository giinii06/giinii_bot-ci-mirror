import { createReadStream, existsSync } from "node:fs";
import {
  AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  NoSubscriberBehavior, StreamType, VoiceConnectionStatus
} from "@discordjs/voice";
import { EmbedBuilder, PermissionFlagsBits, type ChatInputCommandInteraction, type Guild, type GuildMember, type VoiceBasedChannel } from "discord.js";
import { rouletteAudioPaths } from "./config.js";
import { noteBotVoiceMove } from "./dunk-detection.js";
import { all, run, sql } from "./storage.js";

const rouletteRuns = new Set<string>();
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const voiceChannel = (guild: Guild, channelId: string | null): VoiceBasedChannel | null => {
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  return channel?.isVoiceBased() ? channel : null;
};

const canBotPlayVoice = (channel: VoiceBasedChannel, botMember: GuildMember | null) => {
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  return !!permissions && permissions.has(PermissionFlagsBits.Connect) && permissions.has(PermissionFlagsBits.Speak);
};

const randomRouletteAudioPath = () => {
  const available = rouletteAudioPaths.filter((path) => existsSync(path));
  if (!available.length) throw new Error("No roulette audio files found");
  return available[Math.floor(Math.random() * available.length)]!;
};

const playRouletteAudio = async (guild: Guild, channel: VoiceBasedChannel, member: GuildMember) => {
  const path = randomRouletteAudioPath();
  if (!canBotPlayVoice(channel, guild.members.me)) {
    throw new Error(`Bot lacks Connect/Speak permission in voice channel ${channel.id}`);
  }
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000).catch((error) => {
      throw new Error(`Voice connection to ${channel.id} did not become ready (state: ${connection.state.status})`, { cause: error });
    });
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    connection.subscribe(player);
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        player.off("stateChange", onStateChange);
        player.off("error", onError);
        resolve();
      };
      const onStateChange = (_oldState: unknown, state: { status: AudioPlayerStatus }) => {
        if (state.status === AudioPlayerStatus.Idle) done();
      };
      const onError = (error: Error) => {
        player.off("stateChange", onStateChange);
        player.off("error", onError);
        reject(error);
      };
      player.on("stateChange", onStateChange);
      player.once("error", onError);
      const resource = path.toLowerCase().endsWith(".ogg")
        ? createAudioResource(createReadStream(path), { inputType: StreamType.OggOpus })
        : createAudioResource(path);
      player.play(resource);
    });
  } finally {
    noteBotVoiceMove(guild.id, member.id);
    await Promise.all([
      Promise.resolve().then(() => connection.destroy()),
      member.voice.disconnect("관리자 러시안 룰렛 종료")
    ]);
  }
};


export const isDefenseSuccess = (roll = Math.random()) => roll < 0.65;

const consumeDefenseRoles = async (member: GuildMember, roleIds: Set<string>) => {
  const rolesToRemove = [...roleIds].filter((roleId) => member.roles.cache.has(roleId));
  if (!rolesToRemove.length) return false;
  const updatedMember = await member.roles.remove(rolesToRemove, "관리자 러시안 룰렛 방어권 행사").catch((error) => {
    console.error("Defense role removal failed", error);
    return null;
  });
  return !!updatedMember && !rolesToRemove.some((roleId) => updatedMember.roles.cache.has(roleId));
};

const rouletteEmbed = (description: string, color = 0x5865f2) => new EmbedBuilder()
  .setColor(color)
  .setDescription(description);

const sendRouletteMessage = (
  interaction: ChatInputCommandInteraction, channels: VoiceBasedChannel[], message: string | EmbedBuilder
) => {
  const options = typeof message === "string" ? message : { embeds: [message] };
  const commandChannel = interaction.channel;
  const commandMessage = commandChannel?.isSendable()
    ? commandChannel.send(options).catch((error: unknown) => console.error("Roulette message send failed in command channel", error))
    : Promise.resolve();
  return Promise.all([
  commandMessage,
  ...channels.filter(({ id }) => id !== interaction.channelId).map((channel) =>
    channel.send(options).catch((error) => console.error(`Roulette message send failed in ${channel.id}`, error))
  )
  ]);
};

const runAdminRoulette = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  await interaction.deferReply();
  const settings = sql<{ target_role_id: string | null }>(guild.id, "SELECT target_role_id FROM settings WHERE guild_id = ?", guild.id);
  const targetRole = settings?.target_role_id ? await guild.roles.fetch(settings.target_role_id).catch(() => null) : null;
  if (!targetRole) return interaction.editReply({ embeds: [rouletteEmbed("먼저 `!타겟`의 인자를 `지정`으로 선택해 타겟 역할을 설정하세요.", 0xed4245)] });
  if (!rouletteAudioPaths.some((path) => existsSync(path))) {
    return interaction.editReply({ embeds: [rouletteEmbed("음성 파일이 설정되지 않았습니다. 기본 audio 파일 또는 VOICE_AUDIO_PATH를 확인하세요.", 0xed4245)] });
  }

  const invoker = guild.members.cache.get(interaction.user.id) ?? await guild.members.fetch(interaction.user.id);
  if (!invoker.roles.cache.has(targetRole.id)) return interaction.editReply({ embeds: [rouletteEmbed("ㅋ 역할도 없네 그지다", 0xed4245)] });
  const adminTargetRoleIds = new Set(all<{ role_id: string }>(
    guild.id, "SELECT role_id FROM admin_target_roles WHERE guild_id = ?", guild.id
  ).map(({ role_id }) => role_id));
  if (!adminTargetRoleIds.size) {
    return interaction.editReply({ embeds: [rouletteEmbed("이 서버는 아직 비활성화된 기능입니다. 관리자가 `!관리자_타겟` 인자 `지정`으로 역할을 지정해야 사용할 수 있습니다.", 0xed4245)] });
  }
  const defenseRoleIds = new Set(all<{ role_id: string }>(
    guild.id, "SELECT role_id FROM admin_defense_roles WHERE guild_id = ?", guild.id
  ).map(({ role_id }) => role_id));
  const admins = [...guild.voiceStates.cache.values()]
    .filter((state) => state.channelId && state.member && !state.member.user.bot &&
      state.member.roles.cache.some((role) => adminTargetRoleIds.has(role.id)))
    .map((state) => state.member!);
  if (!admins.length) return interaction.editReply({ embeds: [rouletteEmbed("통화방에 관리자가 없습니다.", 0xed4245)] });
  const defenseMembers = [...guild.voiceStates.cache.values()]
    .filter((state) => state.channelId && state.member && !state.member.user.bot && state.member.roles.cache.some((role) => defenseRoleIds.has(role.id)))
    .map((state) => state.member!);

  const countdownChannels = [...new Set([...admins, ...defenseMembers]
    .map((member) => member.voice.channelId)
    .filter((channelId): channelId is string => !!channelId))]
    .map((channelId) => voiceChannel(guild, channelId))
    .filter((channel): channel is VoiceBasedChannel => !!channel);

  const botMember = guild.members.me;
  if (targetRole.managed || !botMember || targetRole.position >= botMember.roles.highest.position) {
    return interaction.editReply({ embeds: [rouletteEmbed("타겟 역할이 봇 역할보다 높거나 관리되는 역할입니다.", 0xed4245)] });
  }
  const missingVoicePermission = [...admins, invoker].find((member) => {
    const channel = voiceChannel(guild, member.voice.channelId);
    return !!channel && !canBotPlayVoice(channel, botMember);
  });
  if (missingVoicePermission) {
    return interaction.editReply({ embeds: [rouletteEmbed("봇에게 대상 음성 채널의 `연결` 및 `말하기` 권한이 필요합니다.", 0xed4245)] });
  }
  const updatedInvoker = await invoker.roles.remove(targetRole, "관리자 러시안 룰렛 시작").catch((error) => {
    console.error("Target role removal failed", error);
    return null;
  });
  if (!updatedInvoker || updatedInvoker.roles.cache.has(targetRole.id)) {
    return interaction.editReply({ embeds: [rouletteEmbed("타겟 역할 제거에 실패했습니다.", 0xed4245)] });
  }
  await interaction.deleteReply().catch((error) => console.error("Roulette deferred reply cleanup failed", error));

  await sendRouletteMessage(interaction, countdownChannels, `${invoker} 님이 관리자머리끄댕이를 사용하였습니다!`);
  const autoDefendedIds = new Set<string>();
  const defenders = (await Promise.all(
    defenseMembers.map(async (member) => await consumeDefenseRoles(member, defenseRoleIds) ? member : null)
  )).filter((member): member is GuildMember => !!member);
  if (defenders.length) {
    const defenderMentions = defenders.map(({ id }) => `<@${id}>`).join(", ");
    if (!isDefenseSuccess()) {
      await sendRouletteMessage(interaction, countdownChannels,
        rouletteEmbed(`${defenderMentions} 방어 실패! 으!@!@`, 0xed4245));
      await Promise.all(defenders.map((defender) => {
        noteBotVoiceMove(guild.id, defender.id);
        return defender.voice.disconnect("관리자 러시안 룰렛 방어권 실패").catch((error) => {
          console.error("Defense failure disconnect failed", error);
        });
      }));
      return;
    }
    defenders.forEach(({ id }) => autoDefendedIds.add(id));
    await sendRouletteMessage(interaction, countdownChannels, rouletteEmbed(`${defenderMentions} 방어 성공!`, 0x57f287));
  }
  if (defenders.length && admins.every(({ id }) => autoDefendedIds.has(id))) {
    return sendRouletteMessage(interaction, countdownChannels, "저런... 통방에 남은 관리자가 없군요 ㅠㅠ ");
  }

  const runCountdown = async () => {
    for (const content of ["3...", "2...", "1..."]) {
      await sendRouletteMessage(interaction, countdownChannels, content);
      await sleep(1_000);
    }
  };

  await runCountdown();

  let target: GuildMember;
  const remainingAdmins = admins.filter(({ id }) => !autoDefendedIds.has(id));
  const lucky = Math.random() < 0.05 && !!invoker.voice.channelId;
  target = lucky && !autoDefendedIds.has(invoker.id)
    ? invoker
    : remainingAdmins[Math.floor(Math.random() * remainingAdmins.length)]!;
  const targetChannel = voiceChannel(guild, target.voice.channelId);
  if (!targetChannel) {
    return sendRouletteMessage(interaction, countdownChannels, rouletteEmbed("대상 유저가 통화방을 나갔습니다.", 0xed4245));
  }
  await sendRouletteMessage(interaction, countdownChannels, rouletteEmbed(`🎯 **${target}** 당첨!\n으!@!!!@!`, 0xed4245));
  try {
    await playRouletteAudio(guild, targetChannel, target);
  } catch (error) {
    console.error("Admin roulette voice playback failed", error);
    await sendRouletteMessage(interaction, countdownChannels, rouletteEmbed("음성 재생에 실패했지만 룰렛은 종료되었습니다.", 0xf1c40f));
  }
};

export const handleRouletteCommand = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  if (interaction.commandName !== "관리자머리끄댕이") return false;
  if (rouletteRuns.has(guild.id)) return interaction.reply({ ephemeral: true, content: "이미 진행 중인 관리자 러시안 룰렛이 있습니다." });
  rouletteRuns.add(guild.id);
  try {
    await runAdminRoulette(interaction, guild);
  } finally {
    rouletteRuns.delete(guild.id);
  }
  return true;
};
