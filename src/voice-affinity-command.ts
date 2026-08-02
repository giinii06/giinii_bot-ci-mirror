import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { all } from "./storage.js";
import { renderVoiceAffinity } from "./voice-affinity-card.js";
import { buildVoiceAffinity, type VoiceInterval } from "./voice-affinity.js";

const voiceAffinityPages = new Map<string, Buffer[]>();

const voiceAffinityComponents = (page: number, pageCount: number) => [new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`voice-affinity:${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
  new ButtonBuilder().setCustomId(`voice-affinity:${page}`).setLabel(`${page + 1} / ${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(),
  new ButtonBuilder().setCustomId(`voice-affinity:${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page === pageCount - 1),
)];

export const handleVoiceAffinityCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: "이 명령어는 디스코드 서버에서만 사용할 수 있어요.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const target = interaction.options.getUser("유저", true);
  const now = Date.now();
  const targetSessions = all<VoiceInterval>(
    "SELECT user_id, channel_id, started_at, ended_at FROM voice_presence_sessions WHERE guild_id = ? AND user_id = ?",
    guild.id, target.id,
  );
  const otherSessions = all<VoiceInterval>(
    "SELECT user_id, channel_id, started_at, ended_at FROM voice_presence_sessions WHERE guild_id = ? AND user_id != ?",
    guild.id, target.id,
  );
  const affinities = buildVoiceAffinity(targetSessions, otherSessions, now).slice(0, 21);
  if (!affinities.length) {
    return interaction.reply({ content: `${target}님과 같은 음성 채널에 함께 있었던 기록이 없습니다.` });
  }

  await interaction.deferReply();
  const entries = await Promise.all(affinities.map(async (affinity) => {
    const member = await guild.members.fetch(affinity.user_id).catch(() => null);
    const user = member?.user ?? await interaction.client.users.fetch(affinity.user_id).catch(() => null);
    return {
      name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저",
      username: user?.username ?? "unknown",
      sharedMs: affinity.shared_ms,
    };
  }));
  const targetMember = await guild.members.fetch(target.id).catch(() => null);
  const targetName = targetMember?.displayName ?? target.globalName ?? target.username;
  const pageCount = Math.ceil(entries.length / 7);
  const pages = await Promise.all(Array.from({ length: pageCount }, (_, page) => renderVoiceAffinity(
    targetName,
    entries.slice(page * 7, page * 7 + 7),
    now,
    page * 7 + 1,
    entries.length,
  )));
  const message = await interaction.editReply({
    files: [{ attachment: pages[0]!, name: "voice-affinity.png" }],
    components: voiceAffinityComponents(0, pageCount),
  });
  voiceAffinityPages.set(message.id, pages);
  setTimeout(() => voiceAffinityPages.delete(message.id), 15 * 60_000);
  return message;
};

export const handleVoiceAffinityComponent = async (interaction: ButtonInteraction) => {
  const page = Number(interaction.customId.slice("voice-affinity:".length));
  const pages = voiceAffinityPages.get(interaction.message.id);
  if (!Number.isInteger(page) || !pages?.[page]) {
    return interaction.reply({ content: "친밀도 결과가 만료되었습니다. `/친밀도`를 다시 실행하세요.", ephemeral: true });
  }
  return interaction.update({
    attachments: [],
    files: [{ attachment: pages[page], name: "voice-affinity.png" }],
    components: voiceAffinityComponents(page, pages.length),
  });
};
