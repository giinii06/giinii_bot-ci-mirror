import type { SearchHit } from "../mind/types.js";

const EXA_ENDPOINT = "https://api.exa.ai/search";
const MAX_RESULTS = 3;
const MAX_QUERY_CHARS = 400;
const MAX_SNIPPET_CHARS = 400;

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

export const searchWeb = async (
  query: string,
  apiKey: string,
  timeoutMs = 15_000
): Promise<SearchHit[]> => {
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
    signal: AbortSignal.timeout(timeoutMs)
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

/**
 * 생성형 LLM 호출 이전에 한 번만 검색한다.
 * 실패를 숨기지 않고 그대로 돌려줘서, 프롬프트가 "검색한 척"하지 않게 한다.
 */
export const searchBeforeReply = async (input: {
  query: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<{ hits: SearchHit[]; failed: boolean }> => {
  try {
    return { hits: await searchWeb(input.query, input.apiKey, input.timeoutMs), failed: false };
  } catch (error) {
    console.error("[search]", error instanceof Error ? error.message : error);
    return { hits: [], failed: true };
  }
};
