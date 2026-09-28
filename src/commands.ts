import { PermissionFlagsBits, SlashCommandBuilder, type Client } from "discord.js";
import { config, MAX_HISTORY_MESSAGE_LIMIT } from "./config.js";

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
  new SlashCommandBuilder().setName("친밀도").setDescription("같은 음성 채널에 함께 있었던 사람 TOP 21을 봅니다")
    .addUserOption((option) => option.setName("유저").setDescription("친밀도를 확인할 유저").setRequired(true)),
  new SlashCommandBuilder().setName("통화량").setDescription("서버 전체 통화량 TOP 21을 봅니다"),
  new SlashCommandBuilder().setName("통계").setDescription("채팅량·통화량·종합 활동량 카드 3장을 봅니다")
    .addStringOption((option) => option.setName("기간").setDescription("통계를 확인할 기간").setRequired(false)
      .addChoices(
        { name: "오늘", value: "day" },
        { name: "이번 주", value: "week" },
        { name: "이번 달", value: "month" },
        { name: "전체", value: "all" }
      ))
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
  // set(commands) 가 전체를 덮어쓰므로 먼저 빈 셋으로 지우는 호출은 불필요하다.
  // 그 DELETE 가 명령 엔드포인트에서 가장 스로틀에 걸리는 호출이라 기동을 붙잡았다.
  //
  // 그리고 디스코드는 명령 '생성'을 하루 200회로 제한한다(code 30034). 매 기동마다
  // 덮어쓰면 재시작 12번으로 quota 가 소진돼 명령이 사라진 채 복구되지 않는다.
  // 그래서 내용이 같으면 아예 쓰지 않는다.
  const started = Date.now();
  const guilds = config.guildId
    ? [await client.guilds.fetch(config.guildId)]
    : [...client.guilds.cache.values()];
  console.log(`Command sync: ${guilds.length} guild(s) resolved in ${Date.now() - started}ms, comparing`);
  for (const guild of guilds) {
    const wanted = commands as unknown as { name: string; options?: unknown[] }[];
    const current = await guild.commands.fetch();
    const same = current.size === wanted.length
      && wanted.every((w) => {
        const have = current.get(w.name);
        return have && JSON.stringify(have.options) === JSON.stringify(w.options ?? []);
      });
    if (same) {
      console.log(`Slash commands already up to date in ${guild.name} (${current.size}), skipped`);
      continue;
    }
    const at = Date.now();
    const registered = await guild.commands.set(commands);
    console.log(`Registered ${registered.size} slash commands in ${guild.name} (${Date.now() - at}ms)`);
  }
};
