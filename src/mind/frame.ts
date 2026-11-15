import { actionLabel, goalLabel } from "./decision/parser.js";
import type {
  CharacterFrame,
  MemoryOperationResult,
  MindContext,
  MindDecision
} from "./types.js";

const TEASING = new Set(["tease_back", "light_banter"]);

const humorLevelOf = (strategy: string, action: string): number => {
  if (strategy === "none" || action === "set_boundary" || action === "comfort") return 0;
  if (strategy === "light_tease") return 0.5;
  if (strategy === "dry_deadpan") return 0.4;
  return 0.7;
};

/**
 * 행동 중재. 모델 판단과 관계·경계가 충돌하면 안전한 쪽으로 내린다.
 * 감정 상태는 쓰지 않는다. 말투는 관계와 현재 대화의 사회적 맥락으로만 정한다.
 */
export const compileFrame = (
  context: MindContext,
  decision: MindDecision,
  memoryResult: MemoryOperationResult,
  limits: { playfulnessFloor: number } = { playfulnessFloor: 0.2 }
): CharacterFrame => {
  const { relationship } = context;
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
  }

  if (memoryResult.status === "needs_confirmation") {
    constraints.push("기억을 바꿨다고 말하지 말고, 어떤 기억인지 짧게 되묻는다.");
  } else if (memoryResult.status === "failed") {
    constraints.push("기억 변경에 실패했으면 저장했다고 말하지 않는다.");
  } else if (memoryResult.status === "pending") {
    constraints.push("공용 기억은 아직 승인 대기 중이라고 말한다. 저장됐다고 단정하지 않는다.");
  } else if (memoryResult.status === "blocked") {
    constraints.push("기억을 바꾸지 못했으면 바꿨다고 말하지 않는다.");
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

  const responseLength: CharacterFrame["style"]["responseLength"] =
    relationship.communicationStyle === "concise"
      ? "short"
      : relationship.communicationStyle === "detailed"
        ? "medium"
        : action === "answer"
          ? "medium"
          : "short";

  const applicableNicknames = context.conventions
    .filter(
      (memory) =>
        memory.category === "nickname" &&
        memory.approval === "active" &&
        memory.subjectUserId !== null &&
        memory.structuredValue !== null
    )
    .map((memory) => ({
      userId: memory.subjectUserId as string,
      nickname: memory.structuredValue as string
    }));

  return {
    intent: decision.intent,
    goal: decision.goal,
    action,
    style: {
      tone,
      humorLevel,
      empathyLevel: action === "comfort" ? 1 : action === "acknowledge" ? 0.4 : 0.2,
      responseLength
    },
    relationship: {
      familiarity: relationship.familiarity,
      rapport: relationship.rapport,
      playfulness: relationship.playfulness,
      engagement: relationship.engagement,
      communicationStyle: relationship.communicationStyle
    },
    selectedMemories: decision.selectedMemories,
    applicableNicknames,
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

const styleLabel: Record<CharacterFrame["relationship"]["communicationStyle"], string> = {
  default: "기본",
  concise: "짧게",
  detailed: "자세히",
  formal: "격식 있게",
  casual: "편하게"
};

/** 생성형 LLM에 넘기는 유일한 동적 행동 지침. 원시 JSON은 절대 그대로 넣지 않는다. */
export const renderFrame = (
  frame: CharacterFrame,
  displayNames: Record<string, string> = {}
): string => {
  const lines: string[] = [];
  lines.push(`- 지금 할 일: ${actionLabel(frame.action)}`);
  lines.push(`- 이번 목표: ${goalLabel(frame.goal)}`);
  lines.push(
    `- 표정과 말투: ${toneLabel[frame.style.tone]}, 농담 강도 ${frame.style.humorLevel.toFixed(1)}, ` +
      `공감 강도 ${frame.style.empathyLevel.toFixed(1)}`
  );
  lines.push(
    `- 관계: 친숙도 ${frame.relationship.familiarity.toFixed(2)}, 라포 ${frame.relationship.rapport.toFixed(2)}, ` +
      `장난 ${frame.relationship.playfulness.toFixed(2)}, 참여 ${frame.relationship.engagement.toFixed(2)}, ` +
      `대화 스타일 ${styleLabel[frame.relationship.communicationStyle]}`
  );
  if (frame.applicableNicknames.length > 0) {
    // 대상 이름 없이 별명만 적으면 누구에게 쓰는 말인지 알 수 없다.
    const nicknames = frame.applicableNicknames.map((item) => {
      const name = displayNames[item.userId] ?? "대상 사용자";
      return `${name} → "${item.nickname}"`;
    });
    lines.push(`- 호칭: ${nicknames.join(", ")}`);
  }
  lines.push(
    `- 길이: ${frame.style.responseLength === "short" ? "1~2문장" : "2~3문장"}`
  );
  if (frame.constraints.length > 0) {
    lines.push(`- 제약: ${frame.constraints.join(" ")}`);
  }
  return lines.join("\n");
};
