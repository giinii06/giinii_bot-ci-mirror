import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { renderMemory } from "./leaderboard.js";
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type Role,
  type TextChannel,
  type VoiceBasedChannel,
} from "discord.js";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite";
const rouletteAudioPaths = [
  process.env.VOICE_AUDIO_PATH ?? "./audio/roulette.ogg",
  "./audio/roulette-2.ogg",
  "./audio/roulette-3.ogg",
];
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath, { create: true });
const KST = 9 * 60 * 60 * 1000;

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    chat_total INTEGER NOT NULL DEFAULT 0, voice_total REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS activity (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, bucket_type TEXT NOT NULL, bucket_key TEXT NOT NULL,
    chat_count INTEGER NOT NULL DEFAULT 0, voice_seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, bucket_type, bucket_key)
  );
  CREATE TABLE IF NOT EXISTS settings (guild_id TEXT PRIMARY KEY, target_role_id TEXT);
  CREATE TABLE IF NOT EXISTS voice_sessions (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    last_tick INTEGER NOT NULL, limited INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS admin_target_roles (
    guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    creator_name TEXT NOT NULL, creator_avatar_url TEXT, event_name TEXT NOT NULL,
    started_at INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, ended_at INTEGER, image_path TEXT
  );
  CREATE TABLE IF NOT EXISTS memory_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL, user_id TEXT NOT NULL, display_name TEXT NOT NULL,
    avatar_url TEXT, content TEXT NOT NULL, image_path TEXT,
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS memories_one_active_guild ON memories(guild_id) WHERE active = 1;
`);
for (const [table, column] of [["memories", "image_path"], ["memory_entries", "image_path"]]) {
  if (!all<{ name: string }>(`PRAGMA table_info(${table})`).some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
  }
}
if (!all<{ name: string }>("PRAGMA table_info(memory_entries)").some((entry) => entry.name === "id")) {
  db.exec(`
    CREATE TABLE memory_entries_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id INTEGER NOT NULL, user_id TEXT NOT NULL,
      display_name TEXT NOT NULL, avatar_url TEXT, content TEXT NOT NULL, image_path TEXT,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    INSERT INTO memory_entries_new (memory_id, user_id, display_name, avatar_url, content, image_path)
      SELECT memory_id, user_id, display_name, avatar_url, content, image_path FROM memory_entries ORDER BY rowid;
    DROP TABLE memory_entries;
    ALTER TABLE memory_entries_new RENAME TO memory_entries;
  `);
}
if (!all<{ name: string }>("PRAGMA table_info(settings)").some((column) => column.name === "target_role_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN target_role_id TEXT");
}
if (all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roulette_target_roles'").length) {
  for (const { guild_id, role_id } of all<{ guild_id: string; role_id: string }>("SELECT guild_id, MIN(role_id) AS role_id FROM roulette_target_roles GROUP BY guild_id")) {
    run(`INSERT INTO settings (guild_id, target_role_id) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET target_role_id = excluded.target_role_id`, guild_id, role_id);
  }
}
const commands = [
  new SlashCommandBuilder().setName("추억만들기시작").setDescription("새로운 추억을 만들고 소감을 받습니다")
    .addStringOption((o) => o.setName("이벤트").setDescription("추억의 이벤트 이름").setRequired(true).setMinLength(1).setMaxLength(100)),
  new SlashCommandBuilder().setName("추억만들기종료").setDescription("진행 중인 추억을 이미지로 저장합니다"),
  new SlashCommandBuilder().setName("추억조회").setDescription("저장된 추억을 다시 봅니다")
    .addIntegerOption((o) => o.setName("번호").setDescription("조회할 추억 번호 (생략하면 가장 최근 추억)").setRequired(false).setMinValue(1)),
  new SlashCommandBuilder().setName("타겟역할설정").setDescription("관리자 러시안 룰렛의 타겟 역할을 설정합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) => o.setName("역할").setDescription("러시안 룰렛 실행 시 제거할 역할").setRequired(true)),
  new SlashCommandBuilder().setName("관리자역할추가").setDescription("관리자 러시안 룰렛의 대상 역할을 추가합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) => o.setName("역할").setDescription("관리자 러시안 룰렛 대상이 될 역할").setRequired(true)),
  new SlashCommandBuilder().setName("관리자머리끄댕이").setDescription("관리자를 대상으로 러시안 룰렛을 실행합니다"),
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent] });

async function syncCommands() {
  for (const guild of client.guilds.cache.values()) {
    const registered = await guild.commands.set(commands);
    console.log(`Registered ${registered.size} slash commands in ${guild.name}`);
  }
}

type Session = { guild_id: string; user_id: string; channel_id: string; last_tick: number };
type Memory = {
  id: number; guild_id: string; channel_id: string; creator_name: string; creator_avatar_url: string | null;
  event_name: string; started_at: number; active: number; ended_at: number | null; image_path: string | null;
};
type MemoryEntry = { display_name: string; avatar_url: string | null; content: string; image_path: string | null };
const rouletteRuns = new Map<string, Promise<unknown>>();
function sql<T>(query: string, ...params: SQLQueryBindings[]) { return db.query<T, SQLQueryBindings[]>(query).get(...params); }
function all<T>(query: string, ...params: SQLQueryBindings[]) { return db.query<T, SQLQueryBindings[]>(query).all(...params); }
function run(query: string, ...params: SQLQueryBindings[]) { return db.query(query).run(...params); }
function pad(value: number) { return String(value).padStart(2, "0"); }

function formatMemoryTime(time: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(new Date(time)).map(({ type, value }) => [type, value]));
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.dayPeriod} ${Number(parts.hour)}시 ${parts.minute}분`;
}

