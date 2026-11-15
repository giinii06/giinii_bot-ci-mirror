import {
  MEMORY_CATEGORIES,
  MEMORY_SCOPES,
  MEMORY_VISIBILITIES,
  type MemoryCandidate,
  type MemoryCategory,
  type MindContext
} from "../types.js";

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

const MEMORY_SCOPE_CRITERIA: Record<string, string> = {
  none: "저장할 기억이 없다",
  user: "특정 사용자의 개인 사실이나 취향",
  guild: "서버 공용 정보 또는 서버에서 쓰는 별명"
};

const MEMORY_CATEGORY_CRITERIA: Record<MemoryCategory, string> = {
  fact: "사용자에 대한 사실",
  preference: "사용자 개인의 취향",
  nickname: "서버에서 사용하는 별명이나 호칭",
  server_convention: "서버에서 공통으로 사용하는 관습"
};

const MEMORY_VISIBILITY_CRITERIA: Record<string, string> = {
  private: "기억 소유자만 쓰는 기억",
  shareable: "다른 사용자의 대화에서도 활용해도 되는 기억"
};

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export const subjectKeyOf = (context: MindContext): Record<string, string | null> => {
  const keys: Record<string, string | null> = {
    none: null,
    self: context.request.userId,
    server: null
  };
  context.request.referencedUsers.forEach((user, index) => {
    keys[`u${index + 1}`] = user.userId;
  });
  return keys;
};

/**
 * Decision 모델은 자유 생성을 하지 않는다. 판단에 필요한 질문만 한 요청에 묶는다.
 * 사용자 ID는 코드가 확인한 후보 키(u1, u2…)로만 고르게 한다.
 */
