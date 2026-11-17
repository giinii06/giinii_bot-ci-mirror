import { ApplicationCommandType, ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, type APIApplicationCommand, type ApplicationCommandDataResolvable, type ApplicationCommandManager, type Client, type Guild } from "discord.js";
import { chatCommandBuilders } from "./chat/commands.js";
import { mindCommandBuilders } from "./mind/commands.js";
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
  new SlashCommandBuilder().setName("관리자머리끄댕이").setDescription("관리자를 대상으로 러시안 룰렛을 실행합니다")
];

/** 룰렛 명령 3종. 전용 길드에서만 실행한다. */
export const rouletteCommandNames = new Set(rouletteCommandBuilders.map((command) => command.name));

const voiceCommandBuilders = [
  new SlashCommandBuilder().setName("친밀도그래프").setDescription("통화량 상위 20명의 친밀도 그래프를 FHD 이미지로 봅니다"),
  new SlashCommandBuilder().setName("친밀도").setDescription("같은 음성 채널에 함께 있었던 사람 TOP 21을 봅니다")
    .addUserOption((option) => option.setName("유저").setDescription("친밀도를 확인할 유저").setRequired(true)),
  new SlashCommandBuilder().setName("통화량").setDescription("서버 전체 통화량 TOP 21을 봅니다"),
  new SlashCommandBuilder().setName("통계").setDescription("전체 통화량·채팅량·종합 활동량 TOP 7 카드 3장을 봅니다")
];

/** 3D 친밀도 그래프. 브라우저 WebGL로 그리므로 전용 서버에만 등록한다. */
const graph3dCommandBuilders = [
  new SlashCommandBuilder().setName("친밀도그래프3d").setDescription("친밀도 그래프를 3D로 엽니다 (전용 서버)")
];

const globalCommands = voiceCommandBuilders.map((command) => command
  .setContexts(InteractionContextType.Guild).setIntegrationTypes(ApplicationIntegrationType.GuildInstall).toJSON());
const graph3dCommands = graph3dCommandBuilders.map((command) => command.toJSON());
const rouletteCommands = rouletteCommandBuilders.map((command) => command.toJSON());
const chatCommands = chatCommandBuilders.map((command) => command.toJSON());
const mindCommands = mindCommandBuilders.map((command) => command.toJSON());
/** 전용 서버(ALLOWED_GUILD_ID)에만 등록하는 명령. 룰렛 3종과 기니봇아 대화·기억·3D 그래프 명령. */
const dedicatedGuildCommands = [...rouletteCommands, ...chatCommands, ...mindCommands, ...graph3dCommands];
export const commands = [...dedicatedGuildCommands, ...globalCommands];
export const commandScopeCounts = { global: globalCommands.length, dedicated: dedicatedGuildCommands.length };

/** 서버별 on/off 설정과 대조할 슬래시 명령어 이름 목록. */
export const slashCommandNames = [
  ...rouletteCommandBuilders, ...voiceCommandBuilders, ...chatCommandBuilders, ...mindCommandBuilders,
  ...graph3dCommandBuilders
].map((command) => command.name);

const syncCommandSet = async (manager: Pick<ApplicationCommandManager, "fetch" | "set">, wanted: typeof commands, scope: string) => {
  const current = await manager.fetch();
  // Activities가 켜지면 Discord가 전역 Entry Point 명령을 만든다. set()은 목록을 통째로
  // 교체하므로, 이 명령을 함께 보내지 않으면 Activity 실행 입구가 사라진다.
  const preserved = [...current.values()]
    .filter((command) => command.type === ApplicationCommandType.PrimaryEntryPoint)
    .map((command) => {
      const raw = command.toJSON() as unknown as {
        name: string; description: string; type: ApplicationCommandType; handler?: number;
        integration_types?: number[]; contexts?: number[];
      };
      return {
        name: raw.name,
        description: raw.description,
        type: raw.type,
        handler: raw.handler ?? 2,
        integration_types: raw.integration_types,
        contexts: raw.contexts,
      };
    });
  const desired = [...preserved, ...wanted];
  if (current.size === desired.length && wanted.every((command) => {
    const existing = current.find((entry) => entry.name === command.name);
    if (!existing) return false;
    // toJSON()은 값이 undefined인 키를 남긴다. 실제 전송 본문처럼 그 키를 떨어뜨려 비교한다.
    const normalized = JSON.parse(JSON.stringify(command)) as APIApplicationCommand;
    return existing.equals(normalized, true);
  })) {
    console.log(`Slash commands already up to date in ${scope} (${current.size}), skipped`);
    return;
  }
  const registered = await manager.set(desired as ApplicationCommandDataResolvable[]);
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
