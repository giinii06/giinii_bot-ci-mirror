import type { MemoryCandidate, MindContext } from "../types.js";

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type DecisionQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export type QuestionMap = Record<string, DecisionQuestion>;

export type NoulAnswer = { type: "noul"; noul: number; confidence: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
};
export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer | { type: "refusal" };

export type DecisionResponse = {
  id?: string;
  model?: string;
  answers?: Record<string, DecisionAnswer>;
};

export const EMOTION_INTENSITY_LEVELS = [
  "거의 없음: 스쳐 지나가는 잡담",
  "약함: 가볍게 기분이 움직이는 수준",
  "보통: 또렷하게 반응할 만한 수준",
  "강함: 대화 분위기를 바꿀 만한 수준",
  "아주 강함: 이 대화의 주제가 될 만큼 큰 사건"
];

export const INTENT_CRITERIA: Record<string, string> = {
  friendly_banter: "친근한 장난, 놀리기, 가벼운 도발",
  hostile_insult: "실제로 기분이 상했거나 공격하려는 욕설",
  factual_question: "사실이나 최신 정보를 묻는 질문",
  emotional_support: "위로나 공감을 바라는 발언",
  memory_request: "무언가를 기억해 두거나 잊어 달라는 요청",
  action_request: "구체적인 행동이나 작업을 요청",
  smalltalk: "특별한 목적 없는 잡담",
  unclear: "의도를 판단하기 어려움"
};

export const ACTION_CRITERIA: Record<string, string> = {
  answer: "질문에 바로 답한다",
  tease_back: "장난을 받아쳐서 놀린다",
  light_banter: "가볍게 맞장구치며 분위기를 이어간다",
  comfort: "드립을 멈추고 위로한다",
  clarify: "무엇을 원하는지 되묻는다",
  ask_followup: "대화를 이어갈 질문을 던진다",
  set_boundary: "지금은 그런 말을 받아주지 않는다고 분명히 말한다",
  acknowledge: "짧게 받아들이고 넘긴다",
  repair_interaction: "앞선 실수를 인정하고 분위기를 되돌린다"
};

const GOAL_CRITERIA: Record<string, string> = {
  maintain_rapport: "자연스러운 관계를 유지한다",
  entertain: "재미있는 상호작용을 만든다",
  support_user: "상대를 위로하고 배려한다",
  provide_information: "정확한 정보를 전달한다",
  respect_boundary: "상대가 정한 경계를 지킨다",
  repair_interaction: "이전 대화의 실수를 회복한다",
  explore_topic: "흥미로운 주제로 대화를 넓힌다"
};

const pick = (source: Record<string, string>, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key] ?? key]));

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * Decision 모델은 자유 생성을 하지 않는다. 판단에 필요한 질문만 한 요청에 묶는다.
 * state는 문자열이어야 하므로 구조화된 값은 아래 renderState가 라벨 텍스트로 만든다.
 */
