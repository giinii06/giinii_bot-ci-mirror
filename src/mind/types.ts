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

export const MEMORY_OPERATIONS = ["none", "add", "update", "delete", "unclear"] as const;
export type MemoryOperation = (typeof MEMORY_OPERATIONS)[number];

export const MEMORY_SCOPES = ["user", "guild"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_VISIBILITIES = ["private", "shareable"] as const;
export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];

export const MEMORY_CATEGORIES = [
  "fact",
  "preference",
  "nickname",
  "server_convention"
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const COMMUNICATION_STYLES = [
  "default",
  "concise",
  "detailed",
  "formal",
  "casual"
] as const;
export type CommunicationStyle = (typeof COMMUNICATION_STYLES)[number];

export type DecisionSource = "remote" | "remote_refined" | "local_fallback";
/** 승인 대기 상태는 없다. 공용 기억은 저장 즉시 활성화된다. */
export type MemoryOperationStatus =
  | "none"
  | "success"
  | "failed"
  | "needs_confirmation"
  | "blocked";

/** 기니봇과 사용자 사이의 상호작용 조절 값. 실제 관계의 측정값이 아니다. */
export type BotUserRelationship = {
  guildId: string;
  userId: string;

  familiarity: number;
  rapport: number;
  playfulness: number;
  engagement: number;

  communicationStyle: CommunicationStyle;

  confidence: number;
  interactionCount: number;
  positiveInteractionCount: number;
  negativeFeedbackCount: number;

  firstInteractionAt: number;
  lastInteractionAt: number;
  version: number;
};

export type MemoryKind = "semantic";

export type MemoryRecord = {
  id: number;
  guildId: string;

  scope: MemoryScope;
  kind: MemoryKind;
  category: MemoryCategory;

  /** 개인 기억의 소유자. 공용 기억은 null. */
  ownerUserId: string | null;
  /** 이 기억이 설명하는 대상. 서버 전체 기억은 null. */
  subjectUserId: string | null;
  /** 기억 작성을 요청한 사용자. 시스템이 만든 기억은 "system". */
  createdByUserId: string;

  visibility: MemoryVisibility;

  content: string;
  /** 별명처럼 값만 따로 활용하는 기억. */
  structuredValue: string | null;

  confidence: number;
  importance: number;

  sourceMessageId: string | null;
  sourceChannelId: string | null;

  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number | null;
  expiresAt: number | null;
  deletedAt: number | null;
  version: number;
};

export type MemoryCandidate = {
  memory: MemoryRecord;
  /** 0.45R + 0.20I + 0.15T + 0.20C. 후보 정렬에만 쓰고 LLM에는 싣지 않는다. */
  score: number;
  /** 1차 검색에서 현재 메시지와 겹친 근거가 있었는지. Decision 실패 시 폴백 선택에 쓴다. */
  matched: boolean;
};

/** 권한 검사는 Discord가 확인한 값으로만 만든다. 모델 출력을 쓰지 않는다. */
export type MemoryActor = {
  userId: string;
  guildId: string;
  isAdministrator: boolean;
  source: "discord_message" | "slash_command";
};

export type ReferencedUser = {
  userId: string;
  displayName: string;
  referenceType: "mention" | "reply" | "name";
  confidence: number;
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
  /** Discord에서 확인한 관리자 여부. 모델 출력이 아니라 요청을 만든 쪽이 채운다. */
  isAdministrator: boolean;
  text: string;
  trigger: TriggerKind;
  replyToMessageId?: string;
  /** 답장 대상 메시지의 작성자. 봇이면 null. */
  replyToAuthorId: string | null;
  /** 이번 메시지가 기니봇의 발언에 답장한 것인지. */
  botWasReplyTarget: boolean;
  /** 멘션·답장·표시 이름으로 확인한 대화 상대. ID를 새로 만들지 않는다. */
  referencedUsers: ReferencedUser[];
  /** 이름이 겹쳐 ID를 하나로 정하지 못한 표시 이름. 기억 범위는 guild로 강제한다. */
  ambiguousUserNames: string[];
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
  relationship: BotUserRelationship;
  candidates: MemoryCandidate[];
  /** 대상 사용자에게 바로 적용하는 활성 공용 호칭. 검색 점수와 무관하게 쓴다. */
  conventions: MemoryRecord[];
  recent: RecentMessage[];
};

export type MemoryDecision = {
  operation: MemoryOperation;
  scope: "user" | "guild" | "none";
  visibility: MemoryVisibility;
  category: MemoryCategory;
  subjectUserId: string | null;
  targetMemoryId: number | null;
  confidence: number;
  /** 장기적으로 기억할 가치. 0.5 이상이면 저장 후보로 본다. */
  memoryWorthiness: number;
  /** 모델이 본 타인 관련성. 최종 범위는 코드가 확인한 참조로 강제한다. */
  involvesOtherUser: boolean;
  /** 사용자가 명시적으로 저장을 요청했는지. 자동 저장 여부를 가른다. */
  explicit: boolean;
};

export type MindDecision = {
  intent: string;
  socialContext: string;
  relationshipSignal: string;
  userNeeds: string;
  goal: MindGoal;
  action: MindAction;
  humorStrategy: string;
  needsWeb: boolean;
  memory: MemoryDecision;
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

export type ApplicableNickname = {
  userId: string;
  nickname: string;
};

export type CharacterFrame = {
  intent: string;
  goal: MindGoal;
  action: MindAction;
  style: {
    tone: "playful" | "warm" | "calm" | "dry";
    humorLevel: number;
    empathyLevel: number;
    responseLength: "short" | "medium";
  };
  relationship: {
    familiarity: number;
    rapport: number;
    playfulness: number;
    engagement: number;
    communicationStyle: CommunicationStyle;
  };
  selectedMemories: MemoryRecord[];
  applicableNicknames: ApplicableNickname[];
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
