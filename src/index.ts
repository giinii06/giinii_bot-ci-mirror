import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { renderLeaderboard, renderLevelUp, renderRank, renderShop, renderShopPurchase, renderTransferReceipt } from "./leaderboard.js";
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
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  type Role,
  type StringSelectMenuInteraction,
  type VoiceBasedChannel,
} from "discord.js";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite";
const voiceAudioPath = process.env.VOICE_AUDIO_PATH ?? "./audio/roulette.ogg";
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath, { create: true });
const KST = 9 * 60 * 60 * 1000;

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp REAL NOT NULL DEFAULT 0,
    chat_total INTEGER NOT NULL DEFAULT 0, voice_total REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS activity (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, bucket_type TEXT NOT NULL, bucket_key TEXT NOT NULL,
    chat_count INTEGER NOT NULL DEFAULT 0, voice_seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, bucket_type, bucket_key)
  );
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY, levelup_channel_id TEXT, shoplog_channel_id TEXT, target_role_id TEXT
  );
  CREATE TABLE IF NOT EXISTS shop (
    guild_id TEXT NOT NULL, role_id TEXT NOT NULL, price REAL NOT NULL, boost REAL NOT NULL DEFAULT 0,
    default_key TEXT, PRIMARY KEY (guild_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS user_bonuses (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, bonus_key TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, bonus_key)
  );
  CREATE TABLE IF NOT EXISTS voice_sessions (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    last_tick INTEGER NOT NULL, limited INTEGER NOT NULL, xp_ms REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS roulette_cooldowns (
    guild_id TEXT NOT NULL, user_id TEXT NOT NULL, last_used_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS admin_target_roles (
    guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );
`);
if (!all<{ name: string }>("PRAGMA table_info(settings)").some((column) => column.name === "target_role_id")) {
  db.exec("ALTER TABLE settings ADD COLUMN target_role_id TEXT");
}
run("DELETE FROM shop WHERE default_key IS NOT NULL");
run("UPDATE shop SET boost = 0");
run("DELETE FROM user_bonuses");

const commands = [
  new SlashCommandBuilder().setName("리더보드").setDescription("누적 XP 상위 20명을 봅니다"),
  new SlashCommandBuilder().setName("랭크").setDescription("내 XP와 서버 랭크를 봅니다")
    .addUserOption((o) => o.setName("유저").setDescription("랭크를 확인할 유저").setRequired(false)),
  new SlashCommandBuilder().setName("경험치샵").setDescription("역할을 XP로 구매합니다"),
  new SlashCommandBuilder().setName("경험치샵물품추가").setDescription("경험치샵에 판매 역할을 추가합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) => o.setName("역할").setDescription("추가할 판매 역할").setRequired(true))
    .addNumberOption((o) => o.setName("가격").setDescription("역할의 XP 가격").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("경험치샵목록삭제").setDescription("경험치샵 판매 물품을 삭제합니다")
    .addRoleOption((o) => o.setName("물품").setDescription("삭제할 경험치샵 판매 역할").setRequired(true)),
  new SlashCommandBuilder().setName("타겟역할설정").setDescription("관리자 러시안 룰렛의 타겟 역할을 설정합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) => o.setName("역할").setDescription("러시안 룰렛 실행 시 제거할 역할").setRequired(true)),
  new SlashCommandBuilder().setName("관리자역할추가").setDescription("관리자 러시안 룰렛의 대상 역할을 추가합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((o) => o.setName("역할").setDescription("관리자 러시안 룰렛 대상이 될 역할").setRequired(true)),
  new SlashCommandBuilder().setName("관리자_러시안룰렛").setDescription("관리자를 대상으로 러시안 룰렛을 실행합니다"),
  new SlashCommandBuilder().setName("송금").setDescription("XP를 다른 유저에게 보냅니다")
    .addNumberOption((o) => o.setName("얼마").setDescription("보낼 XP").setRequired(true).setMinValue(0.01))
    .addUserOption((o) => o.setName("유저").setDescription("받을 유저").setRequired(true)),
  new SlashCommandBuilder().setName("xp추가").setDescription("관리자가 XP를 추가합니다")
    .addNumberOption((o) => o.setName("얼마").setDescription("추가할 XP").setRequired(true).setMinValue(0.01))
    .addUserOption((o) => o.setName("유저").setDescription("대상 유저").setRequired(true)),
  new SlashCommandBuilder().setName("xp제거").setDescription("관리자가 XP를 제거합니다")
    .addNumberOption((o) => o.setName("얼마").setDescription("제거할 XP").setRequired(true).setMinValue(0.01))
    .addUserOption((o) => o.setName("유저").setDescription("대상 유저").setRequired(true)),
  new SlashCommandBuilder().setName("채널설치").setDescription("로그 채널을 지정합니다")
    .addStringOption((o) => o.setName("종류").setDescription("설정할 로그").setRequired(true).addChoices(
      { name: "레벨업", value: "levelup_channel_id" }, { name: "경험치샵로그", value: "shoplog_channel_id" },
    ))
    .addChannelOption((o) => o.setName("채널").setDescription("로그를 보낼 텍스트 채널").setRequired(true).addChannelTypes(ChannelType.GuildText)),
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent] });

async function syncCommands() {
  const application = client.application;
  if (!application) throw new Error("Discord application is not ready");
  await application.commands.set([]);
  for (const guild of client.guilds.cache.values()) await guild.commands.set([]);
  await application.commands.set(commands);
}

type Session = { guild_id: string; user_id: string; channel_id: string; last_tick: number };
type UserRow = { xp: number };
type ShopItem = { id: string; role_id?: string; price: number; name: string; purchased: boolean };
const leaderboardPages = new Map<string, Buffer[]>();
const rouletteRuns = new Map<string, Promise<unknown>>();
const SHOP_PAGE_SIZE = 7;
const ROULETTE_COOLDOWN_MS = 6 * 60 * 60 * 1_000;

function sql<T>(query: string, ...params: SQLQueryBindings[]) { return db.query<T, SQLQueryBindings[]>(query).get(...params); }
function all<T>(query: string, ...params: SQLQueryBindings[]) { return db.query<T, SQLQueryBindings[]>(query).all(...params); }
function run(query: string, ...params: SQLQueryBindings[]) { return db.query(query).run(...params); }
function roundXp(value: number) { return Math.round(value * 100) / 100; }
function pad(value: number) { return String(value).padStart(2, "0"); }

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

function levelAt(xp: number) {
  let level = 1;
  while (xp >= ((10 * (level + 1)) ** 2 - 5) / 2 + 1) level++;
  return level;
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

async function sendToSetting(guild: Guild, setting: "levelup_channel_id" | "shoplog_channel_id", message: string | MessageCreateOptions) {
  const settings = sql<{ levelup_channel_id: string | null; shoplog_channel_id: string | null }>("SELECT * FROM settings WHERE guild_id = ?", guild.id);
  const channelId = settings?.[setting];
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(message).catch(() => undefined);
}

async function sendLevelUp(guild: Guild, userId: string, level: number) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user ?? await client.users.fetch(userId).catch(() => null);
  const name = member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저";
  const avatarUrl = member?.displayAvatarURL({ extension: "png", size: 128 }) ?? user?.displayAvatarURL({ extension: "png", size: 128 });
  await sendToSetting(guild, "levelup_channel_id", { files: [{ attachment: await renderLevelUp(guild.name, { name, avatarUrl }, level), name: "level-up.png" }] });
}

async function sendShopPurchaseLog(guild: Guild, member: GuildMember, itemName: string, price: number) {
  await sendToSetting(guild, "shoplog_channel_id", {
    files: [{ attachment: await renderShopPurchase(guild.name, { name: member.displayName, avatarUrl: member.displayAvatarURL({ extension: "png", size: 128 }) }, itemName, price), name: "xp-shop-purchase.png" }],
  });
}

async function addXp(guild: Guild, userId: string, amount: number, announce = true) {
  ensureUser(guild.id, userId);
  const oldXp = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, userId)!.xp;
  const newXp = roundXp(Math.max(0, oldXp + amount));
  run("UPDATE users SET xp = ? WHERE guild_id = ? AND user_id = ?", newXp, guild.id, userId);
  const oldLevel = levelAt(oldXp);
  const newLevel = levelAt(newXp);
  if (announce && newLevel > oldLevel) await sendLevelUp(guild, userId, newLevel);
  return newXp;
}

async function settleSession(guild: Guild, session: Session, until: number) {
  const elapsed = Math.max(0, until - session.last_tick);
  if (!elapsed) return session;
  recordVoice(session.guild_id, session.user_id, session.last_tick, until);
  run("UPDATE voice_sessions SET last_tick = ? WHERE guild_id = ? AND user_id = ?", until, session.guild_id, session.user_id);
  return { ...session, last_tick: until };
}

function isAdmin(interaction: ChatInputCommandInteraction) { return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false; }
function removeShopRole(guild: Guild, role: Role) {
  return run("DELETE FROM shop WHERE guild_id = ? AND role_id = ?", guild.id, role.id).changes > 0;
}

function shopItems(guild: Guild, member: GuildMember): ShopItem[] {
  const roles: ShopItem[] = all<{ role_id: string; price: number }>("SELECT role_id, price FROM shop WHERE guild_id = ?", guild.id)
    .flatMap((item) => {
      const role = guild.roles.cache.get(item.role_id);
      return role ? [{ ...item, id: `role:${item.role_id}`, name: role.name, purchased: member.roles.cache.has(item.role_id) }] : [];
    });
  return roles.sort((a, b) => b.price - a.price);
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function rouletteCooldownRemaining(guildId: string, userId: string, now = Date.now()) {
  const row = sql<{ last_used_at: number }>("SELECT last_used_at FROM roulette_cooldowns WHERE guild_id = ? AND user_id = ?", guildId, userId);
  return row ? Math.max(0, row.last_used_at + ROULETTE_COOLDOWN_MS - now) : 0;
}

function claimRouletteCooldown(guildId: string, userId: string, now = Date.now()) {
  const claimed = run(`INSERT INTO roulette_cooldowns (guild_id, user_id, last_used_at) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET last_used_at = excluded.last_used_at
    WHERE roulette_cooldowns.last_used_at <= excluded.last_used_at - ?`,
  guildId, userId, now, ROULETTE_COOLDOWN_MS).changes > 0;
  return claimed ? 0 : rouletteCooldownRemaining(guildId, userId, now);
}

function formatRouletteCooldown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours && `${hours}시간`, minutes && `${minutes}분`, remainingSeconds && `${remainingSeconds}초`].filter(Boolean).join(" ") || "1초";
}

function voiceChannel(guild: Guild, channelId: string | null): VoiceBasedChannel | null {
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  return channel?.isVoiceBased() ? channel : null;
}

async function playRouletteAudio(guild: Guild, channel: VoiceBasedChannel, member: GuildMember) {
  if (!voiceAudioPath || !existsSync(voiceAudioPath)) throw new Error("VOICE_AUDIO_PATH is missing or points to a missing file");
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
  const initialCooldown = rouletteCooldownRemaining(guild.id, interaction.user.id);
  if (initialCooldown) return interaction.reply(`${formatRouletteCooldown(initialCooldown)} 후에 다시 쓸 수 있어요. 아무래도 xp가 다는 아닌거죠 으!!@!@`);
  await interaction.deferReply();
  const settings = sql<{ target_role_id: string | null }>("SELECT target_role_id FROM settings WHERE guild_id = ?", guild.id);
  const targetRole = settings?.target_role_id ? await guild.roles.fetch(settings.target_role_id).catch(() => null) : null;
  if (!targetRole) return interaction.editReply("먼저 `/타겟역할설정`으로 타겟 역할을 설정하세요.");
  if (!voiceAudioPath || !existsSync(voiceAudioPath)) return interaction.editReply("음성 파일이 설정되지 않았습니다. VOICE_AUDIO_PATH를 확인하세요.");

  const invoker = guild.members.cache.get(interaction.user.id) ?? await guild.members.fetch(interaction.user.id);
  if (!invoker.roles.cache.has(targetRole.id)) return interaction.editReply("타겟 역할이 있는 실행자만 사용할 수 있습니다.");
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

  const cooldown = claimRouletteCooldown(guild.id, interaction.user.id);
  if (cooldown) return interaction.editReply(`${formatRouletteCooldown(cooldown)} 후에 다시 쓸 수 있어요. 아무래도 xp가 다는 아닌거죠 으!!@!@`);

  const updatedInvoker = await invoker.roles.remove(targetRole, "관리자 러시안 룰렛 시작").catch((error) => {
    console.error("Target role removal failed", error);
    return null;
  });
  if (!updatedInvoker || updatedInvoker.roles.cache.has(targetRole.id)) return interaction.editReply("타겟 역할 제거에 실패했습니다.");

  await interaction.editReply("3");
  await sleep(1_000);
  await interaction.followUp("2");
  await sleep(1_000);
  await interaction.followUp("1");
  await sleep(1_000);

  if (lucky) {
    await interaction.followUp(`${interaction.user}님... 으!!@!@ 어딜 관리자한테 덤비죠?`);
  } else {
    await interaction.followUp(`${target}님이 당첨되었습니다! 으!!@!@`);
  }
  try {
    await playRouletteAudio(guild, targetChannel, target);
  } catch (error) {
    console.error("Admin roulette voice playback failed", error);
    await interaction.followUp("음성 재생에 실패했지만 룰렛은 종료되었습니다.");
  }
}

function shopPage(items: ShopItem[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / SHOP_PAGE_SIZE));
  const page = Math.max(0, Math.min(Number.isInteger(requestedPage) ? requestedPage : 0, pageCount - 1));
  return { page, pageCount, items: items.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE) };
}

function shopComponents(items: ShopItem[], page: number, pageCount: number, selectedItemId?: string) {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder().setCustomId(`shop:select:${page}`).setPlaceholder("구매할 보상을 선택하세요").addOptions(
        items.map((item) => ({ label: item.name.slice(0, 100), value: item.id, description: `${item.price} XP`, default: item.id === selectedItemId })),
      ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`shop:page:${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`shop:page:${page}`).setLabel(`${page + 1} / ${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(),
      new ButtonBuilder().setCustomId(`shop:page:${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page === pageCount - 1),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(selectedItemId ? `shop:buy:${page}:${selectedItemId}` : "shop:buy").setLabel("구매").setStyle(ButtonStyle.Primary).setDisabled(!selectedItemId),
    ),
  ];
}

function leaderboardComponents(page: number, pageCount: number) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`leaderboard:${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`leaderboard:${page}`).setLabel(`${page + 1} / ${pageCount}`).setStyle(ButtonStyle.Secondary).setDisabled(),
    new ButtonBuilder().setCustomId(`leaderboard:${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page === pageCount - 1),
  )];
}

