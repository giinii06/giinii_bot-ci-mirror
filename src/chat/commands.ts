import {
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction
} from "discord.js";
import { isChatEnabled } from "./config.js";
import { REASONING_EFFORTS, isReasoningEffort, type OpenRouterClient } from "./router.js";

export const modelCommand = new SlashCommandBuilder()
  .setName("model")
  .setDescription("기니봇이 대답에 쓸 OpenRouter 모델을 바꿉니다")
  .addStringOption((option) =>
    option
      .setName("name")
      .setDescription("모델 이름 (비우면 현재 모델을 보여줍니다)")
      .setRequired(false)
      .setAutocomplete(true)
  );

export const reasoningCommand = new SlashCommandBuilder()
  .setName("reasoning")
  .setDescription("기니봇의 추론 정도를 바꿉니다")
  .addStringOption((option) =>
    option
      .setName("effort")
      .setDescription("none, minimal, low, medium, high, xhigh, max (비우면 현재 값)")
      .setRequired(false)
      .setAutocomplete(true)
  );

export const chatCommandBuilders = [modelCommand, reasoningCommand];

const DISABLED_NOTICE = "OPENROUTER_API_KEY가 비어 있어서 기니봇아 대화 기능이 꺼져 있어. .env를 채우고 봇을 다시 시작해줘.";

const formatEfforts = (efforts: string[]) => efforts.map((effort) => `\`${effort}\``).join(", ");

const supportedEfforts = async (router: OpenRouterClient): Promise<string[] | null> => {
  const models = await router.listModels().catch(() => []);
  return models.find((model) => model.id === router.currentModel)?.supportedEfforts ?? null;
};

export const handleModelCommand = async (
  interaction: ChatInputCommandInteraction,
  router: OpenRouterClient
): Promise<void> => {
  if (!isChatEnabled()) {
    await interaction.reply({ content: DISABLED_NOTICE, flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.options.getString("name")?.trim();

  if (!name) {
    await interaction.reply({
      content: `지금 모델: \`${router.currentModel}\`\n바꾸려면 \`/model name:<모델 이름>\` 을 입력해줘.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const models = await router.listModels().catch(() => []);
  const match = models.find((model) => model.id === name);

  if (models.length > 0 && !match) {
    const guesses = models
      .filter((model) => model.id.toLowerCase().includes(name.toLowerCase()))
      .slice(0, 5)
      .map((model) => `- \`${model.id}\``)
      .join("\n");

    await interaction.reply({
      content: guesses
        ? `\`${name}\` 모델이 없어. 비슷한 이름:\n${guesses}`
        : `\`${name}\` 모델이 없어. \`/model\` 입력창에서 목록을 볼 수 있어.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  router.setModel(name);
  console.log(`[model] ${interaction.user.tag} → ${name}`);

  const caution =
    match && !match.free ? "\n⚠️ 무료 모델이 아니라 OpenRouter 크레딧이 필요할 수 있어." : "";
  await interaction.reply({
    content: `모델을 바꿨어: \`${name}\`${caution}`,
    flags: MessageFlags.Ephemeral
  });
};

export const handleModelAutocomplete = async (
  interaction: AutocompleteInteraction,
  router: OpenRouterClient
): Promise<void> => {
  if (!isChatEnabled()) {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused().trim().toLowerCase();
  const models = await router.listModels().catch(() => []);

  const choices = models
    .filter((model) => model.id.toLowerCase().includes(query))
    .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id))
    .slice(0, 25)
    .map((model) => {
      const context = model.contextLength > 0 ? ` · ${Math.round(model.contextLength / 1000)}k` : "";
      return {
        name: `${model.free ? "무료" : "유료"} · ${model.id}${context}`,
        value: model.id
      };
    });

  await interaction.respond(choices);
};

export const handleReasoningCommand = async (
  interaction: ChatInputCommandInteraction,
  router: OpenRouterClient
): Promise<void> => {
  if (!isChatEnabled()) {
    await interaction.reply({ content: DISABLED_NOTICE, flags: MessageFlags.Ephemeral });
    return;
  }

  const requested = interaction.options.getString("effort")?.trim().toLowerCase();
  const supported = await supportedEfforts(router);

  if (!requested) {
    const lines = [`지금 추론 정도: \`${router.reasoningEffort}\``];
    lines.push(
      supported
        ? `이 모델이 지원하는 값: ${formatEfforts(supported)}`
        : "바꾸려면 `/reasoning effort:low` 처럼 입력해."
    );
    await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isReasoningEffort(requested)) {
    await interaction.reply({
      content: `\`${requested}\`는 모르는 값이야. 쓸 수 있는 값: ${formatEfforts(REASONING_EFFORTS)}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (supported && !supported.includes(requested)) {
    await interaction.reply({
      content: `\`${requested}\`는 \`${router.currentModel}\`에서 지원하지 않아. 지원 값: ${formatEfforts(supported)}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  router.setReasoningEffort(requested);
  console.log(`[reasoning] ${interaction.user.tag} → ${requested}`);

  const note = requested === "none" ? " 이제 추론 없이 바로 답해." : "";
  await interaction.reply({
    content: `추론 정도를 \`${requested}\`로 바꿨어.${note}`,
    flags: MessageFlags.Ephemeral
  });
};

export const handleReasoningAutocomplete = async (
  interaction: AutocompleteInteraction,
  router: OpenRouterClient
): Promise<void> => {
  if (!isChatEnabled()) {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused().trim().toLowerCase();
  const efforts = (await supportedEfforts(router)) ?? REASONING_EFFORTS;

  await interaction.respond(
    efforts.filter((effort) => effort.includes(query)).map((effort) => ({ name: effort, value: effort }))
  );
};
