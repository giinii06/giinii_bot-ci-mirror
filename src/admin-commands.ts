import { EmbedBuilder, type Client, type Message } from "discord.js";
import { slashCommandNames } from "./commands.js";
import { disabledCommandNames, isCommandEnabled, setCommandEnabled } from "./command-rules.js";
import { all } from "./storage.js";
import { splitForEmbeds } from "./text.js";

/** 관리 명령을 실행할 수 있는 유일한 유저. */
export const ADMIN_USER_ID = "1425196889288212691";

const enabledMark = "✅";
const disabledMark = "⛔";

/** 이 모듈이 처리하는 접두사. 앞이 이 중 하나면 관리 명령어로 판정한다. */
const COMMAND_PREFIXES = ["!서버목록", "!서버별명령어", "!도움"] as const;

const noticeEmbed = (title: string, description: string) => new EmbedBuilder()
  .setColor(0x5865f2)
  .setTitle(title)
  .setDescription(description);

const denyEmbed = (message: string) => new EmbedBuilder()
  .setColor(0xed4245)
  .setTitle("권한이 없어요")
  .setDescription(message);

/**
 * 관리 명령어인가 판정한다. 호출자는 이 경우 MessageCreate 를 더 처리하지 않는다.
 */
export const isAdminCommand = (content: string) => COMMAND_PREFIXES.some((prefix) => content === prefix || content.startsWith(`${prefix} `));

const isAdmin = (message: Message) => message.author.id === ADMIN_USER_ID;

const storedMessageCount = (guildId: string) =>
  all<{ n: number }>(guildId, "SELECT COUNT(*) AS n FROM discord_messages WHERE guild_id = ?", guildId)[0]?.n ?? 0;

const storedVoiceSeconds = (guildId: string) =>
  all<{ seconds: number }>(
    guildId, "SELECT COALESCE(SUM(ended_at - started_at), 0) / 1000 AS seconds FROM voice_presence_sessions WHERE ended_at IS NOT NULL", guildId
  )[0]?.seconds ?? 0;

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
};

/** 봇이 올라와 있는 모든 서버를 이름·ID와 함께 보여준다. */
const handleServerList = async (message: Message, client: Client) => {
  const guilds = [...client.guilds.cache.values()]
    .sort((left, right) => left.name.localeCompare(right.name));
  if (guilds.length === 0) {
    await message.reply({ embeds: [noticeEmbed("서버 목록", "봇이 올라간 서버가 없습니다.")] });
    return;
  }
  const lines = guilds.map((guild) => {
    const disabled = disabledCommandNames(guild.id);
    const marker = disabled.length ? `${disabled.length}개 비활성` : "전부 허용";
    return `**${guild.name}** \`${guild.id}\`\n└ 메시지 ${storedMessageCount(guild.id).toLocaleString()}개 · 통화 ${formatDuration(storedVoiceSeconds(guild.id))} · ${marker}`;
  });
  await sendLong(message, `서버 목록 (${guilds.length}개)`, lines.join("\n"));
};

/** 서버 이름 또는 ID로 대상 서버을 찾는다. 애매하면(null) 찾은 것으로 치지 않는다. */
const resolveGuild = (client: Client, query: string) => {
  const guilds = [...client.guilds.cache.values()];
  const exactName = guilds.find((guild) => guild.name === query);
  if (exactName) return exactName;
  const byId = guilds.find((guild) => guild.id === query);
  if (byId) return byId;
  const partial = guilds.filter((guild) => guild.name.toLowerCase().includes(query.toLowerCase()));
  return partial.length === 1 ? partial[0] : null;
};

const ruleLines = (guildId: string) => slashCommandNames
  .map((name) => `${isCommandEnabled(guildId, name) ? enabledMark : disabledMark} \`${name}\``)
  .join("\n");

/**
 * 뒤쪽 두 토큰이 `enable|disable` + 명령어일 때만 설정 요청으로 본다.
 * 서버 이름에 공백이 있어도 앞쪽 토큰이 통째로 서버명으로 남는다.
 */
const parseRuleArgs = (args: string[]) => {
  if (args.length >= 3) {
    const action = args[args.length - 2]!;
    const commandName = args[args.length - 1]!;
    const target = args.slice(0, args.length - 2).join(" ");
    if (action === "enable" || action === "disable") {
      return { target, action, commandName };
    }
  }
  if (args.length === 2 && (args[1] === "enable" || args[1] === "disable")) {
    return { target: args[0]!, action: args[1]!, commandName: null };
  }
  return { target: args.join(" "), action: null, commandName: null };
};