async function purchaseShopRole(interaction: ChatInputCommandInteraction | ButtonInteraction, guild: Guild, role: Role) {
  const item = sql<{ price: number }>("SELECT price FROM shop WHERE guild_id = ? AND role_id = ?", guild.id, role.id);
  if (!item) return interaction.reply({ ephemeral: true, content: "상점에 없는 역할입니다." });
  const member = await guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(role.id)) return interaction.reply({ ephemeral: true, content: "이미 구매되었습니다." });
  const balance = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, interaction.user.id)?.xp ?? 0;
  if (balance < item.price) return interaction.reply({ ephemeral: true, content: `XP가 부족합니다. 필요: ${item.price}, 보유: ${balance}` });
  const updatedMember = await member.roles.add(role, "XP shop purchase").catch((error) => {
    console.error("XP shop role grant failed", error);
    return null;
  });
  if (!updatedMember) return interaction.reply({ ephemeral: true, content: "역할 지급에 실패했습니다. 봇 역할 위치와 권한을 확인하세요." });
  await addXp(guild, interaction.user.id, -item.price, false);
  await sendShopPurchaseLog(guild, member, role.name, item.price);
  return interaction.reply({ ephemeral: true, content: `${role} 구매 완료! 남은 XP: ${roundXp(balance - item.price)}` });
}

