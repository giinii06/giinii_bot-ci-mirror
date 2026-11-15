import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions
} from "discord.js";
import type { MindEngine } from "./engine.js";
import type { MemoryActor, MemoryCategory, MemoryRecord, MemoryVisibility } from "./types.js";

export const mindCommand = new SlashCommandBuilder()
  .setName("mind")
  .setDescription("기니봇의 판단 엔진 상태를 확인합니다")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Decision 호출량과 상태를 봅니다")
  );

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
  )
  .addSubcommand((sub) =>
    sub
      .setName("visibility")
      .setDescription("내 기억을 다른 사람과 공유할지 정합니다")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("목록에 보이는 번호").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("visibility")
          .setDescription("공개 범위")
          .setRequired(true)
          .addChoices(
            { name: "비공개", value: "private" },
            { name: "공유 가능", value: "shareable" }
          )
      )
  );

export const sharedMemoryCommand = new SlashCommandBuilder()
  .setName("shared-memory")
  .setDescription("서버 공용 기억을 관리합니다")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName("list").setDescription("공용 기억 목록을 봅니다"))
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("공용 기억을 직접 추가합니다")
      .addStringOption((option) =>
        option.setName("content").setDescription("기억할 내용").setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("category")
          .setDescription("기억 종류")
          .setRequired(true)
          .addChoices(
            { name: "사실", value: "fact" },
            { name: "취향", value: "preference" },
            { name: "서버 관습", value: "server_convention" }
          )
      )
      .addUserOption((option) =>
        option.setName("subject").setDescription("대상 사용자 (선택)").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("edit")
      .setDescription("공용 기억을 수정합니다")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("기억 번호").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("content").setDescription("새 내용").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("공용 기억을 지웁니다")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("기억 번호").setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName("pending").setDescription("승인 대기 목록을 봅니다"))
  .addSubcommand((sub) =>
    sub
      .setName("approve")
      .setDescription("승인 대기 기억을 승인합니다")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("기억 번호").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("reject")
      .setDescription("승인 대기 기억을 거절합니다")
      .addIntegerOption((option) =>
        option.setName("id").setDescription("기억 번호").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("nickname")
      .setDescription("사용자에게 적용할 공용 별명을 설정합니다")
      .addUserOption((option) =>
        option.setName("user").setDescription("대상 사용자").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("nickname").setDescription("별명").setRequired(true)
      )
  );

export const mindCommandBuilders = [mindCommand, memoryCommand, sharedMemoryCommand];

const ephemeral = (content: string): InteractionReplyOptions => ({
  content,
  flags: MessageFlags.Ephemeral,
  allowedMentions: { parse: [] }
});

const memoryLine = (memory: MemoryRecord): string =>
  `${memory.id}. [${memory.category}] ${memory.content}`;

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
    const lines = memories.map(
      (memory) =>
        `${memoryLine(memory)} (${memory.visibility === "shareable" ? "공유 가능" : "비공개"})`
    );
    await interaction.reply(ephemeral(`네 기억 ${memories.length}개야.\n${lines.join("\n")}`));
    return;
  }

  if (subcommand === "delete") {
    const id = interaction.options.getInteger("id", true);
    const removed = engine.memories.deletePersonal(id, userId);
    await interaction.reply(
      ephemeral(
        removed
          ? `기억 ${id}번을 지웠어.`
          : `기억 ${id}번을 찾지 못했어. 내 기억만 지울 수 있어.`
      )
    );
    return;
  }

  if (subcommand === "visibility") {
    const id = interaction.options.getInteger("id", true);
    const visibility = interaction.options.getString("visibility", true) as MemoryVisibility;
    const changed = engine.setMemoryVisibility(userId, id, visibility);
    await interaction.reply(
      ephemeral(
        changed
          ? `기억 ${id}번을 ${visibility === "shareable" ? "공유 가능" : "비공개"}으로 바꿨어.`
          : `기억 ${id}번을 찾지 못했어. 내 기억만 바꿀 수 있어.`
      )
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
        `네 기억 ${removed}개와 관계 추정값을 지웠어. 공용 기억과 원본 채팅 기록은 그대로야.`
      )
    );
  }
};

