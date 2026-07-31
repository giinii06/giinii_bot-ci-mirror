import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, FileUploadBuilder, LabelBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, type ButtonInteraction, type ChatInputCommandInteraction,
  type Guild, type ModalSubmitInteraction
} from "discord.js";
import { databasePath } from "./config.js";
import { renderMemory } from "./leaderboard.js";
import { all, run, sql } from "./storage.js";

type Memory = {
  id: number; guild_id: string; channel_id: string; creator_name: string; creator_avatar_url: string | null;
  event_name: string; started_at: number; active: number; ended_at: number | null; image_path: string | null;
};
type MemoryEntry = { display_name: string; avatar_url: string | null; content: string; image_path: string | null };

const formatMemoryTime = (time: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
  }).formatToParts(new Date(time)).map(({ type, value }) => [type, value]));
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.dayPeriod} ${Number(parts.hour)}시 ${parts.minute}분`;
};

const memoryComponents = (memoryId: number) => [new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId(`memory:write:${memoryId}`).setLabel("소감 쓰기").setStyle(ButtonStyle.Primary)
)];

const handleMemoryStart = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  await interaction.deferReply();
  if (sql<Memory>("SELECT * FROM memories WHERE guild_id = ? AND active = 1 LIMIT 1", guild.id)) {
    return interaction.editReply("이미 진행 중인 추억 만들기가 있습니다. 먼저 `/추억만들기종료`를 사용해주세요.");
  }
  const eventName = interaction.options.getString("이벤트", true).trim();
  if (!eventName) return interaction.editReply("이벤트 이름을 입력해주세요.");
  const member = await guild.members.fetch(interaction.user.id);
  const inserted = run(`INSERT INTO memories (guild_id, channel_id, creator_name, creator_avatar_url, event_name, started_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, guild.id, interaction.channelId, member.displayName,
    member.displayAvatarURL({ extension: "png", size: 256 }), eventName, Date.now());
  if (!inserted.changes) return interaction.editReply("이미 진행 중인 추억 만들기가 있습니다. 먼저 `/추억만들기종료`를 사용해주세요.");
  const memoryId = Number(inserted.lastInsertRowid);
  return interaction.editReply({ content: `**${eventName}** 추억을 시작합니다.\n소감을 작성해주세요!`,
    allowedMentions: { parse: [] }, components: memoryComponents(memoryId) });
};

export const handleMemoryButton = async (interaction: ButtonInteraction) => {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  const memoryId = Number(interaction.customId.slice("memory:write:".length));
  if (!sql<Memory>("SELECT * FROM memories WHERE id = ? AND active = 1", memoryId)) {
    return interaction.reply({ ephemeral: true, content: "이미 종료된 추억 만들기입니다." });
  }
  const modal = new ModalBuilder().setCustomId(`memory:submit:${memoryId}`).setTitle("소감 쓰기");
  const input = new TextInputBuilder().setCustomId("content").setLabel("소감을 작성해주세요")
    .setStyle(TextInputStyle.Paragraph).setPlaceholder("이 순간에 대한 소감을 남겨주세요")
    .setMinLength(1).setMaxLength(1_000).setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  modal.addComponents(new LabelBuilder().setLabel("첨부 이미지 (선택)").setFileUploadComponent(
    new FileUploadBuilder().setCustomId("image").setMaxValues(1).setRequired(false)
  ));
  return interaction.showModal(modal);
};

const memoryDataPath = (memoryId: number, userId: string) =>
  join(dirname(databasePath), "memories", String(memoryId), `${userId}.png`);
const memoryPagePath = (memoryId: number, page: number) =>
  join(dirname(databasePath), "memories", String(memoryId), `memory-${page}.png`);

const saveMemoryImage = async (memoryId: number, userId: string, attachment: { url: string; contentType: string | null }) => {
  if (!attachment.contentType?.startsWith("image/")) throw new Error("이미지 파일만 첨부할 수 있습니다.");
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);
  const path = memoryDataPath(memoryId, userId);
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
};

