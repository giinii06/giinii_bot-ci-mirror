import { PermissionFlagsBits, SlashCommandBuilder, type Client } from "discord.js";
import { config, MAX_HISTORY_MESSAGE_LIMIT } from "./config.js";

const rouletteCommandBuilders = [
  new SlashCommandBuilder().setName("타겟역할설정").setDescription("관리자 러시안 룰렛의 타겟 역할을 설정합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((option) => option.setName("역할").setDescription("러시안 룰렛 실행 시 제거할 역할").setRequired(true)),
  new SlashCommandBuilder().setName("관리자역할추가").setDescription("관리자 러시안 룰렛의 대상 역할을 추가합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption((option) => option.setName("역할").setDescription("러시안 룰렛 대상이 될 역할").setRequired(true)),
  new SlashCommandBuilder().setName("관리자머리끄댕이").setDescription("관리자를 대상으로 러시안 룰렛을 실행합니다")
];

const voiceCommandBuilders = [
  new SlashCommandBuilder().setName("친밀도").setDescription("같은 음성 채널에 함께 있었던 사람 TOP 7을 봅니다")
    .addUserOption((option) => option.setName("유저").setDescription("친밀도를 확인할 유저").setRequired(true))
];

const analysisCommandBuilders = [
  new SlashCommandBuilder().setName("question").setDescription("최근 디스코드 채팅 기록을 기반으로 AI에게 질문합니다.")
    .addStringOption((option) => option.setName("question").setDescription("물어볼 질문").setRequired(true).setMaxLength(1000))
    .addIntegerOption((option) => option.setName("limit").setDescription("가져올 최근 메시지 수. 기본값은 웹 설정이며 최대 10000개입니다.")
      .setRequired(false).setMinValue(1).setMaxValue(MAX_HISTORY_MESSAGE_LIMIT))
    .addStringOption((option) => option.setName("channels").setDescription("특정 채널만 쓰고 싶으면 #채널 멘션들을 입력하세요.")
      .setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder().setName("mbti").setDescription("최근 대화 기록을 바탕으로 유저의 MBTI를 논리적으로 추정합니다.")
    .addUserOption((option) => option.setName("user").setDescription("MBTI를 분석할 유저").setRequired(true)),
  new SlashCommandBuilder().setName("결투").setDescription("두 유저가 말로 싸우면 누가 이길지 예측합니다.")
    .addUserOption((option) => option.setName("user1").setDescription("첫 번째 유저").setRequired(true))
    .addUserOption((option) => option.setName("user2").setDescription("두 번째 유저").setRequired(true)),
  new SlashCommandBuilder().setName("계급").setDescription("최근 대화 기록으로 서버 유저들의 관계와 계급을 분석합니다."),
  new SlashCommandBuilder().setName("싸이코지수").setDescription("최근 대화 기록을 바탕으로 유저의 싸이코 지수를 측정합니다.")
    .addUserOption((option) => option.setName("user").setDescription("싸이코 지수를 측정할 유저").setRequired(true)),
  new SlashCommandBuilder().setName("별명").setDescription("최근 대화 기록을 바탕으로 유저에게 서버 밈 별명을 지어줍니다.")
    .addUserOption((option) => option.setName("user").setDescription("별명을 지어줄 유저").setRequired(true)),
  new SlashCommandBuilder().setName("흑역사").setDescription("최근 대화 기록에서 유저의 장난스러운 흑역사 포인트를 찾아줍니다.")
    .addUserOption((option) => option.setName("user").setDescription("흑역사를 분석할 유저").setRequired(true)),
  new SlashCommandBuilder().setName("요약").setDescription("최근 서버 대화 분위기와 주요 사건을 재밌게 요약합니다."),
  new SlashCommandBuilder().setName("캐릭터").setDescription("최근 대화 기록을 바탕으로 유저의 RPG 캐릭터 시트를 만듭니다.")
    .addUserOption((option) => option.setName("user").setDescription("캐릭터 시트를 만들 유저").setRequired(true))
];

export const commands = [...rouletteCommandBuilders, ...voiceCommandBuilders, ...analysisCommandBuilders].map((command) => command.toJSON());

export const syncCommands = async (client: Client) => {
  if (client.application) await client.application.commands.set([]);
  const guilds = config.guildId
    ? [await client.guilds.fetch(config.guildId)]
    : [...client.guilds.cache.values()];
  for (const guild of guilds) {
    await guild.commands.set([]);
    const registered = await guild.commands.set(commands);
    console.log(`Registered ${registered.size} slash commands in ${guild.name}`);
  }
};