function bucketAt(time: number, kind: "day" | "week" | "month" | "all") {
  if (kind === "all") return "all";
  const date = new Date(time + KST);
  if (kind === "day") return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (kind === "month") return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return `${thursday.getUTCFullYear()}-W${pad(Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7))}`;
}

function ensureUser(guildId: string, userId: string) {
  run("INSERT OR IGNORE INTO users (guild_id, user_id) VALUES (?, ?)", guildId, userId);
}

function recordActivity(guildId: string, userId: string, chat: number, voiceSeconds: number, at: number) {
  for (const kind of ["day", "week", "month", "all"] as const) {
    run(`INSERT INTO activity (guild_id, user_id, bucket_type, bucket_key, chat_count, voice_seconds)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, user_id, bucket_type, bucket_key) DO UPDATE SET
      chat_count = chat_count + excluded.chat_count, voice_seconds = voice_seconds + excluded.voice_seconds`,
    guildId, userId, kind, bucketAt(at, kind), chat, voiceSeconds);
  }
  ensureUser(guildId, userId);
  run("UPDATE users SET chat_total = chat_total + ?, voice_total = voice_total + ? WHERE guild_id = ? AND user_id = ?", chat, voiceSeconds, guildId, userId);
}

function recordVoice(guildId: string, userId: string, from: number, to: number) {
  while (from < to) {
    const date = new Date(from + KST);
    const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - KST;
    const end = Math.min(to, nextMidnight);
    recordActivity(guildId, userId, 0, (end - from) / 1000, from);
    from = end;
  }
}


async function settleSession(guild: Guild, session: Session, until: number) {
  const elapsed = Math.max(0, until - session.last_tick);
  if (!elapsed) return session;
  recordVoice(session.guild_id, session.user_id, session.last_tick, until);
  run("UPDATE voice_sessions SET last_tick = ? WHERE guild_id = ? AND user_id = ?", until, session.guild_id, session.user_id);
  return { ...session, last_tick: until };
}