const handleServerCommandRule = async (message: Message, client: Client, args: string[]) => {
  if (args.length === 0) {
    const guilds = [...client.guilds.cache.values()].sort((left, right) => left.name.localeCompare(right.name));
    if (guilds.length === 0) {
      await message.reply({ embeds: [noticeEmbed("서버별 명령어", "봇이 올라간 서버가 없습니다.")] });
      return;
    }
    const header = `${enabledMark} 허용 / ${disabledMark} 비활성 — 비활성만 표시합니다.`;
    const blocks = guilds.map((guild) => {
      const disabled = disabledCommandNames(guild.id);
      const body = disabled.length
        ? disabled.map((command) => `${disabledMark} \`${command}\``).join("\n")
        : `${enabledMark} 슬래시 명령어 ${slashCommandNames.length}개 전부 허용`;
      return `**${guild.name}** \`${guild.id}\`\n${body}`;
    });
    await sendLong(message, "서버별 슬래시 명령어", `${header}\n\n${blocks.join("\n\n")}`);
    return;
  }

  const { target, action, commandName } = parseRuleArgs(args);

  if (!action || !commandName) {
    const guild = resolveGuild(client, target);
    if (!guild) {
      await message.reply({ embeds: [noticeEmbed("서버를 못 찾았어요", `\`${target}\` 이름 또는 ID에 해당하는 서버가 없습니다. \`!서버목록\`으로 확인하세요.`)] });
      return;
    }
    await sendLong(message, `${guild.name}의 슬래시 명령어`, ruleLines(guild.id));
    return;
  }

  const guild = resolveGuild(client, target);
  if (!guild) {
    await message.reply({ embeds: [noticeEmbed("서버를 못 찾았어요", `\`${target}\` 이름 또는 ID에 해당하는 서버가 없습니다. \`!서버목록\`으로 확인하세요.`)] });
    return;
  }

  if (!slashCommandNames.includes(commandName)) {
    await message.reply({ embeds: [noticeEmbed("그런 슬래시 명령어가 없어요", `\`${commandName}\` 은(는) 등록된 슬래시 명령어가 아닙니다.`)] });
    return;
  }

  const enabled = action === "enable";
  setCommandEnabled(guild.id, commandName, enabled, message.author.id);
  await message.reply({ embeds: [noticeEmbed(
    enabled ? "명령어를 다시 켰어요" : "명령어를 껐어요",
    `**${guild.name}** \`${guild.id}\` 에서 \`/${commandName}\` ${enabled ? "사용할 수 있습니다." : "사용할 수 없습니다."}`
  )] });
};

const helpLines = [
  "**!서버목록**",
  "봇이 올라간 모든 서버의 이름, ID, 저장된 기록 수를 보여줍니다.",
  "",
  "**!서버별명령어**",
  "서버마다 어떤 슬래시 명령어가 허용됐는지 보여줍니다. 기본값은 전부 허용입니다.",
  "",
  "**!서버별명령어 [서버이름]**",
  "특정 서버의 슬래시 명령어 허용 상태만 봅니다.",
  "",
  "**!서버별명령어 [서버이름] disable|enable [명령어이름]**",
  "그 서버에서 슬래시 명령어를 끄거나 켭니다. 서버 이름에 공백이 있어도 됩니다.",
  "꺼 둔 명령어를 누르면 누른 본인에게만 안내가 뜹니다.",
  "예) `!서버별명령어 내 서버 disable 통화량`",
  "",
  "**!도움**",
  "지금 보는 이 안내입니다.",
  "",
  "**!들낙감지설치**",
  "지금 채널을 들낙 감지 로그 채널로 지정합니다. 서버 관리자도 쓸 수 있습니다.",
  "",
  "**!들낙시간지정 [초]**",
  "들낙으로 볼 기준 시간을 정합니다. 기본 60초, 1초부터 86400초까지입니다.",
  "서버 관리자도 쓸 수 있습니다."
];

const handleHelp = async (message: Message) => {
  await sendLong(message, "사용법", helpLines.join("\n"));
};

/** 임베디 설명이 2000자를 넘으면 쪼개 순서대로 보낸다. 제목이 있으면 페이지 번호를 붙인다. */
const sendLong = async (message: Message, title: string, description: string, color = 0x5865f2) => {
  const pages = splitForEmbeds(description);
  for (let index = 0; index < pages.length; index += 1) {
    const page = new EmbedBuilder()
      .setColor(color)
      .setTitle(pages.length > 1 ? `${title} (${index + 1}/${pages.length})` : title)
      .setDescription(pages[index] ?? "");
    await message.reply({ embeds: [page] });
  }
};

/** 관리 명령어면 처리하고 true 를 돌려준다. MessageCreate 는 이 값이 true 면 이후 처리를 건너뛴다. */
export const handleAdminCommand = async (message: Message, client: Client): Promise<boolean> => {
  if (message.author.bot) return false;
  const content = message.content.trim();
  if (!isAdminCommand(content)) return false;
  if (!isAdmin(message)) {
    await message.reply({ embeds: [denyEmbed("이 명령어는 봇 관리자만 쓸 수 있어요.")] });
    return true;
  }

  const separator = content.indexOf(" ");
  if (separator === -1) {
    if (content === "!서버목록") await handleServerList(message, client);
    else if (content === "!서버별명령어") await handleServerCommandRule(message, client, []);
    else if (content === "!도움") await handleHelp(message);
    return true;
  }

  const head = content.slice(0, separator);
  const args = content.slice(separator + 1).split(/\s+/).filter(Boolean);
  if (head === "!서버별명령어") await handleServerCommandRule(message, client, args);
  return true;
};
