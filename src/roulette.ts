import { createReadStream, existsSync } from "node:fs";
import {
  AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  NoSubscriberBehavior, StreamType, VoiceConnectionStatus
} from "@discordjs/voice";
import type { ChatInputCommandInteraction, Guild, GuildMember, VoiceBasedChannel } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { rouletteAudioPaths } from "./config.js";
import { all, run, sql } from "./storage.js";

const rouletteRuns = new Map<string, Promise<unknown>>();
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const voiceChannel = (guild: Guild, channelId: string | null): VoiceBasedChannel | null => {
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  return channel?.isVoiceBased() ? channel : null;
};

const randomRouletteAudioPath = () => {
  const available = rouletteAudioPaths.filter((path) => existsSync(path));
  if (!available.length) throw new Error("No roulette audio files found");
  return available[Math.floor(Math.random() * available.length)]!;
};

const playRouletteAudio = async (guild: Guild, channel: VoiceBasedChannel, member: GuildMember) => {
  const path = randomRouletteAudioPath();
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
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
    await Promise.all([
      Promise.resolve().then(() => connection.destroy()),
      member.voice.disconnect("관리자 러시안 룰렛 종료")
    ]);
  }
};

const isAdmin = (interaction: ChatInputCommandInteraction) =>
  interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

const runAdminRoulette = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  await interaction.deferReply();
  const settings = sql<{ target_role_id: string | null }>("SELECT target_role_id FROM settings WHERE guild_id = ?", guild.id);
  const targetRole = settings?.target_role_id ? await guild.roles.fetch(settings.target_role_id).catch(() => null) : null;
  if (!targetRole) return interaction.editReply("먼저 `/타겟역할설정`으로 타겟 역할을 설정하세요.");
  if (!rouletteAudioPaths.some((path) => existsSync(path))) {
    return interaction.editReply("음성 파일이 설정되지 않았습니다. 기본 audio 파일 또는 VOICE_AUDIO_PATH를 확인하세요.");
  }

  const invoker = guild.members.cache.get(interaction.user.id) ?? await guild.members.fetch(interaction.user.id);
  if (!invoker.roles.cache.has(targetRole.id)) return interaction.editReply("ㅋ 역할도 없네 그지다");
  const adminTargetRoleIds = new Set(all<{ role_id: string }>(
    "SELECT role_id FROM admin_target_roles WHERE guild_id = ?", guild.id
  ).map(({ role_id }) => role_id));
  const admins = [...guild.voiceStates.cache.values()]
    .filter((state) => state.channelId && state.member && !state.member.user.bot &&
      (state.member.permissions.has(PermissionFlagsBits.Administrator) || state.member.roles.cache.some((role) => adminTargetRoleIds.has(role.id))))
    .map((state) => state.member!);
  if (!admins.length) return interaction.editReply("통화방에 관리자가 없습니다.");

  const botMember = guild.members.me;
  if (targetRole.managed || !botMember || targetRole.position >= botMember.roles.highest.position) {
    return interaction.editReply("타겟 역할이 봇 역할보다 높거나 관리되는 역할입니다.");
  }
  const lucky = Math.random() < 0.05 && !!invoker.voice.channelId;
  const target = lucky ? invoker : admins[Math.floor(Math.random() * admins.length)]!;
  const targetChannel = voiceChannel(guild, lucky ? invoker.voice.channelId : target.voice.channelId);
  if (!targetChannel) return interaction.editReply("대상 유저가 통화방에 없습니다.");
  const updatedInvoker = await invoker.roles.remove(targetRole, "관리자 러시안 룰렛 시작").catch((error) => {
    console.error("Target role removal failed", error);
    return null;
  });
  if (!updatedInvoker || updatedInvoker.roles.cache.has(targetRole.id)) return interaction.editReply("타겟 역할 제거에 실패했습니다.");

  await interaction.editReply("3...");
  await sleep(1_000);
  await interaction.followUp("2...");
  await sleep(1_000);
  await interaction.followUp("1...");
  await sleep(1_000);
  await interaction.followUp(`${target} 당첨! 으!@!!!@!`);
  try {
    await playRouletteAudio(guild, targetChannel, target);
  } catch (error) {
    console.error("Admin roulette voice playback failed", error);
    await interaction.followUp("음성 재생에 실패했지만 룰렛은 종료되었습니다.");
  }
};

export const handleRouletteCommand = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  if (interaction.commandName === "타겟역할설정") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 설정할 수 있습니다." });
    const role = interaction.options.getRole("역할", true);
    const me = guild.members.me;
    if (role.managed || !me || role.position >= me.roles.highest.position) {
      return interaction.reply({ ephemeral: true, content: "봇 역할보다 낮고 관리되지 않은 역할만 설정할 수 있습니다." });
    }
    run(`INSERT INTO settings (guild_id, target_role_id) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET target_role_id = excluded.target_role_id`, guild.id, role.id);
    return interaction.reply({ ephemeral: true, content: `${role}을(를) 타겟 역할로 설정했습니다.` });
  }
  if (interaction.commandName === "관리자역할추가") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 설정할 수 있습니다." });
    const role = interaction.options.getRole("역할", true);
    if (role.id === guild.id) return interaction.reply({ ephemeral: true, content: "@everyone 역할은 추가할 수 없습니다." });
    run("INSERT OR IGNORE INTO admin_target_roles (guild_id, role_id) VALUES (?, ?)", guild.id, role.id);
    return interaction.reply({ ephemeral: true, content: `${role}을(를) 관리자 타겟 역할로 추가했습니다.` });
  }
  if (interaction.commandName !== "관리자머리끄댕이") return false;
  if (rouletteRuns.has(guild.id)) return interaction.reply({ ephemeral: true, content: "이미 진행 중인 관리자 러시안 룰렛이 있습니다." });
  const pending = runAdminRoulette(interaction, guild);
  rouletteRuns.set(guild.id, pending);
  try { await pending; } finally {
    if (rouletteRuns.get(guild.id) === pending) rouletteRuns.delete(guild.id);
  }
  return true;
};