function isAdmin(interaction: ChatInputCommandInteraction) { return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false; }
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function voiceChannel(guild: Guild, channelId: string | null): VoiceBasedChannel | null {
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  return channel?.isVoiceBased() ? channel : null;
}

function randomRouletteAudioPath() {
  const available = rouletteAudioPaths.filter((path) => existsSync(path));
  if (!available.length) throw new Error("No roulette audio files found");
  return available[Math.floor(Math.random() * available.length)]!;
}

async function playRouletteAudio(guild: Guild, channel: VoiceBasedChannel, member: GuildMember) {
  const voiceAudioPath = randomRouletteAudioPath();
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    connection.subscribe(player);
    const ended = new Promise<void>((resolve, reject) => {
      const onStateChange = (_oldState: unknown, newState: { status: AudioPlayerStatus }) => {
        if (newState.status !== AudioPlayerStatus.Idle) return;
        player.off("stateChange", onStateChange);
        player.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        player.off("stateChange", onStateChange);
        player.off("error", onError);
        reject(error);
      };
      player.on("stateChange", onStateChange);
      player.once("error", onError);
      const resource = voiceAudioPath.toLowerCase().endsWith(".ogg")
        ? createAudioResource(createReadStream(voiceAudioPath), { inputType: StreamType.OggOpus })
        : createAudioResource(voiceAudioPath);
      player.play(resource);
    });
    await ended;
  } finally {
    // Start both Discord leave operations together so neither waits for the other.
    await Promise.all([
      Promise.resolve().then(() => connection.destroy()),
      member.voice.disconnect("관리자 러시안 룰렛 종료"),
    ]);
  }
}

async function runAdminRoulette(interaction: ChatInputCommandInteraction, guild: Guild) {
  await interaction.deferReply();
  const settings = sql<{ target_role_id: string | null }>("SELECT target_role_id FROM settings WHERE guild_id = ?", guild.id);
  const targetRole = settings?.target_role_id ? await guild.roles.fetch(settings.target_role_id).catch(() => null) : null;
  if (!targetRole) return interaction.editReply("먼저 `/타겟역할설정`으로 타겟 역할을 설정하세요.");
  if (!rouletteAudioPaths.some((path) => existsSync(path))) return interaction.editReply("음성 파일이 설정되지 않았습니다. 기본 audio 파일 또는 VOICE_AUDIO_PATH를 확인하세요.");

  const invoker = guild.members.cache.get(interaction.user.id) ?? await guild.members.fetch(interaction.user.id);
  if (!invoker.roles.cache.has(targetRole.id)) return interaction.editReply("ㅋ 역할도 없네 그지다");
  const adminTargetRoleIds = new Set(all<{ role_id: string }>("SELECT role_id FROM admin_target_roles WHERE guild_id = ?", guild.id).map(({ role_id }) => role_id));
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
  const target = lucky ? invoker : admins[Math.floor(Math.random() * admins.length)];
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
}

function memoryComponents(memoryId: number) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`memory:write:${memoryId}`).setLabel("소감 쓰기").setStyle(ButtonStyle.Primary),
  )];
}

