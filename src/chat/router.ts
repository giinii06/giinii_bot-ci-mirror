export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelInfo = {
  id: string;
  name: string;
  contextLength: number;
  free: boolean;
  supportedEfforts: string[] | null;
};

export type CompletionOptions = {
  maxTokens: number;
  timeoutMs: number;
};

type WireMessage = {
  role: "system" | "user" | "assistant";
  content: string | null;
};

type CompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type RawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  reasoning?: { supported_efforts?: string[] | null };
};

type ModelListResponse = {
  data?: RawModel[];
};

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REASONING_EFFORT = "low";
const TURN_MEMORY = 500;

export class OpenRouterRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string
  ) {
    super(`OpenRouter ${status}: ${detail}`);
    this.name = "OpenRouterRequestError";
  }
}

/** 같은 턴에 두 번째 생성 요청이 들어왔을 때. 사용자에게 오류로 알리지 않는다. */
export class DuplicateTurnError extends Error {
  constructor(turnId: string) {
    super(`이미 생성 요청을 보낸 턴입니다: ${turnId}`);
    this.name = "DuplicateTurnError";
  }
}

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export const isReasoningEffort = (value: string) => REASONING_EFFORTS.includes(value);

const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/+$/, "")}${path}`;

const errorDetail = (body: string) => {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // 응답이 JSON이 아니면 본문을 그대로 줄여 쓴다.
  }
  return body.slice(0, 300).trim() || "알 수 없는 오류";
};

export const isFreeModel = (
  id: string,
  pricing?: { prompt?: string; completion?: string }
): boolean => {
  if (id.endsWith(":free")) return true;
  const prompt = pricing?.prompt;
  const completion = pricing?.completion;
  return (
    prompt !== undefined &&
    completion !== undefined &&
    Number(prompt) === 0 &&
    Number(completion) === 0
  );
};

/**
 * 대화 생성 전용 클라이언트. Decision 모델은 여기로 호출하지 않는다.
 * 생성 요청은 턴당 한 번만 나가야 하므로 completeOnce만 공개한다.
 */
export class OpenRouterClient {
  private model: string;
  private effort: string;
  private models: ModelInfo[] | null = null;
  private readonly startedTurns = new Set<string>();
  private readonly turnOrder: string[] = [];

  constructor(
    private readonly apiKey: string,
    defaultModel: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    effort: string = DEFAULT_REASONING_EFFORT
  ) {
    this.model = defaultModel;
    this.effort = effort;
  }

  get currentModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  get reasoningEffort(): string {
    return this.effort;
  }

  setReasoningEffort(effort: string): void {
    this.effort = effort;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "GinyBot"
    };
  }

  /**
   * 같은 turnId로는 HTTP 요청을 두 번 보내지 않는다.
   * 실패한 턴도 다시 시도하지 않는다. 재호출은 곧 무료 한도와 지연의 낭비다.
   */
  async completeOnce(
    turnId: string,
    messages: ChatMessage[],
    options: CompletionOptions
  ): Promise<string> {
    if (!this.claimTurn(turnId)) {
      throw new DuplicateTurnError(turnId);
    }

    const response = await fetch(endpoint(this.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages: messages satisfies WireMessage[],
        max_tokens: options.maxTokens,
        reasoning: { effort: this.effort }
      }),
      signal: AbortSignal.timeout(options.timeoutMs)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new OpenRouterRequestError(response.status, errorDetail(body));
    }

    const payload = (await response.json()) as CompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) throw new Error(`모델이 빈 응답을 보냈습니다 (${this.model})`);
    return text;
  }

  private claimTurn(turnId: string): boolean {
    if (this.startedTurns.has(turnId)) return false;
    this.startedTurns.add(turnId);
    this.turnOrder.push(turnId);
    while (this.turnOrder.length > TURN_MEMORY) {
      const oldest = this.turnOrder.shift();
      if (oldest) this.startedTurns.delete(oldest);
    }
    return true;
  }

  async listModels(force = false): Promise<ModelInfo[]> {
    if (this.models && !force) return this.models;

    const response = await fetch(endpoint(this.baseUrl, "/models"), { headers: this.headers() });
    if (!response.ok) {
      const body = await response.text();
      throw new OpenRouterRequestError(response.status, errorDetail(body));
    }

    const payload = (await response.json()) as ModelListResponse;
    this.models = (payload.data ?? [])
      .flatMap((model) => {
        if (typeof model.id !== "string" || !model.id) return [];
        return [
          {
            id: model.id,
            name: model.name ?? model.id,
            contextLength: model.context_length ?? 0,
            free: isFreeModel(model.id, model.pricing),
            supportedEfforts: model.reasoning?.supported_efforts ?? null
          }
        ];
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    return this.models;
  }
}
