import { GoogleGenAI } from "@google/genai";
import { config, type AiProvider } from "./config.js";

const OPENAI_COMPATIBLE_HISTORY_CHARS = 12_000;
const OPENAI_COMPATIBLE_MAX_TOKENS = 32_768;
const MISTRAL_HIGH_REASONING_MODELS = new Set(["mistral-small-latest", "mistral-medium-3-5"]);

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type MessageContentChunk = {
  type?: string;
  text?: string;
  thinking?: Array<{
    type?: string;
    text?: string;
  }>;
};

type MessageContent = string | MessageContentChunk[];

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string;
    index?: number;
    message?: {
      content?: MessageContent;
      reasoning_content?: string;
      role?: string;
    };
  }>;
};

type AskGeminiOptions = {
  onRetry?: (reason: { provider: AiProvider; label: string; model: string }) => void | Promise<void>;
};

export type QuestionAuthor = {
  displayName: string;
  username: string;
  userId: string;
};

export const askGemini = async (
  question: string,
  history: string,
  author?: QuestionAuthor,
  systemPrompt = config.questionPrompt,
  options: AskGeminiOptions = {}
) => {
  if (config.aiProvider === "gemini") return askGoogleGemini(buildPrompt(question, history, author, systemPrompt));
  return askOpenAiCompatible(config.aiProvider, question, history, author, systemPrompt, options);
};

export const buildDebugPromptText = (question: string, history: string, author?: QuestionAuthor, systemPrompt = config.questionPrompt) => {
  if (config.aiProvider === "gemini") return buildPrompt(question, history, author, systemPrompt);
  return JSON.stringify(buildOpenAiCompatibleMessages(question, history, author, systemPrompt), null, 2);
};

const buildPrompt = (question: string, history: string, author?: QuestionAuthor, systemPrompt = config.questionPrompt) => {
  return [
    systemPrompt,
    "",
    formatQuestionAuthor(author),
    "",
    `<질문>\n${question}\n</질문>`,
    "",
    `<최근_디스코드_기록>\n${history || "수집된 대화 기록이 없습니다."}\n</최근_디스코드_기록>`
  ].join("\n");
};

const buildOpenAiCompatibleMessages = (
  question: string,
  history: string,
  author?: QuestionAuthor,
  systemPrompt = config.questionPrompt
): ChatMessage[] => [
  {
    role: "system",
    content: systemPrompt
  },
  {
    role: "user",
    content: [
      formatQuestionAuthor(author),
      "",
      `<질문>\n${question}\n</질문>`,
      "",
      `<최근_디스코드_기록>\n${trimHistoryForOpenAiCompatible(history) || "수집된 대화 기록이 없습니다."}\n</최근_디스코드_기록>`
    ].join("\n")
  }
];

const formatQuestionAuthor = (author?: QuestionAuthor) => {
  if (!author) return "<질문자>알 수 없음</질문자>";
  return [
    "<질문자>",
    `displayName: ${author.displayName}`,
    `username: ${author.username}`,
    `userId: ${author.userId}`,
    "</질문자>"
  ].join("\n");
};

const trimHistoryForOpenAiCompatible = (history: string) => {
  if (history.length <= OPENAI_COMPATIBLE_HISTORY_CHARS) return history;
  return `${history.slice(0, OPENAI_COMPATIBLE_HISTORY_CHARS)}\n\n[이후 기록은 모델 출력 안정성을 위해 생략됨]`;
};

const askGoogleGemini = async (prompt: string) => {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY가 비어 있습니다. 웹 설정에서 API key를 저장해 주세요.");

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const response = await ai.models.generateContent({
    model: config.aiModel,
    contents: prompt,
    config: {
      temperature: 0.9,
      maxOutputTokens: 4096
    }
  });

  return response.text?.trim() || "Gemini가 빈 응답을 반환했습니다.";
};

