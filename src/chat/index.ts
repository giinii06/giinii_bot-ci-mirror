import type { Client, Message } from "discord.js";
import { buildConversation } from "./context.js";
import { chatConfig, isChatEnabled } from "./config.js";
import { isAllowedGuild } from "../command-rules.js";
import { ChannelHistory, type HistoryEntry } from "./history.js";
import { loadInstructions } from "./instructions.js";
import { extractMemories, formatMemoryNotice, MemoryStore } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import { OpenRouterClient, type ChatMessage } from "./router.js";
import { detectTrigger } from "./triggers.js";
import { createWebSearchTool } from "./websearch.js";

export type ChatDeps = {
  botId: string;
  history: ChannelHistory;
  memory: MemoryStore;
  router: OpenRouterClient;
};

const DISCORD_MESSAGE_LIMIT = 2000;
const FALLBACK_WITH_MEMORY = "응, 기억 정리해뒀어.";
const FALLBACK_EMPTY = "음, 방금 답을 놓쳤어. 한 번만 다시 말해줄래?";

let deps: ChatDeps | null = null;

const clamp = (content: string): string => {
  const trimmed = content.trim();
  if (trimmed.length <= DISCORD_MESSAGE_LIMIT) return trimmed;
  return `${trimmed.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
};

const authorLabel = (message: Message): string => {
  const display =
    message.member?.displayName ?? message.author.displayName ?? message.author.username;
  const username = message.author.username;
  return display === username ? display : `${display} (@${username})`;
};

export const toHistoryEntry = (
  message: Message,
  options: { fromBot?: boolean } = {}
): HistoryEntry | null => {
  const content = (message.content ?? "").trim();
  if (!content) return null;
  return {
    id: message.id,
    authorId: message.author.id,
    author: authorLabel(message),
    content,
    fromBot: options.fromBot ?? message.author.bot
  };
};

const isToolError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("tool") || message.includes("function");
};

const recordOwnMessage = (target: ChatDeps, sent: Message | null): void => {
  if (!sent) return;
  const entry = toHistoryEntry(sent, { fromBot: true });
  if (entry) target.history.record(sent.channelId, entry);
};

const replyToTrigger = async (message: Message, target: ChatDeps): Promise<boolean> => {
  const trigger = detectTrigger(
    {
      content: message.content ?? "",
      botId: target.botId,
      mentionedBot: message.mentions.users.has(target.botId),
      repliedToBot: message.mentions.repliedUser?.id === target.botId
    },
    chatConfig.prefix
  );

  if (!trigger) return false;
  if (!message.channel.isSendable()) return false;

  if (!trigger.text) {
    await message.reply({
      content: `불렀으면 하고 싶은 말도 같이 적어줘. 예: \`${chatConfig.prefix} 오늘 점심 뭐 먹지?\``,
      allowedMentions: { repliedUser: false }
    });
    return true;
  }

  await message.channel.sendTyping().catch(() => undefined);

  const [memoryText, instructions] = await Promise.all([
    target.memory.read(),
    loadInstructions(chatConfig.agentsPath)
  ]);
  const conversation = buildConversation(
    target.history.recent(message.channelId, { excludeId: message.id }),
    { speaker: authorLabel(message), text: trigger.text }
  );

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({ instructions: instructions.text, memory: memoryText })
    },
    ...conversation
  ];
  const options = {
    maxTokens: chatConfig.maxReplyTokens,
    timeoutMs: chatConfig.requestTimeoutMs
  };
  const exaKey = chatConfig.exaApiKey;
  const webSearch = exaKey ? createWebSearchTool(exaKey) : null;

  let raw: string;
  if (webSearch) {
    try {
      raw = await target.router.completeWithTools(
        messages,
        options,
        [webSearch.definition],
        webSearch.run
      );
    } catch (error) {
      if (!isToolError(error)) throw error;
      console.error("[search] 툴 호출 실패, 툴 없이 다시 시도합니다.", error);
      raw = await target.router.complete(messages, options);
    }
  } else {
    raw = await target.router.complete(messages, options);
  }

  const { reply, memories, edits, removals } = extractMemories(raw);
  const hasMemoryOps = memories.length > 0 || edits.length > 0 || removals.length > 0;
  const visible = reply || (hasMemoryOps ? FALLBACK_WITH_MEMORY : FALLBACK_EMPTY);

  const sent = await message.reply({
    content: clamp(visible),
    allowedMentions: { repliedUser: true, parse: [] }
  });
  recordOwnMessage(target, sent);

  if (hasMemoryOps) {
    const batch = await target.memory.apply({ add: memories, edits, remove: removals });
    const notice = formatMemoryNotice(batch);
    if (notice) {
      await message.channel.send({ content: clamp(notice), allowedMentions: { parse: [] } });
    }
  }

  return true;
};

export const initChat = async (client: Client<true>): Promise<void> => {
  const memory = new MemoryStore(chatConfig.memoryPath);
  await memory.init().catch((error) => console.error("[chat] 기억 파일 초기화 실패", error));

  const router = new OpenRouterClient(
    chatConfig.apiKey,
    chatConfig.model,
    chatConfig.baseUrl,
    chatConfig.reasoningEffort
  );
  deps = {
    botId: client.user.id,
    history: new ChannelHistory(chatConfig.historyLimit),
    memory,
    router
  };

  console.log(`[memory] ${chatConfig.memoryPath}`);
  console.log(`[key] ${chatConfig.keySource}`);
  console.log(`[model] ${router.currentModel} (effort ${router.reasoningEffort})`);
  console.log(`[search] ${chatConfig.exaApiKey ? "Exa 켜짐" : "꺼짐 (EXA_API_KEY 없음)"}`);
  const instructions = await loadInstructions(chatConfig.agentsPath);
  console.log(
    `[soul] ${chatConfig.agentsPath} (${instructions.source === "file" ? "파일" : "기본 지침"})`
  );

  if (isChatEnabled()) {
    console.log(`[chat] '${chatConfig.prefix}' 호출, 멘션, 답장에 답합니다 (전용 서버에서만)`);
  } else {
    console.warn("[chat] OPENROUTER_API_KEY가 비어 있어 '기니봇아' 대화가 꺼져 있습니다.");
  }
};

export const chatRouter = (): OpenRouterClient | null => deps?.router ?? null;

/** 채널 기록을 남기고, 호출이면 답장한다. 답장했으면 true. */
export const handleChatMessage = async (message: Message): Promise<boolean> => {
  const target = deps;
  if (!target) return false;
  // 대화 기능은 룰렛과 같은 전용 서버에서만 동작한다. DM과 다른 서버는 무시한다.
  if (!isAllowedGuild(message.guildId)) return false;

  try {
    if (message.system || message.author.bot) return false;
    if (!message.content?.trim()) return false;

    const entry = toHistoryEntry(message);
    if (entry) target.history.record(message.channelId, entry);

    if (!isChatEnabled()) return false;

    return await replyToTrigger(message, target);
  } catch (error) {
    console.error("[chat]", error);
    await message
      .reply({
        content: "답장을 만드는 중에 오류가 났어. 잠시 뒤에 다시 불러줘.",
        allowedMentions: { repliedUser: false }
      })
      .catch(() => undefined);
    return true;
  }
};