async function handleShop(interaction: ChatInputCommandInteraction, guild: Guild) {
  const items = shopItems(guild, await guild.members.fetch(interaction.user.id));
  if (!items.length) return interaction.reply({ ephemeral: true, content: "판매 중인 역할이 없습니다." });
  const balance = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, interaction.user.id)?.xp ?? 0;
  const view = shopPage(items, 0);
  return interaction.reply({ ephemeral: true, files: [{ attachment: renderShop(guild.name, view.items, balance), name: "xp-shop.png" }], components: shopComponents(view.items, view.page, view.pageCount) });
}

async function handleShopComponent(interaction: StringSelectMenuInteraction | ButtonInteraction) {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  const guild = interaction.guild!;
  const items = shopItems(guild, await guild.members.fetch(interaction.user.id));
  if (interaction.isButton() && interaction.customId.startsWith("shop:page:")) {
    const view = shopPage(items, Number(interaction.customId.slice("shop:page:".length)));
    const balance = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, interaction.user.id)?.xp ?? 0;
    return interaction.update({ attachments: [], files: [{ attachment: renderShop(guild.name, view.items, balance, view.page * SHOP_PAGE_SIZE + 1), name: "xp-shop.png" }], components: shopComponents(view.items, view.page, view.pageCount) });
  }
  if (interaction.isStringSelectMenu()) {
    const itemId = interaction.values[0];
    const view = shopPage(items, Number(interaction.customId.slice("shop:select:".length)));
    if (!view.items.some((item) => item.id === itemId)) return interaction.reply({ ephemeral: true, content: "상점에 없는 보상입니다." });
    return interaction.update({ components: shopComponents(view.items, view.page, view.pageCount, itemId) });
  }
  const [, ...itemParts] = interaction.customId.slice("shop:buy:".length).split(":");
  const item = items.find((entry) => entry.id === itemParts.join(":"));
  const role = item?.role_id && guild.roles.cache.get(item.role_id);
  if (!role) return interaction.reply({ ephemeral: true, content: "역할을 찾을 수 없습니다." });
  return purchaseShopRole(interaction, guild, role);
}

