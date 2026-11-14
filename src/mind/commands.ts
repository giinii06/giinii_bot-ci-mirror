import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions
} from "discord.js";
import type { MindEngine } from "./engine.js";

export const mindCommand = new SlashCommandBuilder()
  .setName("mind")
  .setDescription("기니봇의 판단 엔진 상태를 확인합니다")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName("status").setDescription("Decision 호출량과 상태를 봅니다"));

export const memoryCommand = new SlashCommandBuilder()
  .setName("memory")
  .setDescription("기니봇이 나에 대해 저장한 기억을 관리합니다")
  .addSubcommand((sub) => sub.setName("list").setDescription("내 기억 목록을 봅니다"))
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("내 기억 하나를 지웁니다")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("목록에 보이는 번호").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("clear")
      .setDescription("내 기억을 전부 지웁니다")
      .addBooleanOption((option) =>
        option.setName("confirm").setDescription("정말 지우려면 true").setRequired(true)
      )
  );

export const mindCommandBuilders = [mindCommand, memoryCommand];

const ephemeral = (content: string): InteractionReplyOptions => ({
  content,
  flags: MessageFlags.Ephemeral
});

export const handleMindCommand = async (
  interaction: ChatInputCommandInteraction,
  engine: MindEngine
): Promise<void> => {
  const status = engine.status();
  const lines = [
    `상태: ${status.enabled ? "켜짐" : "꺼짐"} · 회로 ${status.breaker}`,
    `Decision 모델: \`${status.model}\``,
    `최근 24시간 ${status.usage.last24h}/${status.usage.dailyBudget}회, 최근 1분 ${status.usage.lastMinute}/${status.usage.minuteBudget}회`,
    `최근 실패율: ${(status.failureRate * 100).toFixed(1)}%`
  ];
  await interaction.reply(ephemeral(lines.join("\n")));
};

export const handleMemoryCommand = async (
  interaction: ChatInputCommandInteraction,
  engine: MindEngine
): Promise<void> => {
  const subcommand = interaction.options.getSubcommand();
  // 소유자는 모델 출력이 아니라 Discord Interaction에서 가져온다.
  const userId = interaction.user.id;

  if (subcommand === "list") {
    const memories = engine.listMemories(userId, 25);
    if (memories.length === 0) {
      await interaction.reply(ephemeral("저장된 기억이 없어."));
      return;
    }
    const lines = memories.map((memory) => `${memory.id}. ${memory.content}`);
    await interaction.reply(ephemeral(`네 기억 ${memories.length}개야.\n${lines.join("\n")}`));
    return;
  }

  if (subcommand === "delete") {
    const id = interaction.options.getInteger("id", true);
    const removed = engine.memories.remove(id, userId);
    await interaction.reply(
      ephemeral(removed ? `기억 ${id}번을 지웠어.` : `기억 ${id}번을 찾지 못했어. 내 기억만 지울 수 있어.`)
    );
    return;
  }

  if (subcommand === "clear") {
    if (!interaction.options.getBoolean("confirm", true)) {
      await interaction.reply(ephemeral("지우려면 confirm을 true로 다시 실행해줘."));
      return;
    }
    const removed = engine.clearMemories(userId);
    await interaction.reply(
      ephemeral(
        `네 기억 ${removed}개와 관계 추정값을 지웠어. 원본 채팅 기록은 서버 통계에 그대로 남아 있어.`
      )
    );
  }
};
