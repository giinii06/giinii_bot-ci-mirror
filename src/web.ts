import {
  config, getRuntimeSettings, updateRuntimeSettings, type AiProvider, type RuntimeSettingsUpdate
} from "./config.js";
import { freeModelCatalog } from "./models.js";
import { renderSettingsPage } from "./settings-page.js";

const providers = new Set<AiProvider>(["gemini", "opencode_zen", "nvidia_nim", "openrouter", "bynara"]);

export const startWebServer = () => {
  const server = Bun.serve({
    hostname: config.webHost,
    port: config.webPort,
    routes: {
      "/": () => htmlResponse(renderSettingsPage()),
      "/api/settings": {
        GET: () => jsonResponse(publicSettings()),
        POST: async (request) => {
          const body = await request.json().catch(() => null);
          const next = await updateRuntimeSettings(parseSettingsUpdate(body));
          return jsonResponse(publicSettings(next));
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
  const strings = ["aiModel", "commonPrompt", "questionPrompt", "mbtiPrompt", "duelPrompt", "rankPrompt", "psychoPrompt",
    "nicknamePrompt", "throwbackPrompt", "summaryPrompt", "characterPrompt", "geminiApiKey", "opencodeZenApiKey",
    "opencodeZenBaseUrl", "nvidiaNimApiKey", "nvidiaNimBaseUrl", "openrouterApiKey", "openrouterBaseUrl",
    "bynaraApiKey", "bynaraBaseUrl"] as const;
  if (typeof input.aiProvider === "string" && providers.has(input.aiProvider as AiProvider)) update.aiProvider = input.aiProvider as AiProvider;
  for (const key of strings) if (typeof input[key] === "string") update[key] = input[key] as never;
  if (typeof input.historyMessageLimit === "number") update.historyMessageLimit = input.historyMessageLimit;
  if (typeof input.maxContextChars === "number") update.maxContextChars = input.maxContextChars;
  if (typeof input.includeBotMessages === "boolean") update.includeBotMessages = input.includeBotMessages;
  return update;
};

const publicSettings = (settings = getRuntimeSettings()) => ({
  aiProvider: settings.aiProvider, aiModel: settings.aiModel, commonPrompt: settings.commonPrompt, questionPrompt: settings.questionPrompt,
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

const htmlResponse = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const jsonResponse = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
