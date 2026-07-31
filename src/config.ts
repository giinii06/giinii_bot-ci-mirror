import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getFreeModels, isFreeModelForProvider } from "./models.js";

export type AiProvider = "gemini" | "opencode_zen" | "nvidia_nim" | "openrouter" | "bynara";

export type RuntimeSettings = {
  aiProvider: AiProvider;
  aiModel: string;
  commonPrompt: string;
  questionPrompt: string;
  mbtiPrompt: string;
  duelPrompt: string;
  rankPrompt: string;
  psychoPrompt: string;
  nicknamePrompt: string;
  throwbackPrompt: string;
  summaryPrompt: string;
  characterPrompt: string;
  historyMessageLimit: number;
  maxContextChars: number;
  includeBotMessages: boolean;
  geminiApiKey: string;
  opencodeZenApiKey: string;
  opencodeZenBaseUrl: string;
  nvidiaNimApiKey: string;
  nvidiaNimBaseUrl: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  bynaraApiKey: string;
  bynaraBaseUrl: string;
};

export type RuntimeSettingsUpdate = Partial<RuntimeSettings>;

const toInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
};

const toProvider = (value: string | undefined): AiProvider => {
  if (value === "opencode_zen" || value === "nvidia_nim" || value === "openrouter" || value === "bynara") return value;
  return "gemini";
};

const defaultModelForProvider = (provider: AiProvider) => getFreeModels(provider)[0]?.id ?? "gemini-2.5-flash";

export const defaultCommonPrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 근거로 답하는 한국어 어시스턴트다.",
  "대화 기록은 채널별로 묶여 있으며, 각 채널 안에서는 오래된 메시지부터 최신 메시지 순서로 나온다.",
  "기록에 없는 사실, 성격, 사건, 사생활은 만들지 마라. 근거가 부족하면 부족하다고 밝혀라.",
  "답변은 Discord Markdown으로 작성하되 표는 쓰지 마라.",
  "한국어로만 답하고, 서버 안 대화 분위기에 맞춰 재미있지만 과하게 공격적이지 않게 말해라."
].join("\n");

export const defaultQuestionPrompt = [
  "먼저 결론을 1~2줄로 말하고, 그다음 짧은 근거 목록을 붙여라.",
  "한국어 500~800자 정도로 간결하게 답해라."
].join("\n");

export const defaultMbtiPrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 근거로 유저의 MBTI를 논리적으로 추정하는 한국어 분석가다.",
  "대상 유저의 말투, 의사결정 방식, 감정 표현, 농담 방식, 대화 주도성만 근거로 삼아라.",
  "MBTI 하나를 결론으로 제시하고 확신도와 짧은 근거 목록을 붙여라.",
  "한국어 500~800자 정도로 간결하게 답해라."
].join("\n");

export const defaultDuelPrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 근거로 두 유저가 말로 결투하면 누가 이길지 예측하는 한국어 해설가다.",
  "욕설이나 실제 괴롭힘을 부추기지 말고, 말싸움/토론/드립 배틀 관점의 오락용 분석으로만 답해라.",
  "두 사람의 말투, 반박력, 순발력, 집요함, 분위기 장악력을 근거로 비교해라.",
  "승자를 한 명 고르고 승리 확률을 1~99% 사이에서 제시하되, 근거가 약하면 낮은 확신으로 표현해라.",
  "한국어 500~800자 정도로 간결하게 답해라."
].join("\n");

export const defaultRankPrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 근거로 유저들 간 관계와 영향력을 오락용 계급도로 분석하는 한국어 해설가다.",
  "신, 왕, 귀족, 하인, 불가촉 천민 계급을 모두 사용해 주요 유저들을 지명해라.",
  "보호 특성, 현실 신분, 혐오 표현이 아니라 서버 안 대화 분위기와 밈적 역할만 근거로 삼아라.",
  "각 계급마다 왜 그렇게 배치했는지 짧은 근거를 붙이고, 근거가 부족한 유저는 무리하게 단정하지 마라.",
  "한국어 700~1000자 정도로 간결하게 답해라."
].join("\n");