async function handleLeaderboardComponent(interaction: ButtonInteraction) {
  const page = Number(interaction.customId.slice("leaderboard:".length));
  const pages = leaderboardPages.get(interaction.message.id);
  if (!Number.isInteger(page) || !pages?.[page]) return interaction.reply({ ephemeral: true, content: "리더보드가 만료되었습니다. `/리더보드`를 다시 실행하세요." });
  return interaction.update({ attachments: [], files: [{ attachment: pages[page], name: "leaderboard.png" }], components: leaderboardComponents(page, pages.length) });
}

async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) return interaction.reply({ ephemeral: true, content: "서버에서만 사용할 수 있습니다." });
  const guild = interaction.guild!;
  const name = interaction.commandName;
  if (name === "경험치샵") return handleShop(interaction, guild);
  if (name === "경험치샵물품추가") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 상점을 관리할 수 있습니다." });
    const role = interaction.options.getRole("역할", true) as Role;
    const price = interaction.options.getNumber("가격", true);
    const me = guild.members.me;
    if (role.managed || !me || role.position >= me.roles.highest.position) return interaction.reply({ ephemeral: true, content: "봇 역할보다 낮고 관리되지 않은 역할만 판매할 수 있습니다." });
    run("INSERT OR REPLACE INTO shop (guild_id, role_id, price, boost, default_key) VALUES (?, ?, ?, 0, NULL)", guild.id, role.id, price);
    return interaction.reply({ ephemeral: true, content: `${role}을(를) ${price} XP에 등록했습니다.` });
  }
  if (name === "경험치샵목록삭제") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 상점을 관리할 수 있습니다." });
    const role = interaction.options.getRole("물품", true) as Role;
    return interaction.reply({ ephemeral: true, content: removeShopRole(guild, role) ? `${role}을(를) 상점에서 삭제했습니다.` : "상점에 없는 역할입니다." });
  }
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
  if (name === "관리자_러시안룰렛") {
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
  if (name === "채널설치") {
    if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 설정할 수 있습니다." });
    const key = interaction.options.getString("종류", true) as "levelup_channel_id" | "shoplog_channel_id";
    const channel = interaction.options.getChannel("채널", true);
    run(`INSERT INTO settings (guild_id, ${key}) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET ${key} = excluded.${key}`, guild.id, channel.id);
    return interaction.reply({ ephemeral: true, content: `${channel}을(를) 로그 채널로 설정했습니다.` });
  }
  if (name === "리더보드") {
    const rows = all<{ user_id: string; xp: number }>("SELECT user_id, xp FROM users WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id LIMIT 20", guild.id);
    if (!rows.length) return interaction.reply("아직 XP 기록이 없습니다.");
    await interaction.deferReply();
    const entries = await Promise.all(rows.map(async (row) => {
      const member = await guild.members.fetch(row.user_id).catch(() => null);
      const user = member?.user ?? await client.users.fetch(row.user_id).catch(() => null);
      return { name: member?.displayName ?? user?.globalName ?? user?.username ?? "알 수 없는 유저", xp: row.xp, avatarUrl: member?.displayAvatarURL({ extension: "png", size: 128 }) ?? user?.displayAvatarURL({ extension: "png", size: 128 }) };
    }));
    const pages = await Promise.all(Array.from({ length: Math.ceil(entries.length / 6) }, (_, page) => renderLeaderboard(guild.name, entries.slice(page * 6, page * 6 + 6), page * 6 + 1)));
    const message = await interaction.editReply({ files: [{ attachment: pages[0], name: "leaderboard.png" }], components: leaderboardComponents(0, pages.length) });
    leaderboardPages.set(message.id, pages);
    setTimeout(() => leaderboardPages.delete(message.id), 15 * 60_000);
    return;
  }
  if (name === "랭크") {
    const target = interaction.options.getUser("유저") ?? interaction.user;
    const row = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, target.id);
    const xp = row?.xp ?? 0;
    const rank = sql<{ rank: number }>(
      "SELECT COUNT(*) + 1 AS rank FROM users WHERE guild_id = ? AND (xp > ? OR (xp = ? AND xp > 0 AND user_id < ?))",
      guild.id, xp, xp, target.id,
    )!.rank;
    await interaction.deferReply();
    const member = await guild.members.fetch(target.id).catch(() => null);
    return interaction.editReply({ files: [{ attachment: await renderRank({
      name: member?.displayName ?? target.globalName ?? target.username,
      avatarUrl: member?.displayAvatarURL({ extension: "png", size: 256 }) ?? target.displayAvatarURL({ extension: "png", size: 256 }),
      xp,
      level: levelAt(xp),
      rank,
    }), name: "rank.png" }] });
  }
  const target = interaction.options.getUser("유저", true);
  const amount = interaction.options.getNumber("얼마", true);
  if (target.bot) return interaction.reply({ ephemeral: true, content: "봇에게는 XP를 보낼 수 없습니다." });
  if (name === "송금") {
    if (target.id === interaction.user.id) return interaction.reply({ ephemeral: true, content: "자기 자신에게 송금할 수 없습니다." });
    await interaction.deferReply();
    const transfer = db.transaction(() => {
      ensureUser(guild.id, interaction.user.id); ensureUser(guild.id, target.id);
      const sender = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, interaction.user.id)!.xp;
      if (sender < amount) return null;
      const receiver = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, target.id)!.xp;
      const senderXp = roundXp(sender - amount);
      const receiverXp = roundXp(receiver + amount);
      run("UPDATE users SET xp = ? WHERE guild_id = ? AND user_id = ?", senderXp, guild.id, interaction.user.id);
      run("UPDATE users SET xp = ? WHERE guild_id = ? AND user_id = ?", receiverXp, guild.id, target.id);
      return { senderXp, receiverXp, previousReceiverXp: receiver };
    })();
    if (transfer === null) return interaction.editReply("XP가 부족합니다.");
    if (levelAt(transfer.receiverXp) > levelAt(transfer.previousReceiverXp)) await sendLevelUp(guild, target.id, levelAt(transfer.receiverXp));
    const [senderMember, receiverMember] = await Promise.all([
      guild.members.fetch(interaction.user.id).catch(() => null),
      guild.members.fetch(target.id).catch(() => null),
    ]);
    return interaction.editReply({ files: [{ attachment: await renderTransferReceipt(guild.name, {
      name: senderMember?.displayName ?? interaction.user.globalName ?? interaction.user.username,
      avatarUrl: senderMember?.displayAvatarURL({ extension: "png", size: 128 }) ?? interaction.user.displayAvatarURL({ extension: "png", size: 128 }),
      xp: transfer.senderXp,
    }, {
      name: receiverMember?.displayName ?? target.globalName ?? target.username,
      avatarUrl: receiverMember?.displayAvatarURL({ extension: "png", size: 128 }) ?? target.displayAvatarURL({ extension: "png", size: 128 }),
      xp: transfer.receiverXp,
    }, amount), name: "xp-transfer.png" }] });
  }
  if (!isAdmin(interaction)) return interaction.reply({ ephemeral: true, content: "관리자만 XP를 조정할 수 있습니다." });
  if (name === "xp제거") {
    const current = sql<UserRow>("SELECT xp FROM users WHERE guild_id = ? AND user_id = ?", guild.id, target.id)?.xp ?? 0;
    await addXp(guild, target.id, -Math.min(amount, current), false);
    return interaction.reply({ ephemeral: true, content: `${target}의 XP를 ${Math.min(amount, current)} 제거했습니다.` });
  }
  await addXp(guild, target.id, amount);
  return interaction.reply({ ephemeral: true, content: `${target}에게 ${amount} XP를 추가했습니다.` });
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await syncCommands();
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
      await message.reply(`명령어를 모두 삭제하고 ${commands.length}개를 다시 등록했습니다.`);
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
    if (interaction.deferred) void interaction.editReply("처리 중 오류가 발생했습니다.");
    else if (!interaction.replied) void interaction.reply({ ephemeral: true, content: "처리 중 오류가 발생했습니다." });
  });
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("shop:select:") || interaction.isButton() && (interaction.customId.startsWith("shop:buy:") || interaction.customId.startsWith("shop:page:"))) void handleShopComponent(interaction).catch((error) => {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) void interaction.reply({ ephemeral: true, content: "처리 중 오류가 발생했습니다." });
  });
  if (interaction.isButton() && interaction.customId.startsWith("leaderboard:")) void handleLeaderboardComponent(interaction).catch((error) => {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) void interaction.reply({ ephemeral: true, content: "처리 중 오류가 발생했습니다." });
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
