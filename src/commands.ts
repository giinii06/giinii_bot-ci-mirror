import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, type ApplicationCommandManager, type Client, type Guild } from "discord.js";
import { chatCommandBuilders } from "./chat/commands.js";
import { ALLOWED_GUILD_ID } from "./command-rules.js";

const rouletteCommandBuilders = [
  new SlashCommandBuilder().setName("타겟").setDescription("관리자 러시안 룰렛의 타겟 역할을 관리합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName("인자").setDescription("지정, 삭제, 조회 중 하나를 선택하세요").setRequired(true)
      .addChoices(
        { name: "지정", value: "지정" },
        { name: "삭제", value: "삭제" },
        { name: "조회", value: "조회" }
      ))
    .addRoleOption((option) => option.setName("역할").setDescription("지정할 타겟 역할").setRequired(false)),
  new SlashCommandBuilder().setName("관리자_타겟").setDescription("관리자 러시안 룰렛의 대상 역할을 관리합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName("인자").setDescription("지정, 삭제, 조회 중 하나를 선택하세요").setRequired(true)
      .addChoices(
        { name: "지정", value: "지정" },
        { name: "삭제", value: "삭제" },
        { name: "조회", value: "조회" }
      ))
    .addRoleOption((option) => option.setName("역할").setDescription("지정하거나 삭제할 관리자 역할").setRequired(false)),
  new SlashCommandBuilder().setName("관리자머리끄댕이").setDescription("관리자를 대상으로 러시안 룰렛을 실행합니다"),
  new SlashCommandBuilder().setName("관리자머리끄댕이방어권_역할").setDescription("관리자 러시안 룰렛 방어권 역할을 관리합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName("인자").setDescription("추가, 조회, 제거 중 하나를 선택하세요").setRequired(true)
      .addChoices(
        { name: "추가", value: "추가" },
        { name: "조회", value: "조회" },
        { name: "제거", value: "제거" }
      ))
    .addRoleOption((option) => option.setName("역할").setDescription("추가하거나 제거할 방어권 역할").setRequired(false))
];

const voiceCommandBuilders = [
  new SlashCommandBuilder().setName("친밀도그래프").setDescription("통화량 상위 20명의 친밀도 그래프를 FHD 이미지로 봅니다"),
  new SlashCommandBuilder().setName("친밀도").setDescription("같은 음성 채널에 함께 있었던 사람 TOP 7을 봅니다")
    .addUserOption((option) => option.setName("유저").setDescription("친밀도를 확인할 유저").setRequired(true)),
  new SlashCommandBuilder().setName("통화량").setDescription("서버 전체 통화량 TOP 21을 봅니다"),
  new SlashCommandBuilder().setName("통계").setDescription("전체 통화량·채팅량·종합 활동량 TOP 7 카드 3장을 봅니다")
];

const globalCommands = voiceCommandBuilders.map((command) => command
  .setContexts(InteractionContextType.Guild).setIntegrationTypes(ApplicationIntegrationType.GuildInstall).toJSON());
const rouletteCommands = rouletteCommandBuilders.map((command) => command.toJSON());
const chatCommands = chatCommandBuilders.map((command) => command.toJSON());
/** 전용 서버(ALLOWED_GUILD_ID)에만 등록하는 명령. 룰렛 4종과 기니봇아 대화 2종. */
const dedicatedGuildCommands = [...rouletteCommands, ...chatCommands];
export const commands = [...dedicatedGuildCommands, ...globalCommands];

/** 서버별 on/off 설정과 대조할 슬래시 명령어 이름 목록. 순서는 등록 순서와 같다. */
export const slashCommandNames = [
  ...rouletteCommandBuilders, ...voiceCommandBuilders, ...chatCommandBuilders
].map((command) => command.name);

const syncCommandSet = async (manager: Pick<ApplicationCommandManager, "fetch" | "set">, wanted: typeof commands, scope: string) => {
  const current = await manager.fetch();
  if (current.size === wanted.length && wanted.every((command) => {
    const existing = current.find((entry) => entry.name === command.name);
    return existing?.equals({ ...command, id: existing.id, application_id: existing.applicationId,
      version: existing.version, type: command.type ?? 1, nsfw: command.nsfw ?? false,
      default_member_permissions: command.default_member_permissions ?? null }, true);
  })) {
    console.log(`Slash commands already up to date in ${scope} (${current.size}), skipped`);
    return;
  }
  const registered = await manager.set(wanted);
  console.log(`Registered ${registered.size} slash commands in ${scope}`);
};

export const syncCommands = async (client: Client, targetGuild?: Guild) => {
  if (!client.application) throw new Error("Discord application is not ready");
  await syncCommandSet(client.application.commands, globalCommands, "global");
  const guilds = targetGuild ? [targetGuild] : [...client.guilds.cache.values()];
  for (const guild of guilds) {
    // 길드 명령은 같은 이름의 전역 명령보다 우선하므로 이전 일반 명령을 제거한다.
    await syncCommandSet(guild.commands, guild.id === ALLOWED_GUILD_ID ? dedicatedGuildCommands : [], guild.name);
  }
};