async function handleMemoryStart(interaction: ChatInputCommandInteraction, guild: Guild) {
  await interaction.deferReply();
  if (sql<Memory>("SELECT * FROM memories WHERE guild_id = ? AND active = 1 LIMIT 1", guild.id)) {
    return interaction.editReply("이미 진행 중인 추억 만들기가 있습니다. 먼저 `/추억만들기종료`를 사용해주세요.");
  }
  const eventName = interaction.options.getString("이벤트", true).trim();
  if (!eventName) return interaction.editReply("이벤트 이름을 입력해주세요.");
  const startedAt = Date.now();
  const member = await guild.members.fetch(interaction.user.id);
  const inserted = run(`INSERT INTO memories (guild_id, channel_id, creator_name, creator_avatar_url, event_name, started_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, guild.id, interaction.channelId, member.displayName, member.displayAvatarURL({ extension: "png", size: 256 }), eventName, startedAt);
  if (!inserted.changes) return interaction.editReply("이미 진행 중인 추억 만들기가 있습니다. 먼저 `/추억만들기종료`를 사용해주세요.");
  const memoryId = Number(inserted.lastInsertRowid);
  return interaction.editReply({ content: `**${eventName}** 추억을 시작합니다.\n소감을 작성해주세요!`, allowedMentions: { parse: [] }, components: memoryComponents(memoryId) });
}

async function handleMemoryButton(interaction: ButtonInteraction) {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  const memoryId = Number(interaction.customId.slice("memory:write:".length));
  const memory = sql<Memory>("SELECT * FROM memories WHERE id = ? AND active = 1", memoryId);
  if (!memory) return interaction.reply({ ephemeral: true, content: "이미 종료된 추억 만들기입니다." });
  const modal = new ModalBuilder().setCustomId(`memory:submit:${memoryId}`).setTitle("소감 쓰기");
  const input = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("소감을 작성해주세요")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("이 순간에 대한 소감을 남겨주세요")
    .setMinLength(1)
    .setMaxLength(1_000)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  modal.addComponents(new LabelBuilder().setLabel("첨부 이미지 (선택)").setFileUploadComponent(
    new FileUploadBuilder().setCustomId("image").setMaxValues(1).setRequired(false),
  ));
  return interaction.showModal(modal);
}

function memoryDataPath(memoryId: number, userId?: string) {
  return join(dirname(databasePath), "memories", String(memoryId), userId ? `${userId}.png` : "memory.png");
}

function memoryPagePath(memoryId: number, page: number) {
  return join(dirname(databasePath), "memories", String(memoryId), `memory-${page}.png`);
}

async function saveMemoryImage(memoryId: number, userId: string, attachment: { url: string; contentType: string | null }) {
  if (!attachment.contentType?.startsWith("image/")) throw new Error("이미지 파일만 첨부할 수 있습니다.");
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);
  const path = memoryDataPath(memoryId, userId);
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

async function handleMemorySubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  await interaction.deferReply({ ephemeral: true });
  const memoryId = Number(interaction.customId.slice("memory:submit:".length));
  const memory = sql<Memory>("SELECT * FROM memories WHERE id = ? AND active = 1", memoryId);
  if (!memory) return interaction.editReply("이미 종료된 추억 만들기입니다.");
  const content = interaction.fields.getTextInputValue("content").trim();
  if (!content) return interaction.editReply("소감 내용을 입력해주세요.");
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  const attachment = interaction.fields.getUploadedFiles("image");
  const uploaded = attachment?.first();
  const imagePath = uploaded ? await saveMemoryImage(memoryId, interaction.user.id, uploaded) : null;
  run(`INSERT INTO memory_entries (memory_id, user_id, display_name, avatar_url, content, image_path)
    VALUES (?, ?, ?, ?, ?, ?)`,
  memoryId, interaction.user.id, member.displayName, member.displayAvatarURL({ extension: "png", size: 256 }), content, imagePath);
  const count = sql<{ count: number }>("SELECT COUNT(*) AS count FROM memory_entries WHERE memory_id = ?", memoryId)!.count;
  const channel = await interaction.guild!.channels.fetch(memory.channel_id).catch(() => null);
  if (channel?.isTextBased()) await channel.send({
    content: `${interaction.user}님이 소감을 작성하였습니다 (총 ${count}개)`,
    allowedMentions: { users: [interaction.user.id] },
  }).catch(() => undefined);
  return interaction.editReply("소감이 저장되었습니다.");
}

async function handleMemoryEnd(interaction: ChatInputCommandInteraction, guild: Guild) {
  await interaction.deferReply();
  const memory = sql<Memory>("SELECT * FROM memories WHERE guild_id = ? AND active = 1 ORDER BY started_at DESC LIMIT 1", guild.id);
  if (!memory) return interaction.editReply("진행 중인 추억 만들기가 없습니다.");
  if (!run("UPDATE memories SET active = 0, ended_at = ? WHERE id = ? AND active = 1", Date.now(), memory.id).changes) {
    return interaction.editReply("이미 종료된 추억 만들기입니다.");
  }
  const entries = all<MemoryEntry>("SELECT display_name, avatar_url, content, image_path FROM memory_entries WHERE memory_id = ? ORDER BY id", memory.id);
  const images = await renderMemory(memory.event_name, { name: memory.creator_name, avatarUrl: memory.creator_avatar_url ?? undefined }, formatMemoryTime(memory.started_at), entries.map((entry) => ({
    name: entry.display_name, avatarUrl: entry.avatar_url ?? undefined, content: entry.content, imagePath: entry.image_path ?? undefined,
  })));
  const imagePaths = images.map((_, index) => memoryPagePath(memory.id, index + 1));
  mkdirSync(dirname(imagePaths[0]), { recursive: true });
  await Promise.all(images.map((image, index) => writeFile(imagePaths[index], image)));
  run("UPDATE memories SET image_path = ? WHERE id = ?", imagePaths[0], memory.id);
  return interaction.editReply({ content: `추억 #${memory.id}을 저장했습니다.`, files: images.map((image, index) => ({ attachment: image, name: `memory-${index + 1}.png` })) });
}

async function handleMemoryView(interaction: ChatInputCommandInteraction, guild: Guild) {
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
    return interaction.editReply({ content: `추억 #${memory.id} · ${memory.event_name}`, files: paths.map((path, index) => ({ attachment: path, name: `memory-${index + 1}.png` })) });
  }
  const entries = all<MemoryEntry>("SELECT display_name, avatar_url, content, image_path FROM memory_entries WHERE memory_id = ? ORDER BY id", memory.id);
  const images = await renderMemory(memory.event_name, { name: memory.creator_name, avatarUrl: memory.creator_avatar_url ?? undefined }, formatMemoryTime(memory.started_at), entries.map((entry) => ({
    name: entry.display_name, avatarUrl: entry.avatar_url ?? undefined, content: entry.content, imagePath: entry.image_path ?? undefined,
  })));
  const imagePaths = images.map((_, index) => memoryPagePath(memory.id, index + 1));
  mkdirSync(dirname(imagePaths[0]), { recursive: true });
  await Promise.all(images.map((image, index) => writeFile(imagePaths[index], image)));
  run("UPDATE memories SET image_path = ? WHERE id = ?", imagePaths[0], memory.id);
  return interaction.editReply({ content: `추억 #${memory.id} · ${memory.event_name}`, files: images.map((image, index) => ({ attachment: image, name: `memory-${index + 1}.png` })) });
}

