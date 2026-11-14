import type { MemoryOperation, MindAction, MindContext, MindGoal } from "./types.js";
import type { DecisionDraft } from "./decision/parser.js";

const REJECTION = /(하지\s*마|하지마|그만|싫어|기분\s*나빠|선\s*넘|무례|불쾌)/;
const DISTRESS =
  /(힘들|우울|슬퍼|지쳐|포기|아무것도\s*하기\s*싫|외로워|불안|속상|망했|망한|짜증|울고\s*싶)/;
const EXPLICIT_ADD = /(기억해|기억해줘|기억해\s*줘|메모해|외워)/;
const EXPLICIT_DELETE = /(잊어|잊어줘|잊어\s*줘|지워|삭제해)/;
const QUESTION =
  /(\?|까\s*$|나요\s*$|죠\s*$|어때|뭐야|뭐지|왜|어디|언제|누구|어떻게|알려줘)/;
const BANTER = /(멍청|바보|똥|뭐해|놀려|ㅋㅋ|ㅎㅎ|드립|웃겨)/;

/**
 * Decision API를 쓸 수 없을 때의 규칙 기반 판단.
 * 확신이 낮은 상황에서는 놀리지 않고 짧게 받아들이는 쪽으로 기운다.
 */
export const localDecision = (context: MindContext): DecisionDraft => {
  const text = context.request.text;
  const selected = context.candidates
    .filter((candidate) => candidate.matched)
    .slice(0, 5)
    .map((candidate) => candidate.memory.id);

  let action: MindAction = "light_banter";
  let goal: MindGoal = "maintain_rapport";
  let socialContext = "neutral";
  let userNeeds = "acknowledgment";
  let relationshipSignal = "neutral";
  let emotionImpact: DecisionDraft["emotionImpact"] = "neutral";
  let emotionIntensity = 0.3;
  let humorStrategy = "light_tease";
  let memoryOperation: MemoryOperation = "none";
  let memoryTargetId: number | null = null;

  if (REJECTION.test(text)) {
    action = "acknowledge";
    goal = "respect_boundary";
    socialContext = "conflict";
    userNeeds = "acknowledgment";
    relationshipSignal = "boundary_set";
    emotionImpact = "negative";
    emotionIntensity = 0.6;
    humorStrategy = "none";
  } else if (EXPLICIT_DELETE.test(text)) {
    action = "acknowledge";
    goal = "respect_boundary";
    memoryOperation = "delete";
    memoryTargetId = selected.length === 1 ? (selected[0] ?? null) : null;
    humorStrategy = "none";
  } else if (EXPLICIT_ADD.test(text)) {
    action = "acknowledge";
    goal = "maintain_rapport";
    memoryOperation = "add";
    humorStrategy = "none";
  } else if (DISTRESS.test(text)) {
    action = "comfort";
    goal = "support_user";
    socialContext = "supportive";
    userNeeds = "comfort";
    emotionImpact = "negative";
    emotionIntensity = 0.5;
    humorStrategy = "none";
  } else if (QUESTION.test(text)) {
    action = "answer";
    goal = "provide_information";
    userNeeds = "information";
    humorStrategy = "none";
  } else if (BANTER.test(text)) {
    action = "light_banter";
    goal = "entertain";
    socialContext = "friendly_banter";
    userNeeds = "humor";
    relationshipSignal = "playful";
    emotionImpact = "positive";
    emotionIntensity = 0.4;
  }

  if (context.relationship.playfulness < 0.2 && action === "light_banter") {
    action = "acknowledge";
    humorStrategy = "none";
  }

  return {
    intent: "unclear",
    socialContext,
    emotionImpact,
    emotionIntensity,
    relationshipSignal,
    userNeeds,
    goal,
    action,
    humorStrategy,
    needsWeb: false,
    memoryOperation,
    memoryTargetId,
    selectedMemoryIds: selected,
    confidence: 0
  };
};