export const buildQuestions = (context: MindContext): QuestionMap => {
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
        add: "새로운 사실이나 호칭을 기억해 둬야 함",
        update: "기존 기억의 내용이 바뀌어야 함",
        delete: "기존 기억이나 호칭을 그만 써야 함",
        unclear: "기억을 건드려야 하는 것 같지만 대상이 분명하지 않음"
      }
    },
    memory_scope: {
      type: "choice",
      instructions: "이 기억은 개인 기억인가, 서버 공용 기억인가?",
      criteria: MEMORY_SCOPE_CRITERIA
    },
    memory_category: {
      type: "choice",
      instructions: "저장할 정보의 성격을 분류한다.",
      criteria: MEMORY_CATEGORY_CRITERIA
    },
    memory_visibility: {
      type: "choice",
      instructions: "이 기억을 다른 사용자의 대화에서도 써도 되는가?",
      criteria: MEMORY_VISIBILITY_CRITERIA
    },
    memory_requires_approval: {
      type: "noul",
      instructions: "관리자 확인을 거쳐야 하는 공용 기억 변경인가?",
      criteria: {
        true: "서버 규칙이나 여러 사람에게 영향을 주는 변경",
        false: "가벼운 별명이나 이미 허용된 범위의 변경"
      }
    },
    memory_write_intent: {
      type: "noul",
      instructions: "사용자가 기억이나 호칭을 명시적으로 요청했는가?",
      criteria: {
        true: "기억해 달라거나 이렇게 불러 달라는 분명한 요청",
        false: "대화 중 추론했을 뿐 저장 요청은 아님"
      }
    }
  };

  const subjectCriteria: Record<string, string> = {
    none: "대상 없음",
    self: `${clip(context.request.displayName, 40)} (지금 말한 사람)`,
    server: "서버 전체"
  };
  context.request.referencedUsers.forEach((user, index) => {
    subjectCriteria[`u${index + 1}`] = clip(user.displayName, 40);
  });
  questions.memory_subject = {
    type: "choice",
    instructions: "이 기억이 누구 또는 무엇에 관한 것인지 고른다.",
    criteria: subjectCriteria
  };

  if (context.candidates.length > 0) {
    const targetCriteria: Record<string, string> = {
      none: "특정 기억을 수정하거나 삭제하지 않는다"
    };
    for (const candidate of context.candidates) {
      targetCriteria[`m${candidate.memory.id}`] = clip(candidate.memory.content, 80);
    }
    questions.memory_target = {
      type: "choice",
      instructions: "수정하거나 삭제할 기억을 하나 고른다. 해당 없으면 none.",
      criteria: targetCriteria
    };

    for (const candidate of context.candidates) {
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

const nameMapOf = (context: MindContext): Map<string, string> => {
  const names = new Map<string, string>();
  names.set(context.request.userId, context.request.displayName);
  for (const user of context.request.referencedUsers) {
    names.set(user.userId, user.displayName);
  }
  return names;
};

const candidateLabel = (
  candidate: MemoryCandidate,
  names: Map<string, string>
): string => {
  const { memory } = candidate;
  if (memory.scope === "guild") {
    const subject = memory.subjectUserId
      ? names.get(memory.subjectUserId) ?? "사용자"
      : "서버";
    return `m${memory.id} (공용/${memory.category}, 대상 ${subject})`;
  }
  const owner = memory.ownerUserId
    ? names.get(memory.ownerUserId) ?? "다른 사용자"
    : "사용자";
  return `m${memory.id} (개인/${memory.category}, 소유자 ${owner})`;
};

/** Decision 입력. Discord ID는 넣지 않고 표시 이름과 후보 키만 쓴다. */
export const renderState = (context: MindContext): string => {
  const { request, relationship, recent, candidates, conventions } = context;
  const names = nameMapOf(context);
  const lines: string[] = [];

  lines.push("[현재 메시지]");
  lines.push(`보낸 사람: ${request.displayName}`);
  lines.push(`호출 방식: ${request.trigger}`);
  if (request.botWasReplyTarget) {
    lines.push("기니봇의 이전 발언에 답장한 메시지다.");
  } else if (request.replyToAuthorId) {
    const name = names.get(request.replyToAuthorId) ?? "다른 사용자";
    lines.push(`${name}의 메시지에 답장한 메시지다.`);
  }
  lines.push(`내용: ${clip(request.text, 600)}`);
  lines.push("");

  if (request.referencedUsers.length > 0) {
    lines.push("[언급된 사용자]");
    request.referencedUsers.forEach((user, index) => {
      lines.push(`u${index + 1}: ${clip(user.displayName, 60)} (${user.referenceType})`);
    });
    lines.push("");
  }

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

  lines.push("[관계]");
  lines.push(
    `친숙도 ${relationship.familiarity.toFixed(2)}, 라포 ${relationship.rapport.toFixed(2)}, ` +
      `장난 ${relationship.playfulness.toFixed(2)}, 참여 ${relationship.engagement.toFixed(2)}, ` +
      `대화 스타일 ${relationship.communicationStyle}, 상호작용 ${relationship.interactionCount}회`
  );
  if (relationship.boundaries.length > 0) {
    lines.push(
      `명시적 경계: ${relationship.boundaries.map((item) => `"${clip(item, 60)}"`).join(", ")}`
    );
  }
  lines.push("");

  if (conventions.length > 0) {
    lines.push("[적용 호칭]");
    for (const memory of conventions) {
      const name = memory.subjectUserId
        ? names.get(memory.subjectUserId) ?? "사용자"
        : "사용자";
      lines.push(`${name} → "${memory.structuredValue ?? memory.content}"`);
    }
    lines.push("");
  }

  lines.push("[기억 후보]");
  if (candidates.length === 0) {
    lines.push("(없음)");
  } else {
    for (const candidate of candidates) {
      const { memory } = candidate;
      lines.push(
        `${candidateLabel(candidate, names)} (신뢰 ${memory.confidence.toFixed(2)}, ` +
          `중요도 ${memory.importance.toFixed(2)}): ${clip(memory.content, 160)}`
      );
    }
  }

  return lines.join("\n");
};

export const MEMORY_QUESTION_KEYS = [
  "memory_scope",
  "memory_category",
  "memory_visibility",
  "memory_subject",
  "memory_requires_approval",
  "memory_write_intent"
] as const;

export const MEMORY_KEYS = {
  scopes: MEMORY_SCOPES,
  categories: MEMORY_CATEGORIES,
  visibilities: MEMORY_VISIBILITIES
} as const;