async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  const guild = interaction.guild!;
  const name = interaction.commandName;
  if (name === "추억만들기시작") return handleMemoryStart(interaction, guild);
  if (name === "추억만들기종료") return handleMemoryEnd(interaction, guild);
  if (name === "추억조회") return handleMemoryView(interaction, guild);
  if (name === "타겟역할설정") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 설정할 수 있습니다." });
    const role = interaction.options.getRole("역할", true) as Role;
    const me = guild.members.me;
    if (role.managed || !me || role.position >= me.roles.highest.position) return interaction.reply({ ephemeral: true, content: "봇 역할보다 낮고 관리되지 않은 역할만 설정할 수 있습니다." });
    run(`INSERT INTO settings (guild_id, target_role_id) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET target_role_id = excluded.target_role_id`, guild.id, role.id);
    return interaction.reply({ ephemeral: true, content: `${role}을(를) 타겟 역할로 설정했습니다.` });
  }
  if (name === "관리자역할추가") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 설정할 수 있습니다." });
    const role = interaction.options.getRole("역할", true) as Role;
    if (role.id === guild.id) return interaction.reply({ ephemeral: true, content: "@everyone 역할은 추가할 수 없습니다." });
    run("INSERT OR IGNORE INTO admin_target_roles (guild_id, role_id) VALUES (?, ?)", guild.id, role.id);
    return interaction.reply({ ephemeral: true, content: `${role}을(를) 관리자 타겟 역할로 추가했습니다.` });
  }
  if (name === "관리자머리끄댕이") {
    if (rouletteRuns.has(guild.id)) return interaction.reply({ ephemeral: true, content: "이미 진행 중인 관리자 러시안 룰렛이 있습니다." });
    const run = runAdminRoulette(interaction, guild);
    rouletteRuns.set(guild.id, run);
    try {
      await run;
    } finally {
      if (rouletteRuns.get(guild.id) === run) rouletteRuns.delete(guild.id);
    }
    return;
  }
  return interaction.reply({ ephemeral: true, content: "알 수 없는 명령어입니다." });
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  try {
    await syncCommands();
  } catch (error) {
    console.error("Slash command sync failed", error);
  }
  db.exec("DELETE FROM voice_sessions"); // Downtime is never counted.
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (state.channelId && !state.member?.user.bot) {
        run("INSERT OR IGNORE INTO voice_sessions (guild_id, user_id, channel_id, last_tick, limited) VALUES (?, ?, ?, ?, 0)", guild.id, state.id, state.channelId, Date.now());
      }
    }
  }
});

