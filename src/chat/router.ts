export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelInfo = {
  id: string;
  name: string;
  contextLength: number;
  free: boolean;
  supportedEfforts: string[] | null;
};

type CompletionOptions = {
  maxTokens: number;
  timeoutMs: number;
};

type WireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type AssistantReply = {
  content: string | null;
  tool_calls?: ToolCall[];
};

type CompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
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
const DEFAULT_REASONING_EFFORT = "high";
const MAX_TOOL_STEPS = 3;

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

const readToolCalls = (value: unknown): ToolCall[] => {
  if (!Array.isArray(value)) return [];

  const calls: ToolCall[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const fn = candidate.function;
    if (typeof candidate.id !== "string" || !fn || typeof fn.name !== "string") continue;
    calls.push({
      id: candidate.id,
      type: "function",
      function: {
        name: fn.name,
        arguments: typeof fn.arguments === "string" ? fn.arguments : "{}"
      }
    });
  }
  return calls;
};

export class OpenRouterClient {
  private model: string;
  private effort: string;
  private models: ModelInfo[] | null = null;

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

  private async request(
    messages: WireMessage[],
    options: CompletionOptions,
    tools?: ToolDefinition[]
  ): Promise<AssistantReply> {
    const response = await fetch(endpoint(this.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: options.maxTokens,
        reasoning: { effort: this.effort },
        ...(tools && tools.length > 0 ? { tools } : {})
      }),
      signal: AbortSignal.timeout(options.timeoutMs)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errorDetail(body)}`);
    }

    const payload = (await response.json()) as CompletionResponse;
    const message = payload.choices?.[0]?.message;
    const toolCalls = readToolCalls(message?.tool_calls);

    return {
      content: typeof message?.content === "string" ? message.content : null,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }

  private requireText(reply: AssistantReply): string {
    const content = reply.content?.trim() ?? "";
    if (!content) throw new Error(`모델이 빈 응답을 보냈습니다 (${this.model})`);
    return content;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions): Promise<string> {
    return this.requireText(await this.request(messages, options));
  }

  async completeWithTools(
    messages: ChatMessage[],
    options: CompletionOptions,
    tools: ToolDefinition[],
    runTool: (call: ToolCall) => Promise<string>
  ): Promise<string> {
    const working: WireMessage[] = [...messages];

    for (let step = 0; step <= MAX_TOOL_STEPS; step += 1) {
      const reply = await this.request(working, options, tools);
      if (!reply.tool_calls) return this.requireText(reply);
      if (step === MAX_TOOL_STEPS) break;

      working.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });

      const results = await Promise.all(
        reply.tool_calls.map(async (call) => ({
          role: "tool" as const,
          tool_call_id: call.id,
          content: await runTool(call)
        }))
      );
      working.push(...results);
    }

    throw new Error("툴 호출 횟수를 초과했습니다");
  }

  async listModels(force = false): Promise<ModelInfo[]> {
    if (this.models && !force) return this.models;

    const response = await fetch(endpoint(this.baseUrl, "/models"), { headers: this.headers() });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errorDetail(body)}`);
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
