import {
  EMOTION_IMPACTS,
  MEMORY_OPERATIONS,
  MIND_ACTIONS,
  MIND_GOALS,
  type EmotionImpact,
  type MemoryCandidate,
  type MemoryOperation,
  type MindAction,
  type MindGoal
} from "../types.js";
import {
  EMOTION_INTENSITY_LEVELS,
  INTENT_CRITERIA,
  type ChoiceAnswer,
  type DecisionAnswer
} from "./questions.js";

export type DecisionDraft = {
  intent: string;
  socialContext: string;
  emotionImpact: EmotionImpact;
  emotionIntensity: number;
  relationshipSignal: string;
  userNeeds: string;
  goal: MindGoal;
  action: MindAction;
  humorStrategy: string;
  needsWeb: boolean;
  memoryOperation: MemoryOperation;
  memoryTargetId: number | null;
  selectedMemoryIds: number[];
  confidence: number;
};

export type DecisionSignals = {
  actionMargin: number;
  socialMargin: number;
  /** 1차 판단이 가장 강하게 고려한 행동 후보. 정밀 판단의 선택지로 쓴다. */
  actionAlternatives: MindAction[];
  /** 수정·삭제 의도는 있는데 대상이 특정되지 않았다. */
  memoryAmbiguous: boolean;
  /** 감정·상황 판단과 행동 선택이 서로 어긋난다. */
  conflicting: boolean;
};

const SOCIAL_CONTEXTS = ["friendly_banter", "conflict", "serious", "supportive", "neutral"];
const RELATIONSHIP_SIGNALS = ["warm", "neutral", "playful", "boundary_set", "rejection"];
const USER_NEEDS = ["humor", "comfort", "information", "acknowledgment", "clarification", "action"];
const HUMOR_STRATEGIES = ["none", "light_tease", "wordplay", "absurd_comparison", "dry_deadpan"];

const answerOf = (
  answers: Record<string, DecisionAnswer>,
  key: string
): ChoiceAnswer | null => {
  const answer = answers[key];
  return answer && answer.type === "choice" ? answer : null;
};

const choiceKey = <T extends string>(
  answers: Record<string, DecisionAnswer>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T => {
  const answer = answerOf(answers, key);
  if (!answer) return fallback;
  return (allowed as readonly string[]).includes(answer.choice) ? (answer.choice as T) : fallback;
};

const noul = (answers: Record<string, DecisionAnswer>, key: string, fallback = 0): number => {
  const answer = answers[key];
  if (!answer || answer.type !== "noul") return fallback;
  return Number.isFinite(answer.noul) ? Math.min(1, Math.max(0, answer.noul)) : fallback;
};

const marginOf = (answer: ChoiceAnswer | null): number => {
  if (!answer) return 0;
  const values = Object.values(answer.probabilities ?? {})
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  if (values.length < 2) return values.length === 1 ? 1 : 0;
  return Math.max(0, (values[0] ?? 0) - (values[1] ?? 0));
};

/**
 * Decision 응답은 확률과 선택 키의 모음이다. 여기서 타입을 좁히고,
 * 해석이 애매하면 보수적인 기본값으로 떨어뜨린다. 자유 생성은 하지 않는다.
 */
export const parseDecision = (
  answers: Record<string, DecisionAnswer>,
  candidates: MemoryCandidate[],
  limits: { maxSelected: number }
): { draft: DecisionDraft; signals: DecisionSignals } => {
  const actionAnswer = answerOf(answers, "action");
  const socialAnswer = answerOf(answers, "social_context");

  const action = choiceKey(answers, "action", MIND_ACTIONS, "acknowledge");
  const socialContext = choiceKey(answers, "social_context", SOCIAL_CONTEXTS, "neutral");

  const scoreAnswer = answers.emotion_intensity;
  const rawScore = scoreAnswer && scoreAnswer.type === "score" ? scoreAnswer.score : 2;
  const intensity = Math.min(
    1,
    Math.max(0, rawScore / Math.max(1, EMOTION_INTENSITY_LEVELS.length - 1))
  );

  const operation = choiceKey(answers, "memory_operation", MEMORY_OPERATIONS, "none");

  const targetKey = choiceKey(
    answers,
    "memory_target",
    ["none", ...candidates.map((c) => `m${c.memory.id}`)],
    "none"
  );
  const targetId = targetKey === "none" ? null : Number.parseInt(targetKey.slice(1), 10);
  const ownedTarget =
    targetId !== null && candidates.some((candidate) => candidate.memory.id === targetId)
      ? targetId
      : null;

  const scored = candidates
    .map((candidate) => ({
      id: candidate.memory.id,
      relevance: noul(answers, `memory_rel_${candidate.memory.id}`)
    }))
    .filter((item) => item.relevance >= 0.5)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, Math.max(0, limits.maxSelected));

  const emotionImpact = choiceKey(answers, "emotion_impact", EMOTION_IMPACTS, "neutral");

  const draft: DecisionDraft = {
    intent: choiceKey(answers, "intent", Object.keys(INTENT_CRITERIA), "smalltalk"),
    socialContext,
    emotionImpact,
    emotionIntensity: intensity,
    relationshipSignal: choiceKey(answers, "relationship_signal", RELATIONSHIP_SIGNALS, "neutral"),
    userNeeds: choiceKey(answers, "user_needs", USER_NEEDS, "acknowledgment"),
    goal: choiceKey(answers, "goal", MIND_GOALS, "maintain_rapport"),
    action,
    humorStrategy: choiceKey(answers, "humor_strategy", HUMOR_STRATEGIES, "none"),
    needsWeb: noul(answers, "needs_web") >= 0.5,
    memoryOperation: operation,
    memoryTargetId: ownedTarget,
    selectedMemoryIds: scored.map((item) => item.id),
    confidence: actionAnswer ? Math.min(1, Math.max(0, actionAnswer.confidence ?? 0)) : 0
  };

  const signals: DecisionSignals = {
    actionMargin: marginOf(actionAnswer),
    socialMargin: marginOf(socialAnswer),
    actionAlternatives: actionAnswer
      ? Object.entries(actionAnswer.probabilities ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([key]) => key)
          .filter((key): key is MindAction => (MIND_ACTIONS as readonly string[]).includes(key))
      : [],
    memoryAmbiguous:
      (operation === "update" || operation === "delete") && ownedTarget === null,
    conflicting:
      (emotionImpact === "negative" && intensity >= 0.5 && action === "tease_back") ||
      (socialContext === "conflict" && action === "tease_back") ||
      (draft.userNeeds === "comfort" && action === "tease_back")
  };

  return { draft, signals };
};

/** 액션 이름을 사람이 읽는 한국어로. 프레임 프롬프트에만 쓴다. */
export const actionLabel = (action: MindAction): string => {
  const labels: Record<MindAction, string> = {
    answer: "질문에 바로 답하기",
    tease_back: "장난 받아치기",
    light_banter: "가볍게 맞장구치기",
    comfort: "위로하기",
    clarify: "되묻기",
    ask_followup: "대화 이어가기",
    set_boundary: "경계 분명히 하기",
    acknowledge: "짧게 인정하기",
    repair_interaction: "앞선 실수 회복하기"
  };
  return labels[action];
};

export const goalLabel = (goal: MindGoal): string => {
  const labels: Record<MindGoal, string> = {
    maintain_rapport: "관계 유지",
    entertain: "재미 만들기",
    support_user: "위로와 배려",
    provide_information: "정확한 정보 전달",
    respect_boundary: "경계 존중",
    repair_interaction: "실수 회복",
    explore_topic: "주제 넓히기"
  };
  return labels[goal];
};