export const buildQuestions = (candidates: MemoryCandidate[]): QuestionMap => {
  const questions: QuestionMap = {
    intent: {
      type: "choice",
      instructions: "현재 메시지를 보낸 사람의 의도를 분류한다.",
      criteria: INTENT_CRITERIA
    },
    social_context: {
      type: "choice",
      instructions: "지금 대화의 사회적 성격을 분류한다.",
      criteria: {
        friendly_banter: "서로 즐기는 장난",
        conflict: "실제 갈등이나 불만",
        serious: "진지한 이야기",
        supportive: "위로가 필요한 상황",
        neutral: "평범한 잡담"
      }
    },
    emotion_impact: {
      type: "choice",
      instructions: "이 메시지가 기니봇의 가상 기분에 주는 방향을 고른다.",
      criteria: {
        positive: "기분이 좋아지는 사건",
        negative: "기분이 상하거나 불쾌한 사건",
        neutral: "기분에 거의 영향이 없는 사건"
      }
    },
    emotion_intensity: {
      type: "score",
      instructions: "이 사건의 감정적 강도를 고른다.",
      criteria: EMOTION_INTENSITY_LEVELS
    },
    relationship_signal: {
      type: "choice",
      instructions: "이 상호작용이 둘 사이 관계에 남기는 신호를 고른다.",
      criteria: {
        warm: "친밀감이 조금 오르는 상호작용",
        neutral: "관계에 특별한 변화가 없음",
        playful: "장난을 주고받는 관계로 가까워짐",
        boundary_set: "하지 말아 달라는 명시적인 경계 설정",
        rejection: "기니봇의 이전 반응을 거부함"
      }
    },
    user_needs: {
      type: "choice",
      instructions: "이 사람이 지금 기니봇에게 바라는 반응을 고른다.",
      criteria: {
        humor: "놀림이나 드립",
        comfort: "위로와 공감",
        information: "정확한 정보",
        acknowledgment: "짧은 인정이나 맞장구",
        clarification: "되묻는 확인",
        action: "실제 행동"
      }
    },
    goal: {
      type: "choice",
      instructions: "이번 턴에서 기니봇이 우선할 목표를 고른다.",
      criteria: GOAL_CRITERIA
    },
    action: {
      type: "choice",
      instructions: "이번 턴에 가장 적절한 행동을 고른다.",
      criteria: ACTION_CRITERIA
    },
    humor_strategy: {
      type: "choice",
      instructions: "농담을 쓴다면 어떤 방식을 쓸지 고른다.",
      criteria: {
        none: "농담하지 않는다",
        light_tease: "가볍게 놀린다",
        wordplay: "말꼬리를 잡아 되받는다",
        absurd_comparison: "엉뚱한 비유로 놀린다",
        dry_deadpan: "무표정하게 받아친다"
      }
    },
    needs_web: {
      type: "noul",
      instructions: "정확히 답하려면 최신 웹 정보를 검색해야 하는가?",
      criteria: {
        true: "최신 뉴스, 가격, 일정, 출시 정보처럼 외부 검색이 필요한 질문",
        false: "잡담이거나 검색 없이도 답할 수 있는 내용"
      }
    },
    memory_operation: {
      type: "choice",
      instructions: "이번 메시지가 장기 기억의 저장·수정·삭제를 요구하는가?",
      criteria: {
        none: "기억을 건드릴 필요가 없음",
        add: "새로운 사실을 기억해 둬야 함",
        update: "기존 기억의 내용이 바뀌어야 함",
        delete: "기존 기억을 지워야 함",
        unclear: "기억을 건드려야 하는 것 같지만 대상이 분명하지 않음"
      }
    }
  };

  if (candidates.length > 0) {
    const targetCriteria: Record<string, string> = {
      none: "특정 기억을 수정하거나 삭제하지 않는다"
    };
    for (const candidate of candidates) {
      targetCriteria[`m${candidate.memory.id}`] = clip(candidate.memory.content, 80);
    }
    questions.memory_target = {
      type: "choice",
      instructions: "수정하거나 삭제할 기억을 하나 고른다. 해당 없으면 none.",
      criteria: targetCriteria
    };

    for (const candidate of candidates) {
      questions[`memory_rel_${candidate.memory.id}`] = {
        type: "noul",
        instructions: `기억 "${clip(candidate.memory.content, 100)}"이 지금 답변에 필요한가?`,
        criteria: {
          true: "지금 대화를 이해하거나 답하는 데 실제로 도움이 됨",
          false: "주제와 무관하거나 언급할 필요가 없음"
        }
      };
    }
  }

  return questions;
};

const moodLabel = (value: number, low: string, mid: string, high: string) =>
  value < 0.34 ? low : value < 0.67 ? mid : high;

/** Decision 입력. Discord ID는 넣지 않고 표시 이름만 쓴다. */
export const renderState = (context: MindContext): string => {
  const { request, state, relationship, recent, candidates } = context;
  const lines: string[] = [];

  lines.push("[현재 메시지]");
  lines.push(`보낸 사람: ${request.displayName}`);
  lines.push(`호출 방식: ${request.trigger}`);
  if (request.replyToMessageId) lines.push("기니봇의 이전 발언에 답장한 메시지다.");
  lines.push(`내용: ${clip(request.text, 600)}`);
  lines.push("");

  lines.push("[최근 대화]");
  if (recent.length === 0) {
    lines.push("(없음)");
  } else {
    for (const message of recent) {
      const who =
        message.authorRole === "bot"
          ? "기니봇"
          : message.authorRole === "current_user"
            ? "지금 말한 사람"
            : "다른 사람";
      lines.push(`${message.secondsAgo}초 전 | ${who}: ${clip(message.text, 200)}`);
    }
  }
  lines.push("");

  lines.push("[기니봇 가상 상태]");
  lines.push(
    `기분: ${moodLabel(state.valence, "가라앉음", "평범", "좋음")} (${state.valence.toFixed(2)}), ` +
      `활력 ${state.arousal.toFixed(2)}, 불쾌 ${state.irritation.toFixed(2)}, 호기심 ${state.curiosity.toFixed(2)}`
  );
  if (state.currentGoal) lines.push(`최근 목표: ${state.currentGoal}`);
  lines.push("");

  lines.push("[관계]");
  lines.push(
    `친숙도 ${relationship.familiarity.toFixed(2)}, 신뢰 ${relationship.trust.toFixed(2)}, ` +
      `장난 선호 ${relationship.playfulness.toFixed(2)}, 상호작용 ${relationship.interactionCount}회`
  );
  if (relationship.boundaries.length > 0) {
    lines.push(`명시적 경계: ${relationship.boundaries.map((item) => `"${clip(item, 60)}"`).join(", ")}`);
  }
  lines.push("");

  lines.push("[기억 후보]");
  if (candidates.length === 0) {
    lines.push("(없음)");
  } else {
    for (const candidate of candidates) {
      const { memory } = candidate;
      lines.push(
        `m${memory.id} (${memory.kind}, 신뢰 ${memory.confidence.toFixed(2)}, 중요도 ${memory.importance.toFixed(2)}): ${clip(memory.content, 160)}`
      );
    }
  }

  return lines.join("\n");
};