const askOpenAiCompatible = async (
  provider: Exclude<AiProvider, "gemini">,
  question: string,
  history: string,
  author?: QuestionAuthor,
  systemPrompt = config.questionPrompt,
  options: AskGeminiOptions = {}
) => {
  const providerConfig = getOpenAiCompatibleConfig(provider);
  const model = config.aiModel;
  const reasoningEffort = getReasoningEffort(provider, model);
  const requestBody = {
    model,
    messages: buildOpenAiCompatibleMessages(question, history, author, systemPrompt),
    temperature: 0.2,
    max_tokens: OPENAI_COMPATIBLE_MAX_TOKENS,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(reasoningEffort ? {} : { include_reasoning: false })
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    console.log("OpenAI-compatible request prepared", {
      provider,
      label: providerConfig.label,
      model,
      attempt,
      maxTokens: OPENAI_COMPATIBLE_MAX_TOKENS,
      reasoningEffort: reasoningEffort ?? null,
      includeReasoning: reasoningEffort ? null : false
    });

    const response = await fetch(`${providerConfig.baseUrl.replace(/\/+$/g, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    const rawBody = await response.text().catch((error) => {
      console.error("OpenAI-compatible response read failed", {
        provider,
        label: providerConfig.label,
        model,
        attempt,
        status: response.status,
        error: error instanceof Error ? error.message : String(error)
      });
      return "";
    });

    console.log("OpenAI-compatible response received", {
      provider,
      label: providerConfig.label,
      model,
      attempt,
      status: response.status,
      ok: response.ok,
      bodyPreview: previewResponseBody(rawBody)
    });

    if (!response.ok) {
      throw new Error(`${providerConfig.label} API 오류: ${response.status} ${previewResponseBody(rawBody).slice(0, 500)}`.trim());
    }

    const data = JSON.parse(rawBody) as ChatCompletionResponse;
    console.log("OpenAI-compatible choices parsed", {
      provider,
      label: providerConfig.label,
      model,
      attempt,
      status: response.status,
      choices: summarizeChoices(data)
    });

    const text = extractMessageText(data.choices?.[0]?.message?.content).trim();
    if (text) return text;

    if (attempt === 1) {
      console.warn("OpenAI-compatible empty response, retrying once", {
        provider,
        label: providerConfig.label,
        model
      });
      await options.onRetry?.({ provider, label: providerConfig.label, model });
    }
  }

  return `${providerConfig.label}가 빈 응답을 반환했습니다.`;
};

const previewResponseBody = (body: string) => {
  if (!body) return "";
  return redactSensitiveText(body).slice(0, 1200);
};

const summarizeChoices = (data: ChatCompletionResponse) =>
  data.choices?.map((choice) => ({
    index: choice.index,
    finishReason: choice.finish_reason,
    messageRole: choice.message?.role,
    contentLength: extractMessageText(choice.message?.content).length,
    reasoningLength: choice.message?.reasoning_content?.length ?? 0,
    contentPreview: redactSensitiveText(extractMessageText(choice.message?.content)).slice(0, 200)
  })) ?? [];

const extractMessageText = (content?: MessageContent) => {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((chunk) => chunk.type !== "thinking")
    .map((chunk) => chunk.text ?? "")
    .join("");
};

const getReasoningEffort = (provider: Exclude<AiProvider, "gemini">, model: string) => {
  if (provider !== "bynara") return undefined;
  return MISTRAL_HIGH_REASONING_MODELS.has(model) ? "high" : undefined;
};

const redactSensitiveText = (value: string) =>
  value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-***")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "AIza***")
    .replace(/nvapi-[A-Za-z0-9_-]{12,}/g, "nvapi-***")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "***.***.***");

const getOpenAiCompatibleConfig = (provider: Exclude<AiProvider, "gemini">) => {
  if (provider === "opencode_zen") {
    if (!config.opencodeZenBaseUrl) throw new Error("OPENCODE_ZEN_BASE_URL이 비어 있습니다. 웹 설정에서 base URL을 저장해 주세요.");
    if (!config.opencodeZenApiKey) throw new Error("OPENCODE_ZEN_API_KEY가 비어 있습니다. 웹 설정에서 API key를 저장해 주세요.");
    return {
      label: "OpenCode Zen",
      apiKey: config.opencodeZenApiKey,
      baseUrl: config.opencodeZenBaseUrl
    };
  }

  if (provider === "openrouter") {
    if (!config.openrouterBaseUrl) throw new Error("OPENROUTER_BASE_URL이 비어 있습니다. 웹 설정에서 base URL을 저장해 주세요.");
    if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY가 비어 있습니다. 웹 설정에서 API key를 저장해 주세요.");
    return {
      label: "OpenRouter",
      apiKey: config.openrouterApiKey,
      baseUrl: config.openrouterBaseUrl
    };
  }

  if (provider === "bynara") {
    if (!config.bynaraBaseUrl) throw new Error("BYNARA_BASE_URL이 비어 있습니다. 웹 설정에서 base URL을 저장해 주세요.");
    if (!config.bynaraApiKey) throw new Error("BYNARA_API_KEY가 비어 있습니다. 웹 설정에서 API key를 저장해 주세요.");
    return {
      label: "Bynara Router",
      apiKey: config.bynaraApiKey,
      baseUrl: config.bynaraBaseUrl
    };
  }

  if (!config.nvidiaNimApiKey) throw new Error("NVIDIA_NIM_API_KEY가 비어 있습니다. 웹 설정에서 API key를 저장해 주세요.");
  return {
    label: "NVIDIA NIM",
    apiKey: config.nvidiaNimApiKey,
    baseUrl: config.nvidiaNimBaseUrl
  };
};