export const defaultPsychoPrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 근거로 유저의 싸이코 지수를 오락용으로 측정하는 한국어 분석가다.",
  "실제 정신질환, 사이코패스 진단, 범죄 성향 판정으로 말하지 말고 장난스러운 혼돈/광기/예측불가 지수로 다뤄라.",
  "대상 유저의 농담, 급발진, 맥락 전환, 집착 포인트, 드립 강도를 근거로 1~100점 중 하나를 다양하게 부여해라.",
  "50점 근처로 뭉개지 말고 근거가 있으면 과감하게 점수를 벌려라. 근거가 부족하면 부족하다고 밝혀라.",
  "한국어 500~800자 정도로 간결하게 답해라."
].join("\n");

export const defaultNicknamePrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 근거로 유저에게 서버 밈이 될 만한 별명을 지어주는 작명가다.",
  "대상 유저의 말투, 자주 하는 반응, 드립 패턴, 서버 안 포지션을 근거로 별명 3~5개를 제안해라.",
  "각 별명마다 왜 어울리는지 짧은 근거를 붙여라.",
  "실명, 외모, 민감한 개인정보, 보호 특성은 별명 소재로 쓰지 마라."
].join("\n");

export const defaultThrowbackPrompt = [
  "너는 디스코드 서버의 최근 대화 기록에서 대상 유저의 장난스러운 흑역사 포인트를 찾아주는 예능 작가다.",
  "실제 망신주기나 괴롭힘이 아니라 말버릇, 급발진, 드립 실패, 과몰입, 반복 패턴 위주로 가볍게 다뤄라.",
  "근거가 되는 대화 패턴을 짧게 설명하고, 마지막에 오락용 판결처럼 마무리해라.",
  "모욕, 혐오, 사생활 추측, 실제 정신건강 진단은 하지 마라."
].join("\n");

export const defaultSummaryPrompt = [
  "너는 디스코드 서버의 최근 분위기를 재밌게 요약하는 기록 담당자다.",
  "최근 대화의 주요 사건, 많이 등장한 주제, 분위기, 눈에 띄는 유저 움직임을 요약해라.",
  "마지막에 오늘의 한줄평과 서버 MVP 후보를 장난스럽게 붙여라.",
  "근거가 약한 유저는 무리해서 지목하지 마라."
].join("\n");

export const defaultCharacterPrompt = [
  "너는 디스코드 서버의 최근 대화 기록을 바탕으로 대상 유저의 RPG 캐릭터 시트를 만드는 게임 디자이너다.",
  "직업, 성향, 패시브, 궁극기, 약점, 추천 장비, 플레이 스타일을 만들어라.",
  "각 항목은 대상 유저의 실제 대화 패턴에서 보이는 근거를 바탕으로 오락용으로만 작성해라.",
  "현실의 신분, 외모, 민감한 개인정보, 보호 특성은 캐릭터 설정에 넣지 마라."
].join("\n");

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const databasePath = process.env.DATABASE_PATH?.trim() || "./data/bot.sqlite";
export const rouletteAudioPaths = [
  process.env.VOICE_AUDIO_PATH?.trim() || "./audio/roulette.ogg",
  "./audio/roulette-2.ogg",
  "./audio/roulette-3.ogg"
];
export const MAX_HISTORY_MESSAGE_LIMIT = 10_000;
const envPath = resolve(process.cwd(), ".env");

