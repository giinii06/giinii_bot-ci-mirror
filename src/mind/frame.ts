import { actionLabel, goalLabel } from "./decision/parser.js";
import type {
  CharacterFrame,
  MemoryOperationResult,
  MindContext,
  MindDecision
} from "./types.js";

const TEASING = new Set(["tease_back", "light_banter"]);

const familiarityLabel = (value: number): CharacterFrame["relationship"]["familiarity"] =>
  value < 0.2 ? "new" : value < 0.6 ? "familiar" : "close";

const playfulnessLabel = (value: number): CharacterFrame["relationship"]["playfulness"] =>
  value < 0.35 ? "low" : value < 0.65 ? "medium" : "high";

const humorLevelOf = (strategy: string, action: string): number => {
  if (strategy === "none" || action === "set_boundary" || action === "comfort") return 0;
  if (strategy === "light_tease") return 0.5;
  if (strategy === "dry_deadpan") return 0.4;
  return 0.7;
};

/**
 * 행동 중재. 모델 판단과 상태·경계가 충돌하면 안전한 쪽으로 내린다.
 * 감정은 행동을 조절하는 변수이고, 사용자의 경계는 행동을 제한하는 조건이다.
 */
export const compileFrame = (
  context: MindContext,
  decision: MindDecision,
  memoryResult: MemoryOperationResult,
  limits: { playfulnessFloor: number } = { playfulnessFloor: 0.2 }
): CharacterFrame => {
  const { state, relationship } = context;
  const constraints: string[] = [];

  let action = decision.action;
  let humorLevel = humorLevelOf(decision.humorStrategy, action);

  const serious = decision.socialContext === "conflict" || decision.socialContext === "serious";
  const wantsComfort = decision.userNeeds === "comfort";

  if (TEASING.has(action) && wantsComfort) {
    action = "comfort";
    humorLevel = 0;
    constraints.push("상대가 위로를 바라는 상황이므로 놀리지 않는다.");
  } else if (action === "tease_back" && serious) {
    action = "acknowledge";
    humorLevel = 0;
    constraints.push("갈등이나 진지한 상황이므로 받아치지 않는다.");
  } else if (TEASING.has(action) && relationship.playfulness < limits.playfulnessFloor) {
    action = "acknowledge";
    humorLevel = 0;
    constraints.push("이 사람과는 장난이 아직 편하지 않으므로 가볍게 넘긴다.");
  } else if (action === "tease_back" && state.irritation > 0.6) {
    action = "light_banter";
    humorLevel = Math.min(humorLevel, 0.3);
    constraints.push("지금 기분이 좋지 않으므로 과격한 받아치기는 피한다.");
  }

  if (memoryResult.status === "needs_confirmation") {
    constraints.push("기억을 바꿨다고 말하지 말고, 어떤 기억인지 짧게 되묻는다.");
  } else if (memoryResult.status === "failed") {
    constraints.push("기억 변경에 실패했으면 저장했다고 말하지 않는다.");
  }

  if (decision.source === "local_fallback") {
    constraints.push("판단 근거가 충분하지 않으니 짧고 무난하게 답한다.");
  }

  if (relationship.boundaries.length > 0) {
    constraints.push("이 사람이 정한 경계를 넘는 농담은 하지 않는다.");
  }

  const tone: CharacterFrame["style"]["tone"] =
    action === "comfort"
      ? "warm"
      : action === "set_boundary"
        ? "dry"
        : TEASING.has(action)
          ? "playful"
          : "calm";

  return {
    intent: decision.intent,
    goal: decision.goal,
    action,
    mood: {
      valence: state.valence,
      arousal: state.arousal,
      irritation: state.irritation,
      curiosity: state.curiosity
    },
    style: {
      tone,
      humorLevel,
      empathyLevel: action === "comfort" ? 1 : action === "acknowledge" ? 0.4 : 0.2,
      responseLength: action === "answer" ? "medium" : "short"
    },
    relationship: {
      familiarity: familiarityLabel(relationship.familiarity),
      playfulness: playfulnessLabel(relationship.playfulness)
    },
    selectedMemories: decision.selectedMemories,
    constraints,
    memoryStatus: memoryResult.status,
    decisionSource: decision.source
  };
};

const toneLabel: Record<CharacterFrame["style"]["tone"], string> = {
  playful: "장난스럽게",
  warm: "따뜻하게",
  calm: "차분하게",
  dry: "무뚝뚝하게"
};

const familiarityText: Record<CharacterFrame["relationship"]["familiarity"], string> = {
  new: "처음 보는 사이다",
  familiar: "몇 번 이야기한 사이다",
  close: "꽤 친한 사이다"
};

const playfulnessText: Record<CharacterFrame["relationship"]["playfulness"], string> = {
  low: "장난은 거의 받아주지 않는다",
  medium: "가벼운 장난은 주고받는다",
  high: "서로 놀리는 게 자연스럽다"
};

/** 생성형 LLM에 넘기는 유일한 동적 행동 지침. 원시 JSON은 절대 그대로 넣지 않는다. */
export const renderFrame = (frame: CharacterFrame): string => {
  const lines: string[] = [];
  lines.push(`- 지금 할 일: ${actionLabel(frame.action)}`);
  lines.push(`- 이번 목표: ${goalLabel(frame.goal)}`);
  lines.push(
    `- 표정과 말투: ${toneLabel[frame.style.tone]}, 농담 강도 ${frame.style.humorLevel.toFixed(1)}, ` +
      `공감 강도 ${frame.style.empathyLevel.toFixed(1)}`
  );
  lines.push(
    `- 기니봇의 지금 기분: 긍정 ${frame.mood.valence.toFixed(2)}, 활력 ${frame.mood.arousal.toFixed(2)}, ` +
      `불쾌 ${frame.mood.irritation.toFixed(2)}, 호기심 ${frame.mood.curiosity.toFixed(2)}`
  );
  lines.push(
    `- 관계: ${familiarityText[frame.relationship.familiarity]}, ${playfulnessText[frame.relationship.playfulness]}`
  );
  lines.push(
    `- 길이: ${frame.style.responseLength === "short" ? "1~2문장" : "2~3문장"}`
  );
  if (frame.constraints.length > 0) {
    lines.push(`- 제약: ${frame.constraints.join(" ")}`);
  }
  return lines.join("\n");
};
