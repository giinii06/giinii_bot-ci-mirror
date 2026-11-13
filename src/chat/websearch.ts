import type { ToolCall, ToolDefinition } from "./router.js";

const EXA_ENDPOINT = "https://api.exa.ai/search";
const MAX_RESULTS = 3;
const MAX_QUERY_CHARS = 400;
const MAX_SNIPPET_CHARS = 400;
const MAX_SEARCHES_PER_TURN = 2;
const SEARCH_TIMEOUT_MS = 15_000;

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current information, news, prices, releases, or facts you are unsure about. Returns up to 3 results with title, URL, and a short excerpt.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query. Write it in the language of the user's question."
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
};

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

type ExaResult = {
  title?: unknown;
  url?: unknown;
  highlights?: unknown;
  text?: unknown;
};

type ExaResponse = {
  results?: ExaResult[];
};

const excerpt = (result: ExaResult): string => {
  const highlights = Array.isArray(result.highlights)
    ? result.highlights.filter((value): value is string => typeof value === "string").join(" ")
    : "";
  const text = typeof result.text === "string" ? result.text : "";
  return (highlights || text).replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS);
};

export const searchWeb = async (query: string, apiKey: string): Promise<SearchHit[]> => {
  const response = await fetch(EXA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      query: query.slice(0, MAX_QUERY_CHARS),
      type: "auto",
      numResults: MAX_RESULTS,
      contents: { highlights: { maxCharacters: MAX_SNIPPET_CHARS } }
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Exa ${response.status}: ${body.slice(0, 200).trim() || response.statusText}`);
  }

  const payload = (await response.json()) as ExaResponse;
  return (payload.results ?? []).flatMap((result) => {
    if (typeof result.url !== "string" || !result.url) return [];
    return [
      {
        title: typeof result.title === "string" && result.title ? result.title : result.url,
        url: result.url,
        snippet: excerpt(result)
      }
    ];
  });
};

export const createWebSearchTool = (
  apiKey: string
): { definition: ToolDefinition; run: (call: ToolCall) => Promise<string> } => {
  let remaining = MAX_SEARCHES_PER_TURN;

  return {
    definition: WEB_SEARCH_TOOL,
    async run(call) {
      if (call.function.name !== "web_search") return JSON.stringify({ error: "unknown tool" });
      if (remaining <= 0) {
        return JSON.stringify({ error: "search limit reached for this turn" });
      }

      let query: unknown;
      try {
        query = (JSON.parse(call.function.arguments) as { query?: unknown }).query;
      } catch {
        return JSON.stringify({ error: "invalid arguments" });
      }
      if (typeof query !== "string" || !query.trim()) return JSON.stringify({ error: "empty query" });

      remaining -= 1;
      try {
        return JSON.stringify({ results: await searchWeb(query.trim(), apiKey) });
      } catch (error) {
        console.error("[search]", error instanceof Error ? error.message : error);
        return JSON.stringify({ error: "search failed" });
      }
    }
  };
};
