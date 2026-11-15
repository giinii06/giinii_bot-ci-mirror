import type {
  MemoryDecision,
  MindAction,
  MindContext,
  MindGoal
} from "./types.js";
import type { DecisionDraft } from "./decision/parser.js";

const REJECTION = /(하지\s*마|하지마|그만|싫어|기분\s*나빠|선\s*넘|무례|불쾌)/;
const DISTRESS =
  /(힘들|우울|슬퍼|지쳐|포기|아무것도\s*하기\s*싫|외로워|불안|속상|망했|망한|짜증|울고\s*싶)/;
const EXPLICIT_ADD = /(기억해|기억해줘|기억해\s*줘|메모해|외워)/;
const EXPLICIT_DELETE = /(잊어|잊어줘|잊어\s*줘|지워|삭제해)/;
const NICKNAME_REQUEST = /(?:이라고|라고)\s*(?:불러|부르)/;
const QUESTION =
  /(\?|까\s*$|나요\s*$|죠\s*$|어때|뭐야|뭐지|왜|어디|언제|누구|어떻게|알려줘)/;
const BANTER = /(멍청|바보|똥|뭐해|놀려|ㅋㅋ|ㅎㅎ|드립|웃겨)/;

const noMemory = (): MemoryDecision => ({
  operation: "none",
  scope: "none",
  visibility: "private",
  category: "fact",
  subjectUserId: null,
  targetMemoryId: null,
  confidence: 0,
  needsApproval: false,
  explicit: false
});

/**
 * Decision API를 쓸 수 없을 때의 규칙 기반 판단.
 * 공용 기억은 만들지 않는다. 장애가 공용 기억 변경으로 이어지면 안 된다.
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
  let humorStrategy = "light_tease";
  let memory = noMemory();

  if (REJECTION.test(text)) {
    action = "acknowledge";
    goal = "respect_boundary";
    socialContext = "conflict";
    userNeeds = "acknowledgment";
    relationshipSignal = "boundary_set";
    humorStrategy = "none";
  } else if (NICKNAME_REQUEST.test(text)) {
    // 호칭 설정은 공용 기억 판단이 필요하다. 폴백에서는 저장하지 않고 짧게 받아들인다.
    action = "acknowledge";
    goal = "maintain_rapport";
    humorStrategy = "none";
  } else if (EXPLICIT_DELETE.test(text)) {
    action = "acknowledge";
    goal = "respect_boundary";
    memory = {
      ...noMemory(),
      operation: "delete",
      scope: "user",
      subjectUserId: context.request.userId,
      targetMemoryId: selected.length === 1 ? (selected[0] ?? null) : null
    };
    humorStrategy = "none";
  } else if (EXPLICIT_ADD.test(text)) {
    action = "acknowledge";
    goal = "maintain_rapport";
    memory = {
      ...noMemory(),
      operation: "add",
      scope: "user",
      subjectUserId: context.request.userId,
      explicit: true
    };
    humorStrategy = "none";
  } else if (DISTRESS.test(text)) {
    action = "comfort";
    goal = "support_user";
    socialContext = "supportive";
    userNeeds = "comfort";
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
  }

  if (context.relationship.playfulness < 0.2 && action === "light_banter") {
    action = "acknowledge";
    humorStrategy = "none";
  }

  return {
    intent: "unclear",
    socialContext,
    relationshipSignal,
    userNeeds,
    goal,
    action,
    humorStrategy,
    needsWeb: false,
    memory,
    selectedMemoryIds: selected,
    confidence: 0
  };
};
