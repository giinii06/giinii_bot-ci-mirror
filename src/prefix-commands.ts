import { PermissionFlagsBits, type Message } from "discord.js";
import { ADMIN_USER_ID } from "./admin-commands.js";
import { isAllowedGuild } from "./command-rules.js";
import { chatMind, chatRouter } from "./chat/index.js";
import { handleModelCommand, handleReasoningCommand } from "./chat/commands.js";
import { handleMemoryCommand, handleMindCommand, handleSharedMemoryCommand } from "./mind/commands.js";
import { handleRouletteSettingsCommand } from "./roulette-settings.js";

export const prefixCommandNames = [
  "model", "reasoning", "mind", "memory", "shared-memory", "타겟", "관리자_타겟", "help"
] as const;

type PrefixCommandName = (typeof prefixCommandNames)[number];
const prefixNames: ReadonlySet<string> = new Set(prefixCommandNames);
const administratorCommands: ReadonlySet<string> = new Set(["mind", "shared-memory", "타겟", "관리자_타겟"]);

export const parsePrefixCommand = (content: string): { name: PrefixCommandName; args: string } | null => {
  const matched = /^!([^\s]+)(?:\s+([\s\S]*))?$/.exec(content.trim());
  if (!matched || !prefixNames.has(matched[1]!)) return null;
  return { name: matched[1] as PrefixCommandName, args: (matched[2] ?? "").trim() };
};

const help = [
  "**슬래시 명령어 (전체 서버)**",
  "`/친밀도 @유저` · `/친밀도그래프` · `/통화량` · `/통계`",
  "**슬래시 명령어 (전용 서버)**",
  "`/친밀도그래프3d` · `/관리자머리끄댕이`",
  "",
  "**! 명령어 — 일반 사용자 (전용 서버)**",
  "`!model [모델 ID]` · `!reasoning [none|low|medium|high...]`",
  "`!memory list|delete <ID>|clear confirm|visibility <ID> <private|shareable>`",
  "**! 명령어 — 서버 관리자 (전용 서버)**",
  "`!mind status` · `!shared-memory list|add|edit|delete|nickname`",
  "`!타겟 지정 @역할|삭제|조회` · `!관리자_타겟 지정 @역할|삭제 @역할|조회`",
  "`!들낙감지설치` · `!들낙시간지정 <초>` · `!들낙무시 [채널ID|해제 채널ID]`",
  "**! 명령어 — 봇 소유자 (ADMIN_USER_ID)**",
  "`!sync` · `!서버목록` · `!서버별명령어 [서버] [enable|disable 명령]` · `!도움`",
  "",
  "자세한 입력 예시는 저장소의 README_USER.md를 확인하세요. `!help`는 누구나 사용할 수 있습니다."
].join("\n");

const reply = (message: Message, content: string) =>
  message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });

export const handlePrefixCommand = async (message: Message): Promise<boolean> => {
  if (message.author.bot) return false;
  const parsed = parsePrefixCommand(message.content);
  if (!parsed) return false;
  if (parsed.name === "help") {
    await reply(message, help);
    return true;
  }
  if (!isAllowedGuild(message.guildId)) {
    await reply(message, "이 명령어는 지정된 서버에서만 사용할 수 있습니다.");
    return true;
  }
  if (administratorCommands.has(parsed.name)) {
    const isAdmin = (message.member?.permissions.has(PermissionFlagsBits.Administrator) ?? false)
      || (ADMIN_USER_ID !== "" && message.author.id === ADMIN_USER_ID);
    if (!isAdmin) {
      await reply(message, "서버 관리자만 사용할 수 있습니다.");
      return true;
    }
  }
  const { name, args } = parsed;
  if (name === "model" || name === "reasoning") {
    const router = chatRouter();
    if (!router) await reply(message, "AI 대화 기능이 아직 초기화되지 않았습니다.");
    else if (name === "model") await handleModelCommand(message, router, args);
    else await handleReasoningCommand(message, router, args);
    return true;
  }
  if (name === "mind" || name === "memory" || name === "shared-memory") {
    const engine = chatMind();
    if (!engine) await reply(message, "기억 엔진이 아직 초기화되지 않았습니다.");
    else if (name === "mind") await handleMindCommand(message, engine, args);
    else if (name === "memory") await handleMemoryCommand(message, engine, args);
    else await handleSharedMemoryCommand(message, engine, args);
    return true;
  }
  if (message.guild) await handleRouletteSettingsCommand(message, message.guild, name, args);
  return true;
};
