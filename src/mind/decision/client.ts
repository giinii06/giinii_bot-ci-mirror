import type { DecisionResponse, QuestionMap } from "./questions.js";

export class DecisionRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string
  ) {
    super(`Decision ${status}: ${detail}`);
    this.name = "DecisionRequestError";
  }
}

export type DecisionRequest = {
  turnId: string;
  kind: "primary" | "refine";
  state: string;
  questions: QuestionMap;
  model?: string;
  timeoutMs?: number;
};

/** 테스트와 교체 가능한 Decision 호출 경계. */
export type DecisionTransport = {
  ask(request: DecisionRequest): Promise<DecisionResponse>;
};

const errorDetail = (body: string) => {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // JSON이 아니면 본문을 그대로 줄여 쓴다.
  }
  return body.slice(0, 300).trim() || "알 수 없는 오류";
};

export const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === "TimeoutError" || error.name === "AbortError");

/**
 * Decisions API 전용 클라이언트.
 * /chat/completions와 호환되지 않으므로 대화 생성 클라이언트와 분리한다.
 */
export class DecisionClient {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly defaultModel: string
  ) {}

  async ask(request: DecisionRequest): Promise<DecisionResponse> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "GinyBot"
      },
      body: JSON.stringify({
        model: request.model ?? this.defaultModel,
        state: request.state,
        questions: request.questions
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 1500)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new DecisionRequestError(response.status, errorDetail(body));
    }

    const payload = (await response.json()) as DecisionResponse;
    if (!payload.answers || typeof payload.answers !== "object") {
      throw new DecisionRequestError(200, "answers가 비어 있습니다");
    }
    return payload;
  }
}
