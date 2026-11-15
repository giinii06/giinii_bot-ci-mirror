import { MIND_ACTIONS, type MindAction, type MindContext, type MemoryScope } from "../types.js";
import { actionLabel, type DecisionDraft, type DecisionSignals } from "./parser.js";
import {
  ACTION_CRITERIA,
  type DecisionAnswer,
  type QuestionMap
} from "./questions.js";

export type RefineLimits = {
  adaptiveRefinement: boolean;
  refineConfidenceFloor: number;
  refineMarginFloor: number;
};

const TEASING: readonly MindAction[] = ["tease_back", "light_banter"];

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

/**
 * 정밀 판단은 "새 근거로 갈릴 수 있을 때"만 부른다.
 * 애매한 기억 수정은 두 번째 모델 호출보다 사용자 확인이 안전하므로 제외한다.
 */
export const needsRefinement = (
  draft: DecisionDraft,
  signals: DecisionSignals,
  limits: RefineLimits
): boolean => {
  if (!limits.adaptiveRefinement) return false;
  if (signals.memoryAmbiguous) return false;
  if (signals.memoryScopeUncertain && !signals.hasOtherUserReference) return true;
  if (signals.conflicting) return true;

  const risky = TEASING.includes(draft.action) || draft.action === "set_boundary";
  if (!risky) return false;

  const lowMargin =
    signals.actionAlternatives.length === 2 &&
    signals.actionMargin < limits.refineMarginFloor;
  return draft.confidence < limits.refineConfidenceFloor || lowMargin;
};

export type RefineOptions = {
  actions: MindAction[];
  askTease: boolean;
  askScope: boolean;
};

export const refineOptions = (
  draft: DecisionDraft,
  signals: DecisionSignals
): RefineOptions => {
  const actions = unique<MindAction>([
    ...signals.actionAlternatives,
    draft.action,
    "acknowledge"
  ]).filter((action) => (MIND_ACTIONS as readonly string[]).includes(action));

  return {
    actions,
    askTease: actions.some((action) => TEASING.includes(action)),
    askScope: signals.memoryScopeUncertain && !signals.hasOtherUserReference
  };
};

/** 두 번째 요청은 1차 결과에 대한 집중 질문만 담는다. 같은 state를 다시 보내지 않는다. */
export const buildRefineQuestions = (
  draft: DecisionDraft,
  options: RefineOptions
): QuestionMap => {
  const questions: QuestionMap = {};

  if (options.askTease) {
    questions.safe_to_tease = {
      type: "noul",
      instructions: "현재 맥락에서 장난스럽게 받아치는 것이 적절한가?",
      criteria: {
        true: "친근한 장난이 분명하고 상대의 경계를 침해하지 않음",
        false: "실제 불만이나 적대성일 수 있어 신중한 반응이 적합함"
      }
    };
  }

  if (options.askScope) {
    questions.memory_scope_final = {
      type: "choice",
      instructions: "이 기억을 개인 기억으로 둘지, 서버 공용 기억으로 둘지 다시 고른다.",
      criteria: {
        user: "특정 사용자만 알아야 하는 개인 사실이나 취향",
        guild: "서버 공용 정보이거나 여러 사람에게 적용할 별명·관습"
      }
    };
  }

  questions.action_final = {
    type: "choice",
    instructions: `1차 판단은 "${actionLabel(draft.action)}"이었다. 이번 턴에 가장 적절한 행동을 다시 고른다.`,
    criteria: Object.fromEntries(
      options.actions.map((action) => [action, ACTION_CRITERIA[action] ?? action])
    )
  };

  return questions;
};

export const renderRefineState = (context: MindContext, draft: DecisionDraft): string => {
  return [
    `[메시지] ${context.request.text}`,
    `[호출] ${context.request.trigger}`,
    `[관계] 친숙도 ${context.relationship.familiarity.toFixed(2)}, 라포 ${context.relationship.rapport.toFixed(2)}, 장난 ${context.relationship.playfulness.toFixed(2)}`,
    `[1차 판단] 의도 ${draft.intent}, 상황 ${draft.socialContext}, 행동 ${draft.action}, ` +
      `기억 ${draft.memory.operation}/${draft.memory.scope}, 확신 ${draft.confidence.toFixed(2)}`,
    "[최근 대화]",
    ...context.recent.map(
      (message) =>
        `${message.secondsAgo}초 전 | ${message.authorRole === "bot" ? "기니봇" : "사용자"}: ${message.text.slice(0, 160)}`
    )
  ].join("\n");
};

/**
 * 정밀 판단 결과를 1차 판단에 덮어쓴다.
 * 장난이 부적절하다고 나오면 장난 계열 행동은 버리고 안전한 행동으로 내린다.
 */
export const applyRefinement = (
  draft: DecisionDraft,
  answers: Record<string, DecisionAnswer>,
  options: RefineOptions
): DecisionDraft => {
  const next: DecisionDraft = { ...draft, memory: { ...draft.memory } };

  const tease = answers.safe_to_tease;
  if (tease && tease.type === "noul" && tease.noul < 0.5 && TEASING.includes(next.action)) {
    next.action = "acknowledge";
    next.humorStrategy = "none";
    next.confidence = Math.max(next.confidence, tease.confidence ?? 0);
  }

  const scope = answers.memory_scope_final;
  if (
    options.askScope &&
    scope &&
    scope.type === "choice" &&
    (scope.choice === "user" || scope.choice === "guild")
  ) {
    next.memory.scope = scope.choice as MemoryScope;
    next.memory.confidence = Math.min(
      1,
      Math.max(0, scope.confidence ?? next.memory.confidence)
    );
  }

  const final = answers.action_final;
  if (final && final.type === "choice" && options.actions.includes(final.choice as MindAction)) {
    next.action = final.choice as MindAction;
    next.confidence = Math.min(1, Math.max(0, final.confidence ?? next.confidence));
    if (!TEASING.includes(next.action)) next.humorStrategy = "none";
  }

  return next;
};
