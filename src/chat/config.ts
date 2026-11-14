import { dirname, join } from "node:path";
import { databasePath } from "../config.js";

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

const readEnv = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

/**
 * giinii_chat에서 옮긴 대화 기능의 설정.
 * 봇 토큰은 giinii_bot의 DISCORD_TOKEN/DISCORD_BOT_TOKEN을 그대로 쓰고,
 * 모델 호출은 giinii_chat에서 가져와 giinii_bot .env에 넣은 CHAT_OPENROUTER_API_KEY를 쓴다.
 */
const explicitKey = readEnv("CHAT_OPENROUTER_API_KEY");
const fallbackKey = readEnv("OPENROUTER_API_KEY");
const apiKey = explicitKey ?? fallbackKey ?? "";
const keySource = explicitKey
  ? "CHAT_OPENROUTER_API_KEY"
  : fallbackKey
    ? "OPENROUTER_API_KEY"
    : "없음";

export const chatConfig = {
  apiKey,
  keySource,
  baseUrl: readEnv("OPENROUTER_BASE_URL") ?? DEFAULT_BASE_URL,
  model: readEnv("OPENROUTER_MODEL") ?? DEFAULT_MODEL,
  reasoningEffort: readEnv("REASONING_EFFORT") ?? "low",
  exaApiKey: readEnv("EXA_API_KEY"),
  agentsPath: readEnv("AGENTS_PATH") ?? "SOUL.md",
  memoryPath: readEnv("MEMORY_PATH") ?? join(dirname(databasePath), "memory.md"),
  prefix: "기니봇아",
  historyLimit: 10,
  maxReplyTokens: 800,
  requestTimeoutMs: 120_000
} as const;

export const isChatEnabled = () => chatConfig.apiKey.length > 0;
