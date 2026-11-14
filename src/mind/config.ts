const readEnv = (name: string) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const toBool = (name: string, fallback: boolean): boolean => {
  const value = readEnv(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
};

const toNumber = (name: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseFloat(readEnv(name) ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

/**
 * Giinii Mind 설정. 대화 생성 모델(chatConfig)과 완전히 분리한다.
 * Decision 모델은 /chat/completions가 아니라 /api/alpha/decisions 로 호출한다.
 */
export const mindConfig = {
  enabled: toBool("MIND_ENABLED", true),
  decisionModel: readEnv("MIND_DECISION_MODEL") ?? "perplexity/pplx-decider-v1.3:free",
  decisionFlashModel:
    readEnv("MIND_DECISION_FLASH_MODEL") ?? "perplexity/pplx-decider-flash-v1.3:free",
  decisionApiUrl: readEnv("MIND_DECISION_API_URL") ?? "https://openrouter.ai/api/alpha/decisions",

  /** 기본 1회, 조건부 정밀 판단까지 2회. */
  maxDecisionsPerTrigger: Math.round(toNumber("MIND_MAX_DECISIONS_PER_TRIGGER", 2, 1, 2)),
  adaptiveRefinement: toBool("MIND_ADAPTIVE_REFINEMENT", true),

  /** 계정 전체 무료 한도(1000/일, 20/분)보다 낮게 잡은 자체 상한. */
  dailyBudget: Math.round(toNumber("MIND_DAILY_BUDGET", 900, 0, 1000)),
  minuteBudget: Math.round(toNumber("MIND_MINUTE_BUDGET", 18, 1, 20)),

  /** 실측 0.5~1.8초. 1.5초로 두면 정상 응답도 폴백으로 떨어져 3초로 잡는다. */
  decisionTimeoutMs: Math.round(toNumber("MIND_DECISION_TIMEOUT_MS", 3000, 200, 10_000)),
  refineTimeoutMs: Math.round(toNumber("MIND_REFINE_TIMEOUT_MS", 2500, 200, 10_000)),

  /** 정밀 판단을 부를 조건. */
  refineConfidenceFloor: toNumber("MIND_REFINE_CONFIDENCE", 0.7, 0, 1),
  refineMarginFloor: toNumber("MIND_REFINE_MARGIN", 0.15, 0, 1),

  memory: {
    enabled: toBool("MIND_MEMORY_ENABLED", true),
    candidates: Math.round(toNumber("MIND_MEMORY_CANDIDATES", 8, 1, 12)),
    selected: Math.round(toNumber("MIND_MEMORY_SELECTED", 5, 0, 5)),
    charBudget: Math.round(toNumber("MIND_MEMORY_TOKEN_BUDGET", 400, 100, 2000)),
    /** memory.md에서 옮긴 서버 공유 기억 예산. 28개 기준 약 900자. */
    coreBudget: Math.round(toNumber("MIND_CORE_MEMORY_BUDGET", 1200, 0, 4000)),
    autoMemory: toBool("MIND_AUTO_MEMORY", true),
    /** 기존 memory.md를 처음 한 번 SQLite로 옮긴다. */
    migration: toBool("MIND_MEMORY_MIGRATION", true)
  },

  emotion: {
    enabled: toBool("MIND_EMOTION_ENABLED", true),
    decay: toBool("MIND_EMOTION_DECAY_ENABLED", true),
    /** 분 단위 반감기. 값이 작을수록 빨리 평소 기분으로 돌아온다. */
    halfLifeMinutes: {
      valence: toNumber("MIND_HALF_LIFE_VALENCE", 30, 1, 1440),
      arousal: toNumber("MIND_HALF_LIFE_AROUSAL", 10, 1, 1440),
      irritation: toNumber("MIND_HALF_LIFE_IRRITATION", 20, 1, 1440),
      curiosity: toNumber("MIND_HALF_LIFE_CURIOSITY", 60, 1, 1440)
    },
    /** 한 사건이 한 번에 움직일 수 있는 최대 폭. */
    maxDelta: toNumber("MIND_EMOTION_MAX_DELTA", 0.25, 0.01, 1)
  },

  relationship: {
    enabled: toBool("MIND_RELATIONSHIP_ENABLED", true),
    /** 상호작용 1회당 최대 변화량. */
    updateLimit: toNumber("MIND_RELATIONSHIP_UPDATE_LIMIT", 0.03, 0.001, 0.5),
    /** 이 값 아래로 떨어지면 장난을 억제한다. */
    playfulnessFloor: toNumber("MIND_PLAYFULNESS_FLOOR", 0.2, 0, 1)
  },

  feedback: toBool("MIND_FEEDBACK_ENABLED", true),

  /** 웹 검색은 생성형 LLM 호출 전에 한 번만 수행한다. */
  search: {
    enabled: toBool("MIND_SEARCH_ENABLED", true),
    timeoutMs: Math.round(toNumber("MIND_SEARCH_TIMEOUT_MS", 3000, 500, 15_000))
  },

  /** 같은 메시지를 두 번 처리하지 않도록 기억하는 최근 turn 수. */
  turnMemory: Math.round(toNumber("MIND_TURN_MEMORY", 500, 50, 5000)),

  debug: toBool("MIND_DEBUG", false)
} as const;

export type MindConfig = typeof mindConfig;