client.on("messageCreate", async (message) => {
  if (!message.inGuild() || message.author.bot) return;
  if (message.content === "!sync") {
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
    try {
      await syncCommands();
      await message.reply(`${commands.length}개 명령어를 서버에 등록했습니다.`);
    } catch (error) {
      console.error(error);
      await message.reply("명령어 동기화에 실패했습니다. 봇 권한과 콘솔 오류를 확인하세요.");
    }
    return;
  }
  recordActivity(message.guildId!, message.author.id, 1, 0, Date.now());
});
client.on("voiceStateUpdate", async (oldState, newState) => {
  if (newState.member?.user.bot) return;
  const guild = newState.guild;
  const userId = newState.id;
  const session = sql<Session>("SELECT * FROM voice_sessions WHERE guild_id = ? AND user_id = ?", guild.id, userId);
  const now = Date.now();
  if (session) await settleSession(guild, session, now);
  if (!newState.channelId) {
    run("DELETE FROM voice_sessions WHERE guild_id = ? AND user_id = ?", guild.id, userId);
    return;
  }
  run(`INSERT INTO voice_sessions (guild_id, user_id, channel_id, last_tick, limited) VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET channel_id = excluded.channel_id, last_tick = excluded.last_tick`,
  guild.id, userId, newState.channelId, now);
});
client.on("interactionCreate", (interaction) => {
  if (interaction.isChatInputCommand()) void handleInteraction(interaction).catch((error) => {
    console.error(error);
    if (interaction.deferred) void interaction.editReply("처리 중 오류가 발생했습니다.").catch(() => undefined);
    else if (!interaction.replied) void interaction.reply({ ephemeral: true, content: "처리 중 오류가 발생했습니다." }).catch(() => undefined);
  });
  if (interaction.isButton() && interaction.customId.startsWith("memory:write:")) void handleMemoryButton(interaction).catch((error) => {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) void interaction.reply({ ephemeral: true, content: "소감 입력창을 열지 못했습니다." }).catch(() => undefined);
  });
  if (interaction.isModalSubmit() && interaction.customId.startsWith("memory:submit:")) void handleMemorySubmit(interaction).catch((error) => {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) void interaction.reply({ ephemeral: true, content: "소감 저장 중 오류가 발생했습니다." }).catch(() => undefined);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const session of all<Session>("SELECT * FROM voice_sessions")) {
    const guild = client.guilds.cache.get(session.guild_id);
    if (guild) void settleSession(guild, session, now).catch(console.error);
  }
}, 60_000);

client.login(token);