export const handleMemorySubmit = async (interaction: ModalSubmitInteraction) => {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  await interaction.deferReply({ ephemeral: true });
  const memoryId = Number(interaction.customId.slice("memory:submit:".length));
  const memory = sql<Memory>("SELECT * FROM memories WHERE id = ? AND active = 1", memoryId);
  if (!memory) return interaction.editReply("이미 종료된 추억 만들기입니다.");
  const content = interaction.fields.getTextInputValue("content").trim();
  if (!content) return interaction.editReply("소감 내용을 입력해주세요.");
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const uploaded = interaction.fields.getUploadedFiles("image")?.first();
  const imagePath = uploaded ? await saveMemoryImage(memoryId, interaction.user.id, uploaded) : null;
  run(`INSERT INTO memory_entries (memory_id, user_id, display_name, avatar_url, content, image_path)
    VALUES (?, ?, ?, ?, ?, ?)`, memoryId, interaction.user.id, member.displayName,
    member.displayAvatarURL({ extension: "png", size: 256 }), content, imagePath);
  const count = sql<{ count: number }>("SELECT COUNT(*) AS count FROM memory_entries WHERE memory_id = ?", memoryId)!.count;
  const channel = await interaction.guild!.channels.fetch(memory.channel_id).catch(() => null);
  if (channel?.isTextBased()) await channel.send({
    content: `${interaction.user}님이 소감을 작성하였습니다 (총 ${count}개)`, allowedMentions: { users: [interaction.user.id] }
  }).catch(() => undefined);
  return interaction.editReply("소감이 저장되었습니다.");
};

const renderAndSaveMemory = async (memory: Memory, entries: MemoryEntry[]) => {
  const images = await renderMemory(memory.event_name,
    { name: memory.creator_name, avatarUrl: memory.creator_avatar_url ?? undefined }, formatMemoryTime(memory.started_at),
    entries.map((entry) => ({ name: entry.display_name, avatarUrl: entry.avatar_url ?? undefined,
      content: entry.content, imagePath: entry.image_path ?? undefined })));
  const imagePaths = images.map((_, index) => memoryPagePath(memory.id, index + 1));
  mkdirSync(dirname(imagePaths[0]!), { recursive: true });
  await Promise.all(images.map((image, index) => writeFile(imagePaths[index]!, image)));
  run("UPDATE memories SET image_path = ? WHERE id = ?", imagePaths[0]!, memory.id);
  return { images, imagePaths };
};

const handleMemoryEnd = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  await interaction.deferReply();
  const memory = sql<Memory>("SELECT * FROM memories WHERE guild_id = ? AND active = 1 ORDER BY started_at DESC LIMIT 1", guild.id);
  if (!memory) return interaction.editReply("진행 중인 추억 만들기가 없습니다.");
  if (!run("UPDATE memories SET active = 0, ended_at = ? WHERE id = ? AND active = 1", Date.now(), memory.id).changes) {
    return interaction.editReply("이미 종료된 추억 만들기입니다.");
  }
  const entries = all<MemoryEntry>("SELECT display_name, avatar_url, content, image_path FROM memory_entries WHERE memory_id = ? ORDER BY id", memory.id);
  const { images } = await renderAndSaveMemory(memory, entries);
  return interaction.editReply({ content: `추억 #${memory.id}을 저장했습니다.`,
    files: images.map((image, index) => ({ attachment: image, name: `memory-${index + 1}.png` })) });
};

const handleMemoryView = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  await interaction.deferReply();
  const id = interaction.options.getInteger("번호");
  const memory = id
    ? sql<Memory>("SELECT * FROM memories WHERE guild_id = ? AND id = ? AND active = 0", guild.id, id)
    : sql<Memory>("SELECT * FROM memories WHERE guild_id = ? AND active = 0 ORDER BY started_at DESC LIMIT 1", guild.id);
  if (!memory) return interaction.editReply("저장된 추억을 찾을 수 없습니다.");
  if (memory.image_path && existsSync(memory.image_path)) {
    const paths = [memory.image_path];
    if (memory.image_path === memoryPagePath(memory.id, 1)) {
      for (let page = 2; existsSync(memoryPagePath(memory.id, page)); page++) paths.push(memoryPagePath(memory.id, page));
    }
    return interaction.editReply({ content: `추억 #${memory.id} · ${memory.event_name}`,
      files: paths.map((path, index) => ({ attachment: path, name: `memory-${index + 1}.png` })) });
  }
  const entries = all<MemoryEntry>("SELECT display_name, avatar_url, content, image_path FROM memory_entries WHERE memory_id = ? ORDER BY id", memory.id);
  const { images } = await renderAndSaveMemory(memory, entries);
  return interaction.editReply({ content: `추억 #${memory.id} · ${memory.event_name}`,
    files: images.map((image, index) => ({ attachment: image, name: `memory-${index + 1}.png` })) });
};

export const handleMemoryCommand = async (interaction: ChatInputCommandInteraction, guild: Guild) => {
  if (interaction.commandName === "추억만들기시작") return handleMemoryStart(interaction, guild);
  if (interaction.commandName === "추억만들기종료") return handleMemoryEnd(interaction, guild);
  if (interaction.commandName === "추억조회") return handleMemoryView(interaction, guild);
  return false;
};