const settings: RuntimeSettings = {
  aiProvider: toProvider(process.env.AI_PROVIDER),
  aiModel: process.env.AI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || "",
  commonPrompt: process.env.COMMON_PROMPT?.trim() || defaultCommonPrompt,
  questionPrompt: process.env.QUESTION_PROMPT?.trim() || defaultQuestionPrompt,
  mbtiPrompt: process.env.MBTI_PROMPT?.trim() || defaultMbtiPrompt,
  duelPrompt: process.env.DUEL_PROMPT?.trim() || defaultDuelPrompt,
  rankPrompt: process.env.RANK_PROMPT?.trim() || defaultRankPrompt,
  psychoPrompt: process.env.PSYCHO_PROMPT?.trim() || defaultPsychoPrompt,
  nicknamePrompt: process.env.NICKNAME_PROMPT?.trim() || defaultNicknamePrompt,
  throwbackPrompt: process.env.THROWBACK_PROMPT?.trim() || defaultThrowbackPrompt,
  summaryPrompt: process.env.SUMMARY_PROMPT?.trim() || defaultSummaryPrompt,
  characterPrompt: process.env.CHARACTER_PROMPT?.trim() || defaultCharacterPrompt,
  historyMessageLimit: toInt(process.env.HISTORY_MESSAGE_LIMIT, MAX_HISTORY_MESSAGE_LIMIT, 1, MAX_HISTORY_MESSAGE_LIMIT),
  maxContextChars: toInt(process.env.MAX_CONTEXT_CHARS, 160_000, 10_000, 1_000_000),
  includeBotMessages: toBool(process.env.INCLUDE_BOT_MESSAGES, false),
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
  opencodeZenApiKey: process.env.OPENCODE_ZEN_API_KEY?.trim() || "",
  opencodeZenBaseUrl: process.env.OPENCODE_ZEN_BASE_URL?.trim() || "https://opencode.ai/zen/v1",
  nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY?.trim() || "",
  nvidiaNimBaseUrl: process.env.NVIDIA_NIM_BASE_URL?.trim() || "https://integrate.api.nvidia.com/v1",
  openrouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || "",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
  bynaraApiKey: process.env.BYNARA_API_KEY?.trim() || "",
  bynaraBaseUrl: process.env.BYNARA_BASE_URL?.trim() || "https://router.bynara.id/v1"
};

if (!isFreeModelForProvider(settings.aiProvider, settings.aiModel)) {
  settings.aiModel = defaultModelForProvider(settings.aiProvider);
}

