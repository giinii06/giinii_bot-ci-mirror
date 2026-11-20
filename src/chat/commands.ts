import type { Message } from "discord.js";
import { isChatEnabled } from "./config.js";
import { REASONING_EFFORTS, isReasoningEffort, type OpenRouterClient } from "./router.js";

const disabledNotice = "OPENROUTER_API_KEY가 비어 있어 AI 대화 기능이 꺼져 있습니다.";
const send = (message: Message, content: string) =>
  message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
const formatEfforts = (efforts: string[]) => efforts.map((effort) => "`" + effort + "`").join(", ");

export const handleModelCommand = async (message: Message, router: OpenRouterClient, input: string): Promise<void> => {
  if (!isChatEnabled()) {
    await send(message, disabledNotice);
    return;
  }
  const name = input.trim();
  if (!name) {
    await send(message, `현재 모델: \`${router.currentModel}\`\n변경: !model <모델 ID>`);
    return;
  }
  const models = await router.listModels().catch(() => []);
  const match = models.find((model) => model.id === name);
  if (models.length && !match) {
    const guesses = models.filter((model) => model.id.toLowerCase().includes(name.toLowerCase()))
      .slice(0, 5).map((model) => model.id).join(", ");
    await send(message, guesses ? `없는 모델입니다. 비슷한 모델: ${guesses}` : "목록에 없는 모델입니다.");
    return;
  }
  router.setModel(name);
  console.log(`[model] ${message.author.id} → ${name}`);
  await send(message, `모델 변경: \`${name}\`${match && !match.free ? " (유료 크레딧 필요 가능)" : ""}`);
};

export const handleReasoningCommand = async (message: Message, router: OpenRouterClient, input: string): Promise<void> => {
  if (!isChatEnabled()) {
    await send(message, disabledNotice);
    return;
  }
  const supported = (await router.listModels().catch(() => []))
    .find((model) => model.id === router.currentModel)?.supportedEfforts ?? null;
  const effort = input.trim().toLowerCase();
  if (!effort) {
    await send(message, `현재 추론: \`${router.reasoningEffort}\`\n지원 값: ${formatEfforts(supported ?? [...REASONING_EFFORTS])}`);
    return;
  }
  if (!isReasoningEffort(effort)) {
    await send(message, `지원하지 않는 값입니다: ${formatEfforts([...REASONING_EFFORTS])}`);
    return;
  }
  if (supported && !supported.includes(effort)) {
    await send(message, `현재 모델의 지원 값: ${formatEfforts(supported)}`);
    return;
  }
  router.setReasoningEffort(effort);
  console.log(`[reasoning] ${message.author.id} → ${effort}`);
  await send(message, `추론 정도: \`${effort}\``);
};
