import {
  config, getRuntimeSettings, updateRuntimeSettings, MAX_HISTORY_MESSAGE_LIMIT,
  type AiProvider, type RuntimeSettingsUpdate
} from "./config.js";
import { analysisCommandNames, buildPlaygroundRequest } from "./analysis.js";
import { collectHistory } from "./history.js";
import { askGemini } from "./gemini.js";
import { freeModelCatalog } from "./models.js";
import { all } from "./storage.js";
import type { Client } from "discord.js";
import { renderPlaygroundPage } from "./playground-page.js";
import { renderSettingsPage } from "./settings-page.js";

const providers = new Set<AiProvider>(["gemini", "opencode_zen", "nvidia_nim", "openrouter", "bynara"]);

export const startWebServer = (client: Client) => {
  const server = Bun.serve({
    hostname: config.webHost,
    port: config.webPort,
    routes: {
      "/": () => htmlResponse(renderSettingsPage()),
      "/playground": () => htmlResponse(renderPlaygroundPage()),
      "/api/settings": {
        GET: () => jsonResponse(publicSettings()),
        POST: async (request) => {
          const body = await request.json().catch(() => null);
          const next = await updateRuntimeSettings(parseSettingsUpdate(body));
          return jsonResponse(publicSettings(next));
        }
      },
      "/api/playground/servers": {
        GET: () => jsonResponse(publicServers(client))
      },
      "/api/playground/run": {
        POST: async (request) => {
          const body = await request.json().catch(() => null);
          try {
            return jsonResponse(await runPlayground(client, body));
          } catch (error) {
            const message = error instanceof Error ? error.message : "Playground 실행에 실패했습니다.";
            return jsonResponse({ error: message }, 400);
          }
        }
      }
    },
    fetch: () => new Response("Not found", { status: 404 })
  });
  console.log(`Settings UI listening on http://${server.hostname}:${server.port}`);
  return server;
};

const parseSettingsUpdate = (body: unknown): RuntimeSettingsUpdate => {
  if (!body || typeof body !== "object") throw new Error("Invalid settings payload");
  const input = body as Record<string, unknown>;
  const update: RuntimeSettingsUpdate = {};
  const strings = ["aiModel", "fallbackModel", "commonPrompt", "questionPrompt", "mbtiPrompt", "duelPrompt", "rankPrompt", "psychoPrompt",
    "nicknamePrompt", "throwbackPrompt", "summaryPrompt", "characterPrompt", "geminiApiKey", "opencodeZenApiKey",
    "opencodeZenBaseUrl", "nvidiaNimApiKey", "nvidiaNimBaseUrl", "openrouterApiKey", "openrouterBaseUrl",
    "bynaraApiKey", "bynaraBaseUrl"] as const;
  if (typeof input.aiProvider === "string" && providers.has(input.aiProvider as AiProvider)) update.aiProvider = input.aiProvider as AiProvider;
  if (typeof input.fallbackProvider === "string" && providers.has(input.fallbackProvider as AiProvider)) update.fallbackProvider = input.fallbackProvider as AiProvider;
  for (const key of strings) if (typeof input[key] === "string") update[key] = input[key] as never;
  if (typeof input.historyMessageLimit === "number") update.historyMessageLimit = input.historyMessageLimit;
  if (typeof input.maxContextChars === "number") update.maxContextChars = input.maxContextChars;
  if (typeof input.includeBotMessages === "boolean") update.includeBotMessages = input.includeBotMessages;
  return update;
};

