export type TriggerKind = "prefix" | "mention" | "reply";

/** Decision 모델의 선택지 키와 내부 값이 같도록 소문자 snake_case를 쓴다. */
export const MIND_ACTIONS = [
  "answer",
  "tease_back",
  "light_banter",
  "comfort",
  "clarify",
  "ask_followup",
  "set_boundary",
  "acknowledge",
  "repair_interaction"
] as const;
export type MindAction = (typeof MIND_ACTIONS)[number];

export const MIND_GOALS = [
  "maintain_rapport",
  "entertain",
  "support_user",
  "provide_information",
  "respect_boundary",
  "repair_interaction",
  "explore_topic"
] as const;
export type MindGoal = (typeof MIND_GOALS)[number];

export const EMOTION_IMPACTS = ["positive", "negative", "neutral"] as const;
export type EmotionImpact = (typeof EMOTION_IMPACTS)[number];

export const MEMORY_OPERATIONS = ["none", "add", "update", "delete", "unclear"] as const;
export type MemoryOperation = (typeof MEMORY_OPERATIONS)[number];

export type DecisionSource = "remote" | "remote_refined" | "local_fallback";
export type MemoryOperationStatus =
  | "none"
  | "success"
  | "failed"
  | "needs_confirmation"
  | "blocked";

/** 서버별로 저장되는 기니봇의 가상 감정. 실제 감정 경험이 아니라 행동 조절용 변수다. */
export type CharacterState = {
  valence: number;
  arousal: number;
  irritation: number;
  curiosity: number;
  currentGoal: MindGoal | null;
  updatedAt: number;
};

export type RelationshipState = {
  familiarity: number;
  trust: number;
  playfulness: number;
  interactionCount: number;
  boundaries: string[];
  lastInteractionAt: number;
};

export type MemoryScope = "user" | "guild" | "legacy";
export type MemoryKind = "semantic" | "episodic" | "reflective";

export type MemoryRecord = {
  id: number;
  guildId: string;
  ownerUserId: string | null;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number | null;
  expiresAt: number | null;
  version: number;
};

export type MemoryCandidate = {
  memory: MemoryRecord;
  /** 0.45R + 0.20I + 0.15T + 0.20C. 후보 정렬에만 쓰고 LLM에는 싣지 않는다. */
  score: number;
  /** 1차 검색에서 현재 메시지와 겹친 근거가 있었는지. Decision 실패 시 폴백 선택에 쓴다. */
  matched: boolean;
};

export type RecentMessage = {
  authorRole: "current_user" | "other_user" | "bot";
  text: string;
  secondsAgo: number;
  fromBot: boolean;
};

export type MindRequest = {
  messageId: string;
  guildId: string;
  channelId: string;
  userId: string;
  displayName: string;
  text: string;
  trigger: TriggerKind;
  replyToMessageId?: string;
  createdAt: number;
  /** 현재 메시지를 제외한 채널 최근 기록. 오래된 것부터 정렬돼 있다. */
  recent: Array<{
    id: string;
    authorId: string;
    author: string;
    content: string;
    fromBot: boolean;
    createdAt: number;
  }>;
};

export type MindContext = {
  request: MindRequest;
  state: CharacterState;
  relationship: RelationshipState;
  candidates: MemoryCandidate[];
  recent: RecentMessage[];
};

export type MindDecision = {
  intent: string;
  socialContext: string;
  emotionImpact: EmotionImpact;
  /** 0..1로 정규화한 사건 강도. score 0..4를 4로 나눈 값이다. */
  emotionIntensity: number;
  relationshipSignal: string;
  userNeeds: string;
  goal: MindGoal;
  action: MindAction;
  humorStrategy: string;
  needsWeb: boolean;
  memoryOperation: MemoryOperation;
  /** update/delete 대상으로 모델이 고른 기억. 없으면 null. */
  memoryTargetId: number | null;
  selectedMemories: MemoryRecord[];
  /** action 선택의 확신도. 정밀 판단 여부를 정한다. */
  confidence: number;
  refined: boolean;
  source: DecisionSource;
};

export type MemoryOperationResult = {
  status: MemoryOperationStatus;
  added: string[];
  updated: string[];
  removed: string[];
  reason: string | null;
};

export type CharacterFrame = {
  intent: string;
  goal: MindGoal;
  action: MindAction;
  mood: {
    valence: number;
    arousal: number;
    irritation: number;
    curiosity: number;
  };
  style: {
    tone: "playful" | "warm" | "calm" | "dry";
    humorLevel: number;
    empathyLevel: number;
    responseLength: "short" | "medium";
  };
  relationship: {
    familiarity: "new" | "familiar" | "close";
    playfulness: "low" | "medium" | "high";
  };
  selectedMemories: MemoryRecord[];
  constraints: string[];
  memoryStatus: MemoryOperationStatus;
  decisionSource: DecisionSource;
};

export type CompletedTurn = {
  context: MindContext;
  decision: MindDecision;
  memoryResult: MemoryOperationResult;
  replyText: string;
  sentMessageId: string | null;
};

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};