export const config = {
  discordToken: required(process.env.DISCORD_BOT_TOKEN?.trim() ? "DISCORD_BOT_TOKEN" : "DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  cooldownSeconds: toInt(process.env.QUESTION_COOLDOWN_SECONDS, 20, 0, 3600),
  webHost: process.env.WEB_HOST?.trim() || "0.0.0.0",
  webPort: toInt(process.env.WEB_PORT, 3003, 1, 65535),
  get aiProvider() { return settings.aiProvider; },
  get aiModel() { return settings.aiModel; },
  get geminiModel() { return settings.aiModel; },
  get commonPrompt() { return settings.commonPrompt; },
  get questionPrompt() { return settings.questionPrompt; },
  get mbtiPrompt() { return settings.mbtiPrompt; },
  get duelPrompt() { return settings.duelPrompt; },
  get rankPrompt() { return settings.rankPrompt; },
  get psychoPrompt() { return settings.psychoPrompt; },
  get nicknamePrompt() { return settings.nicknamePrompt; },
  get throwbackPrompt() { return settings.throwbackPrompt; },
  get summaryPrompt() { return settings.summaryPrompt; },
  get characterPrompt() { return settings.characterPrompt; },
  get historyMessageLimit() { return settings.historyMessageLimit; },
  get maxContextChars() { return settings.maxContextChars; },
  get includeBotMessages() { return settings.includeBotMessages; },
  get geminiApiKey() { return settings.geminiApiKey; },
  get opencodeZenApiKey() { return settings.opencodeZenApiKey; },
  get opencodeZenBaseUrl() { return settings.opencodeZenBaseUrl; },
  get nvidiaNimApiKey() { return settings.nvidiaNimApiKey; },
  get nvidiaNimBaseUrl() { return settings.nvidiaNimBaseUrl; },
  get openrouterApiKey() { return settings.openrouterApiKey; },
  get openrouterBaseUrl() { return settings.openrouterBaseUrl; },
  get bynaraApiKey() { return settings.bynaraApiKey; },
  get bynaraBaseUrl() { return settings.bynaraBaseUrl; }
};

export const getRuntimeSettings = () => ({ ...settings });

export const updateRuntimeSettings = async (update: RuntimeSettingsUpdate) => {
  if (update.aiProvider) settings.aiProvider = update.aiProvider;
  if (typeof update.aiModel === "string" && update.aiModel.trim()) settings.aiModel = update.aiModel.trim();
  if (!isFreeModelForProvider(settings.aiProvider, settings.aiModel)) settings.aiModel = defaultModelForProvider(settings.aiProvider);

  const prompts = [
    ["commonPrompt", defaultCommonPrompt], ["questionPrompt", defaultQuestionPrompt], ["mbtiPrompt", defaultMbtiPrompt],
    ["duelPrompt", defaultDuelPrompt], ["rankPrompt", defaultRankPrompt], ["psychoPrompt", defaultPsychoPrompt],
    ["nicknamePrompt", defaultNicknamePrompt], ["throwbackPrompt", defaultThrowbackPrompt],
    ["summaryPrompt", defaultSummaryPrompt], ["characterPrompt", defaultCharacterPrompt]
  ] as const;
  for (const [key, fallback] of prompts) {
    const value = update[key];
    if (typeof value === "string") settings[key] = value.trim() || fallback;
  }
  if (typeof update.historyMessageLimit === "number") settings.historyMessageLimit = Math.min(Math.max(Math.trunc(update.historyMessageLimit), 1), MAX_HISTORY_MESSAGE_LIMIT);
  if (typeof update.maxContextChars === "number") settings.maxContextChars = Math.min(Math.max(Math.trunc(update.maxContextChars), 10_000), 1_000_000);
  if (typeof update.includeBotMessages === "boolean") settings.includeBotMessages = update.includeBotMessages;

  const strings = [
    ["geminiApiKey", true], ["opencodeZenApiKey", true], ["opencodeZenBaseUrl", false],
    ["nvidiaNimApiKey", true], ["nvidiaNimBaseUrl", true], ["openrouterApiKey", true],
    ["openrouterBaseUrl", true], ["bynaraApiKey", true], ["bynaraBaseUrl", true]
  ] as const;
  for (const [key, keepWhenEmpty] of strings) {
    const value = update[key];
    if (typeof value === "string" && (value.trim() || !keepWhenEmpty)) settings[key] = value.trim();
  }

  await saveEnvSettings();
  return getRuntimeSettings();
};

const saveEnvSettings = async () => {
  const values = new Map([
    ["AI_PROVIDER", settings.aiProvider], ["AI_MODEL", settings.aiModel], ["GEMINI_MODEL", settings.aiModel],
    ["COMMON_PROMPT", settings.commonPrompt], ["QUESTION_PROMPT", settings.questionPrompt], ["MBTI_PROMPT", settings.mbtiPrompt],
    ["DUEL_PROMPT", settings.duelPrompt], ["RANK_PROMPT", settings.rankPrompt], ["PSYCHO_PROMPT", settings.psychoPrompt],
    ["NICKNAME_PROMPT", settings.nicknamePrompt], ["THROWBACK_PROMPT", settings.throwbackPrompt], ["SUMMARY_PROMPT", settings.summaryPrompt],
    ["CHARACTER_PROMPT", settings.characterPrompt], ["HISTORY_MESSAGE_LIMIT", String(settings.historyMessageLimit)],
    ["MAX_CONTEXT_CHARS", String(settings.maxContextChars)], ["INCLUDE_BOT_MESSAGES", String(settings.includeBotMessages)],
    ["GEMINI_API_KEY", settings.geminiApiKey], ["OPENCODE_ZEN_API_KEY", settings.opencodeZenApiKey],
    ["OPENCODE_ZEN_BASE_URL", settings.opencodeZenBaseUrl], ["NVIDIA_NIM_API_KEY", settings.nvidiaNimApiKey],
    ["NVIDIA_NIM_BASE_URL", settings.nvidiaNimBaseUrl], ["OPENROUTER_API_KEY", settings.openrouterApiKey],
    ["OPENROUTER_BASE_URL", settings.openrouterBaseUrl], ["BYNARA_API_KEY", settings.bynaraApiKey],
    ["BYNARA_BASE_URL", settings.bynaraBaseUrl], ["WEB_HOST", config.webHost], ["WEB_PORT", String(config.webPort)]
  ]);
  let content = "";
  try { content = await readFile(envPath, "utf8"); } catch { /* .env is created on first save */ }
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match?.[1]) return line;
    const value = values.get(match[1]);
    if (value == null) return line;
    seen.add(match[1]);
    return `${match[1]}=${escapeEnvValue(value)}`;
  });
  for (const [key, value] of values) if (!seen.has(key)) lines.push(`${key}=${escapeEnvValue(value)}`);
  await writeFile(envPath, `${lines.join("\n").replace(/\n+$/g, "")}\n`);
};

const escapeEnvValue = (value: string) => {
  if (!value || /^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return JSON.stringify(value);
};
