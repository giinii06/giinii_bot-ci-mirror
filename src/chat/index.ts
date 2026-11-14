import type { Client, Message } from "discord.js";
import { ALLOWED_GUILD_ID, isAllowedGuild } from "../command-rules.js";
import { mindConfig } from "../mind/config.js";
import { ensureMindSchema, ensureRootSchema } from "../mind/db.js";
import { MindEngine } from "../mind/engine.js";
import { migrateLegacyMemory } from "../mind/memory/migration.js";
import type { MindRequest, SearchHit } from "../mind/types.js";
import { buildConversation } from "./context.js";
import { chatConfig, isChatEnabled } from "./config.js";
import { ChannelHistory, type HistoryEntry } from "./history.js";
import { loadInstructions } from "./instructions.js";
import { buildSystemPrompt } from "./prompt.js";
import { OpenRouterClient, DuplicateTurnError, type ChatMessage } from "./router.js";
import { detectTrigger, type Trigger } from "./triggers.js";
import { KeyedSerialQueue, TurnGuard } from "./turns.js";
import { searchBeforeReply } from "./websearch.js";

export type ChatDeps = {
  botId: string;
  history: ChannelHistory;
  router: OpenRouterClient;
  mind: MindEngine;
  turns: TurnGuard;
  queue: KeyedSerialQueue;
};

const DISCORD_MESSAGE_LIMIT = 2000;

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
    fromBot: options.fromBot ?? message.author.bot,
    createdAt: message.createdTimestamp
  };
};

const recordOwnMessage = (target: ChatDeps, sent: Message | null): void => {
  if (!sent) return;
  const entry = toHistoryEntry(sent, { fromBot: true });
  if (entry) target.history.record(sent.channelId, entry);
};

const buildRequest = (message: Message, trigger: Trigger, target: ChatDeps): MindRequest => ({
  messageId: message.id,
  guildId: message.guildId ?? "",
  channelId: message.channelId,
  userId: message.author.id,
  displayName: authorLabel(message),
  text: trigger.text,
  trigger: trigger.kind,
  replyToMessageId: message.reference?.messageId,
  createdAt: message.createdTimestamp,
  recent: target.history
    .recent(message.channelId, { excludeId: message.id })
    .map((entry) => ({
      id: entry.id,
      authorId: entry.authorId,
      author: entry.author,
      content: entry.content,
      fromBot: entry.fromBot,
      createdAt: entry.createdAt
    }))
});

/** 검색은 생성형 LLM 호출 전에 한 번만. 실패도 그대로 프롬프트에 알린다. */
const maybeSearch = async (
  needed: boolean,
  query: string
): Promise<{ hits: SearchHit[]; failed: boolean } | null> => {
  if (!needed || !mindConfig.search.enabled) return null;
  if (!chatConfig.exaApiKey) return { hits: [], failed: true };
  return searchBeforeReply({
    query,
    apiKey: chatConfig.exaApiKey,
    timeoutMs: mindConfig.search.timeoutMs
  });
};

/**
 * 한 턴의 전체 흐름. 판단은 Mind가 하고, 생성형 LLM은 마지막에 한 번만 부른다.
 */
const replyToTrigger = async (
  message: Message,
  trigger: Trigger,
  target: ChatDeps
): Promise<void> => {
  if (!message.channel.isSendable()) return;
  await message.channel.sendTyping().catch(() => undefined);

  const request = buildRequest(message, trigger, target);
  const context = target.mind.prepareContext(request);
  const decision = await target.mind.decide(context);
  const memoryResult = target.mind.commitExplicitMemory(context, decision);
  const web = await maybeSearch(decision.needsWeb, trigger.text);
  const frame = target.mind.compileFrame(context, decision, memoryResult);

  const instructions = await loadInstructions(chatConfig.agentsPath);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        instructions: instructions.text,
        frame,
        memories: frame.selectedMemories,
        memoryResult,
        web,
        memoryBudget: mindConfig.memory.charBudget
      })
    },
    ...buildConversation(
      target.history.recent(message.channelId, { excludeId: message.id }),
      { speaker: authorLabel(message), text: trigger.text }
    )
  ];

  const reply = await target.router.completeOnce(message.id, messages, {
    maxTokens: chatConfig.maxReplyTokens,
    timeoutMs: chatConfig.requestTimeoutMs
  });

  const sent = await message.reply({
    content: clamp(reply),
    allowedMentions: { repliedUser: true, parse: [] }
  });
  recordOwnMessage(target, sent);

  // 답변은 이미 나갔다. 사후 기록 실패로 답변을 되돌리지 않는다.
  try {
    target.mind.afterReply({
      context,
      decision,
      memoryResult,
      replyText: reply,
      sentMessageId: sent.id
    });
  } catch (error) {
    console.error("[mind] 사후 상태 기록 실패", error);
  }
};

export const initChat = async (client: Client<true>): Promise<void> => {
  const db = ensureMindSchema(ALLOWED_GUILD_ID);
  const root = ensureRootSchema();

  const mind = new MindEngine({
    guildId: ALLOWED_GUILD_ID,
    db,
    rootDb: root,
    apiKey: chatConfig.apiKey,
    config: mindConfig
  });

  if (mindConfig.memory.migration) {
    const migrated = await migrateLegacyMemory(
      mind.memories,
      db,
      ALLOWED_GUILD_ID,
      chatConfig.memoryPath
    ).catch((error) => {
      console.error("[mind] 기존 기억 이전 실패", error);
      return 0;
    });
    if (migrated > 0) console.log(`[mind] 기존 기억 ${migrated}개를 SQLite로 옮겼습니다.`);
  }

  const router = new OpenRouterClient(
    chatConfig.apiKey,
    chatConfig.model,
    chatConfig.baseUrl,
    chatConfig.reasoningEffort
  );

  deps = {
    botId: client.user.id,
    history: new ChannelHistory(chatConfig.historyLimit),
    router,
    mind,
    turns: new TurnGuard(mindConfig.turnMemory),
    queue: new KeyedSerialQueue()
  };

  console.log(`[key] ${chatConfig.keySource}`);
  console.log(`[model] ${router.currentModel} (effort ${router.reasoningEffort})`);
  console.log(`[mind] ${mindConfig.enabled ? "켜짐" : "꺼짐"} · ${mindConfig.decisionModel}`);
  console.log(
    `[mind] 하루 ${mindConfig.dailyBudget}회 / 분당 ${mindConfig.minuteBudget}회 자체 상한`
  );
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

export const chatMind = (): MindEngine | null => deps?.mind ?? null;

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

    // 같은 메시지를 두 번 처리하지 않는다. 실패하면 완료로 남기지 않는다.
    if (!target.turns.begin(message.id)) return false;
    try {
      await target.queue.run(message.author.id, () => replyToTrigger(message, trigger, target));
      target.turns.finish(message.id);
      return true;
    } catch (error) {
      target.turns.abort(message.id);
      throw error;
    }
  } catch (error) {
    // 같은 턴의 두 번째 생성 요청은 사용자에게 오류로 보이지 않게 조용히 넘긴다.
    if (error instanceof DuplicateTurnError) return false;
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