const publicSettings = (settings = getRuntimeSettings()) => ({
  aiProvider: settings.aiProvider, aiModel: settings.aiModel, fallbackProvider: settings.fallbackProvider, fallbackModel: settings.fallbackModel,
  commonPrompt: settings.commonPrompt, questionPrompt: settings.questionPrompt,
  mbtiPrompt: settings.mbtiPrompt, duelPrompt: settings.duelPrompt, rankPrompt: settings.rankPrompt, psychoPrompt: settings.psychoPrompt,
  nicknamePrompt: settings.nicknamePrompt, throwbackPrompt: settings.throwbackPrompt, summaryPrompt: settings.summaryPrompt,
  characterPrompt: settings.characterPrompt, freeModels: freeModelCatalog, historyMessageLimit: settings.historyMessageLimit,
  maxContextChars: settings.maxContextChars, includeBotMessages: settings.includeBotMessages,
  opencodeZenBaseUrl: settings.opencodeZenBaseUrl, nvidiaNimBaseUrl: settings.nvidiaNimBaseUrl,
  openrouterBaseUrl: settings.openrouterBaseUrl, bynaraBaseUrl: settings.bynaraBaseUrl,
  hasGeminiApiKey: Boolean(settings.geminiApiKey), hasOpencodeZenApiKey: Boolean(settings.opencodeZenApiKey),
  hasNvidiaNimApiKey: Boolean(settings.nvidiaNimApiKey), hasOpenrouterApiKey: Boolean(settings.openrouterApiKey),
  hasBynaraApiKey: Boolean(settings.bynaraApiKey)
});

const publicServers = (client: Client) => [...client.guilds.cache.values()]
  .map((guild) => ({
    id: guild.id,
    name: guild.name,
    messageCount: all<{ n: number }>(guild.id, "SELECT COUNT(*) AS n FROM discord_messages")[0]?.n ?? 0
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const runPlayground = async (client: Client, body: unknown) => {
  if (!body || typeof body !== "object") throw new Error("잘못된 Playground 요청입니다.");
  const input = body as Record<string, unknown>;
  const guildId = typeof input.guildId === "string" ? input.guildId.trim() : "";
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error("접근 가능한 Discord 서버를 선택해 주세요.");

  const command = typeof input.command === "string" ? input.command : "";
  if (!analysisCommandNames.has(command)) throw new Error("채팅 분석 명령어만 테스트할 수 있어요.");

  const tests = parsePlaygroundTests(input.tests);
  const request = buildPlaygroundRequest({
    command,
    question: textValue(input.question),
    targetUser: textValue(input.targetUser),
    user1: textValue(input.user1),
    user2: textValue(input.user2)
  });
  const limit = typeof input.limit === "number"
    ? Math.min(Math.max(Math.trunc(input.limit), 1), MAX_HISTORY_MESSAGE_LIMIT)
    : config.historyMessageLimit;
  const history = await collectHistory(guild, limit, textValue(input.channels));
  if (history.messageCount === 0) throw new Error("선택한 서버에 저장된 채팅 기록이 없습니다.");

  const results = await Promise.all(tests.map(async (test) => {
    const startedAt = Date.now();
    try {
      const output = await askGemini(request.input, history.text, undefined, request.prompt, {
        provider: test.provider,
        model: test.model,
        allowFallback: false
      });
      return { ...test, ok: true, output, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ...test,
        ok: false,
        error: error instanceof Error ? error.message : "AI 호출에 실패했습니다.",
        elapsedMs: Date.now() - startedAt
      };
    }
  }));

  return {
    server: { id: guild.id, name: guild.name },
    command,
    history: { messageCount: history.messageCount, channelCount: history.channelCount, limit },
    results
  };
};

const parsePlaygroundTests = (value: unknown) => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error("비교할 모델을 2개 선택해 주세요.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("모델 설정이 올바르지 않습니다.");
    const input = item as Record<string, unknown>;
    const provider = typeof input.provider === "string" && providers.has(input.provider as AiProvider)
      ? input.provider as AiProvider
      : undefined;
    const model = typeof input.model === "string" ? input.model.trim() : "";
    if (!provider || !model || !freeModelCatalog[provider].some((candidate) => candidate.id === model)) {
      throw new Error("provider와 모델을 목록에서 선택해 주세요.");
    }
    return { provider, model };
  });
};

const textValue = (value: unknown) => typeof value === "string" ? value.trim() : undefined;

const htmlResponse = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