const requireAdministrator = async (
  interaction: ChatInputCommandInteraction
): Promise<boolean> => {
  if (
    !interaction.inCachedGuild() ||
    !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.reply(ephemeral("관리자만 사용할 수 있습니다."));
    return false;
  }
  return true;
};

const actorOf = (interaction: ChatInputCommandInteraction<"cached">): MemoryActor => ({
  userId: interaction.user.id,
  guildId: interaction.guildId,
  isAdministrator: true,
  source: "slash_command"
});

export const handleSharedMemoryCommand = async (
  interaction: ChatInputCommandInteraction,
  engine: MindEngine
): Promise<void> => {
  // 명령 등록 권한과 별개로 실행 시점에 다시 확인한다.
  if (!(await requireAdministrator(interaction))) return;
  if (!interaction.inCachedGuild()) return;

  const actor = actorOf(interaction);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const memories = engine.listGuildMemories(50);
    if (memories.length === 0) {
      await interaction.reply(ephemeral("저장된 공용 기억이 없어."));
      return;
    }
    await interaction.reply(
      ephemeral(
        `공용 기억 ${memories.length}개야.\n${memories.map(memoryLine).join("\n")}`
      )
    );
    return;
  }

  if (subcommand === "add") {
    const category = interaction.options.getString("category", true) as MemoryCategory;
    if (category === "nickname") {
      await interaction.reply(ephemeral("별명은 /shared-memory nickname으로 설정해줘."));
      return;
    }
    const subject = interaction.options.getUser("subject");
    const saved = engine.addGuildMemory({
      actor,
      category,
      subjectUserId: subject?.id ?? null,
      content: interaction.options.getString("content", true)
    });
    await interaction.reply(
      ephemeral(
        saved ? `공용 기억 ${saved.id}번을 저장했어.` : "같은 내용이 이미 있거나 저장하지 못했어."
      )
    );
    return;
  }

  if (subcommand === "edit") {
    const id = interaction.options.getInteger("id", true);
    const updated = engine.updateGuildMemory(id, actor, {
      content: interaction.options.getString("content", true)
    });
    await interaction.reply(
      ephemeral(updated ? `공용 기억 ${id}번을 수정했어.` : `공용 기억 ${id}번을 찾지 못했어.`)
    );
    return;
  }

  if (subcommand === "delete") {
    const id = interaction.options.getInteger("id", true);
    const removed = engine.deleteGuildMemory(id, actor);
    await interaction.reply(
      ephemeral(removed ? `공용 기억 ${id}번을 지웠어.` : `공용 기억 ${id}번을 찾지 못했어.`)
    );
    return;
  }

  if (subcommand === "pending") {
    const memories = engine.listPendingGuildMemories(25);
    if (memories.length === 0) {
      await interaction.reply(ephemeral("승인 대기 중인 공용 기억이 없어."));
      return;
    }
    await interaction.reply(
      ephemeral(
        `승인 대기 ${memories.length}개야.\n${memories.map(memoryLine).join("\n")}`
      )
    );
    return;
  }

  if (subcommand === "approve" || subcommand === "reject") {
    const id = interaction.options.getInteger("id", true);
    const changed =
      subcommand === "approve"
        ? engine.approveGuildMemory(id, actor)
        : engine.rejectGuildMemory(id, actor);
    await interaction.reply(
      ephemeral(
        changed
          ? `공용 기억 ${id}번을 ${subcommand === "approve" ? "승인" : "거절"}했어.`
          : `대기 중인 공용 기억 ${id}번을 찾지 못했어.`
      )
    );
    return;
  }

  if (subcommand === "nickname") {
    const user = interaction.options.getUser("user", true);
    const result = engine.setGuildNickname({
      actor,
      subjectUserId: user.id,
      subjectDisplayName: user.displayName,
      nickname: interaction.options.getString("nickname", true)
    });
    await interaction.reply(
      ephemeral(
        result.ok
          ? `${user.displayName}님의 별명을 "${result.memory.structuredValue}"로 설정했어.`
          : result.reason
      )
    );
  }
};
