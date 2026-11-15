import { mentionsName } from "../identity-resolver.js";
import type { MemoryCategory, MemoryOperation, ReferencedUser } from "../types.js";

/** 사용자가 직접 요청한 경우. 자동 저장이 꺼져 있어도 이 표현이 있으면 저장한다. */
export const EXPLICIT_CUE = /(기억해|기억해줘|기억해\s*줘|잊어|잊어줘|까먹지|메모해|외워)/;

const REQUEST_TAIL =
  /[\s,.!?~]*(?:기억해\s*줘|기억해줘|기억해|잊어\s*줘|잊어줘|잊어|까먹지\s*마|메모해\s*줘|메모해|저장해\s*줘|저장해|외워\s*줘|외워)[\s.!?~]*$/;

const NICKNAME_PATTERNS: RegExp[] = [
  /(?:앞으로|이제부터|이제|당분간)\s*(?<target>.+?)\s*(?:을|를|은|는|이|가)\s*(?<nick>.+?)(?:이라고|라고)\s*(?:불러|부르)/,
  /(?<target>[^\s]+)\s*(?:을|를)\s*(?<nick>.+?)(?:이라고|라고)\s*(?:불러|부르)/,
  /(?<target>[^\s]+)\s*(?:은|는|이|가)\s*(?<nick>.+?)(?:이라고|라고)\s*(?:불러|부르)/
];

const SELF_NAMES = new Set(["나", "저", "내", "제", "나를", "저를", "내가", "제가"]);

const SELF_PRONOUN =
  /(^|\s)(나|저|내|제)(는|가|를|의|한테|에게|랑|이랑|와|과|도|만|야|이|가)?(?=\s|$|[,.!?~])/;
const THIRD_PERSON = /(걔|쟤|얘|그\s*사람|그분|저\s*사람|저분|이\s*사람|이분)/;
const QUESTION = /\?|(?:어디|언제|누구|왜|어떻게|뭐야|뭐지|알려줘|맞아|맞지|나요|죠|을까|ㄹ까)\s*[.!?~]*$/;
const QUESTION_WORD = /(어디|언제|누구|왜|어떻게|뭐야|뭐지|알려줘|맞아|맞지)/;
const REACTION =
  /^(안녕|하이|헬로|ㅎㅎ+|ㅋㅋ+|와+|헐|대박|진짜|맞아|그래|오케이|ok|굿|좋아|싫어|웃겨|귀여워|멋져|최고|고마워|땡큐)[\s.!?~]*$/i;
const TEMPORARY =
  /((오늘|지금|방금|아까|내일|모레|이따|좀|너무)\s*(날씨|기분|배고|배불|졸|피곤|심심|바빠|추워|더워|좋다|나쁘다|행복|슬퍼|우울)|날씨가?\s*(좋|나쁘|맑|흐|춥|덥))/;
const PURE_STATE =
  /^(배고파|배불러|졸려|피곤해|심심해|바빠|추워|더워|좋다|나쁘다|행복해|슬퍼|우울해|화나|짜증나)[\s.!?~]*$/;
const PRONOUN_ONLY =
  /^(이거|그거|저거|이것|그것|저것|이게|그게|저게|여기|거기|저기)[\s.!?~]*$/;
const CUE_ONLY =
  /^(기억해|기억해줘|기억해\s*줘|메모해|외워|잊어|잊어줘|까먹지\s*마)[\s.!?~]*$/;
const SELF_FACT =
  /(살아|살고|사는|이야|야|좋아해|싫어해|좋아한다|싫어한다|공부해|공부한다|일해|일한다|다녀|다닌다|키워|키운다|생일|취미|직업|나이|고양이|강아지|마셔|먹어|안\s*마셔|안\s*먹어|해|했어|할\s*거야|할거야|싶어|같아|있어|없어)/;
const PREDICATE =
  /(다|요|어|아|지|네|야|해|했어|했지|거야|래|대|줘|봤어|갔어|왔어|살아|있어|없어|같아|싶어|좋아|싫어|잘해|못해)[\s.!?~]*$/;

export type ExtractedMemoryFact = {
  content: string;
  category: MemoryCategory;

  relatedUserIds: string[];
  primarySubjectId: string | null;
  subjectDisplayName: string | null;
  involvesOtherUser: boolean;

  isDurableFact: boolean;
  decisionScope: "user" | "guild" | "none";

  structuredValue: string | null;
  isNickname: boolean;
  sourceText: string;
  confidence: number;
  isExplicit: boolean;
};

export type ExtractInput = {
  text: string;
  category: MemoryCategory;
  subjectUserId: string | null;
  referencedUsers: ReferencedUser[];
  ambiguousUserNames?: string[];
  authorId: string;
  authorDisplayName: string;
  /** Decision이 판단한 기억 가치. 0.5 이상이면 저장 후보로 본다. */
  worthiness?: number;
  /** Decision이 명시적 저장 요청으로 판단했는지. 문장에 요청 표현이 없어도 인정한다. */
  explicit?: boolean;
  operation?: MemoryOperation;
  decisionScope?: "user" | "guild" | "none";
};

/** 저장할 문장에서 "기억해" 같은 요청 표현만 떼고 나머지는 원문을 살린다. */
export const factOf = (text: string): string => {
  const trimmed = text.trim();
  const stripped = trimmed.replace(REQUEST_TAIL, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
};

const stripLabel = (value: string): string =>
  value.replace(/\s*\(@[\w.]+\)/g, "").replace(/^@/, "").trim();

const normalizeName = (value: string): string => stripLabel(value).toLowerCase();

const cleanNickname = (value: string): string =>
  value
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/[\s.!?~,]+$/g, "")
    .trim();

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

const resolveSubject = (
  target: string,
  referencedUsers: ReferencedUser[],
  authorId: string
): string | null => {
  const mention = target.trim().match(/^<@!?(\d+)>$/);
  if (mention) return mention[1] ?? null;

  const normalized = normalizeName(target);
  if (!normalized) return null;
  if (SELF_NAMES.has(normalized)) return authorId;

  const exact = referencedUsers.filter(
    (user) => normalizeName(user.displayName) === normalized
  );
  if (exact.length === 1) return exact[0]?.userId ?? null;

  // 표시 이름 일부만 불러도 한 사람으로만 특정되면 받아들인다.
  if (normalized.length < 2) return null;
  const partial = referencedUsers.filter((user) => {
    const name = normalizeName(user.displayName);
    return name.length >= 2 && (normalized.includes(name) || name.includes(normalized));
  });
  return partial.length === 1 ? (partial[0]?.userId ?? null) : null;
};

const nicknameOf = (
  text: string
): { target: string; nickname: string } | null => {
  for (const pattern of NICKNAME_PATTERNS) {
    const match = pattern.exec(text);
    const target = match?.groups?.target?.trim();
    const nickname = cleanNickname(match?.groups?.nick ?? "");
    if (target && nickname) return { target, nickname };
  }
  return null;
};

const displayNameOf = (
  subjectUserId: string | null,
  target: string,
  referencedUsers: ReferencedUser[],
  authorDisplayName: string,
  authorId: string
): string => {
  if (subjectUserId) {
    if (subjectUserId === authorId) return stripLabel(authorDisplayName) || "사용자";
    const found = referencedUsers.find((user) => user.userId === subjectUserId);
    if (found) return stripLabel(found.displayName);
  }
  return stripLabel(target) || "사용자";
};

const startsWithSubject = (text: string, names: string[]): boolean =>
  SELF_PRONOUN.test(text) ||
  THIRD_PERSON.test(text) ||
  names.some((name) => mentionsName(text, name));

/** 한 메시지에 개인 사실과 타인 사실이 섞여도 각각 따로 처리한다. */
const splitSegments = (text: string, names: string[]): string[] => {
  const sentences = text.replace(/\r\n/g, "\n").split(/(?<=[.!?~])\s+|\n+/);
  const segments: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/,\s*/);
    if (parts.length <= 1) {
      segments.push(trimmed);
      continue;
    }

    let current = parts[0] ?? "";
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      if (startsWithSubject(part, names)) {
        if (current.trim()) segments.push(current.trim());
        current = part;
      } else {
        current = `${current}, ${part}`;
      }
    }
    if (current.trim()) segments.push(current.trim());
  }

  return segments;
};

type SegmentPeople = {
  ids: string[];
  self: boolean;
  ambiguous: boolean;
  third: boolean;
};

const peopleIn = (segment: string, input: ExtractInput): SegmentPeople => {
  const ids: string[] = [];
  for (const user of input.referencedUsers) {
    const mentioned =
      segment.includes(`<@${user.userId}>`) ||
      segment.includes(`<@!${user.userId}>`) ||
      mentionsName(segment, user.displayName);
    if (mentioned) ids.push(user.userId);
  }

  const ambiguous = (input.ambiguousUserNames ?? []).some((name) =>
    mentionsName(segment, name)
  );
  const self = SELF_PRONOUN.test(segment) || mentionsName(segment, input.authorDisplayName);
  const third = THIRD_PERSON.test(segment);

  // "걔"처럼 대상을 이름으로 부르지 않아도 답장·멘션 상대를 주어로 본다.
  if (third) {
    for (const user of input.referencedUsers) {
      if (user.referenceType === "reply" || user.referenceType === "mention") {
        ids.push(user.userId);
      }
    }
  }

  return { ids: unique(ids), self, ambiguous, third };
};

const nicknameFact = (
  segment: string,
  input: ExtractInput
): ExtractedMemoryFact | null => {
  const nickname = nicknameOf(segment);
  if (!nickname) return null;

  const subjectUserId =
    resolveSubject(nickname.target, input.referencedUsers, input.authorId) ??
    (input.subjectUserId === input.authorId ? input.authorId : null);
  const display = displayNameOf(
    subjectUserId,
    nickname.target,
    input.referencedUsers,
    input.authorDisplayName,
    input.authorId
  );
  const ambiguous = (input.ambiguousUserNames ?? []).some((name) =>
    mentionsName(segment, name)
  );

  return {
    content: `${display}의 별명은 "${nickname.nickname}"이다.`,
    category: "nickname",
    relatedUserIds: subjectUserId ? [subjectUserId] : [],
    primarySubjectId: subjectUserId,
    subjectDisplayName: display,
    involvesOtherUser: (subjectUserId !== null && subjectUserId !== input.authorId) || ambiguous,
    isDurableFact: true,
    decisionScope: "guild",
    structuredValue: nickname.nickname,
    isNickname: true,
    sourceText: segment,
    confidence: subjectUserId ? 0.9 : 0.6,
    isExplicit: true
  };
};

const isDurable = (
  segment: string,
  input: ExtractInput,
  people: SegmentPeople,
  explicit: boolean
): boolean => {
  const trimmed = segment.trim();
  if (trimmed.length < 4) return false;
  if (CUE_ONLY.test(trimmed) || PRONOUN_ONLY.test(trimmed)) return false;
  if (QUESTION.test(trimmed)) return false;
  if (QUESTION_WORD.test(trimmed) && trimmed.length < 40) return false;
  if (REACTION.test(trimmed)) return false;

  // 타인이 조금이라도 관련된 진술은 일시적인 표현이어도 공용 기억 후보로 둔다.
  if (people.ids.some((id) => id !== input.authorId) || people.ambiguous || people.third) {
    return true;
  }

  if (TEMPORARY.test(trimmed) || PURE_STATE.test(trimmed)) return false;
  if (explicit) return true;
  if ((input.worthiness ?? 0) >= 0.5 && PREDICATE.test(trimmed)) return true;
  if (SELF_PRONOUN.test(trimmed) && SELF_FACT.test(trimmed)) return true;
  if (input.subjectUserId === input.authorId && PREDICATE.test(trimmed)) return true;
  return false;
};

const categoryOf = (
  input: ExtractInput,
  hasUserSubject: boolean
): MemoryCategory => {
  if (hasUserSubject && (input.category === "nickname" || input.category === "server_convention")) {
    return "fact";
  }
  return input.category;
};

/**
 * 정규식과 Discord 사용자 정보만으로 기억 후보를 뽑는다.
 * 한 메시지를 사실 단위로 나누고, 각 사실에 실제로 등장한 사용자만 붙인다.
 */
export const extractMemory = (input: ExtractInput): ExtractedMemoryFact[] => {
  const names = unique([
    stripLabel(input.authorDisplayName),
    ...input.referencedUsers.map((user) => stripLabel(user.displayName)),
    ...(input.ambiguousUserNames ?? [])
  ]).filter((name) => name.length >= 2);

  const cue = EXPLICIT_CUE.test(input.text);
  const explicit = cue || input.explicit === true;
  const segments = splitSegments(input.text, names);
  const facts: ExtractedMemoryFact[] = [];

  for (const segment of segments) {
    const nickname = nicknameFact(segment, input);
    if (nickname) {
      facts.push(nickname);
      continue;
    }

    const people = peopleIn(segment, input);
    if (!isDurable(segment, input, people, explicit)) continue;

    const otherIds = people.ids.filter((id) => id !== input.authorId);
    const primarySubjectId =
      otherIds[0] ??
      (people.self ? input.authorId : null) ??
      (input.subjectUserId && people.ids.includes(input.subjectUserId)
        ? input.subjectUserId
        : null) ??
      people.ids[0] ??
      null;
    const subjectDisplayName = primarySubjectId
      ? primarySubjectId === input.authorId
        ? stripLabel(input.authorDisplayName) || "나"
        : stripLabel(
            input.referencedUsers.find((user) => user.userId === primarySubjectId)
              ?.displayName ?? ""
          ) || null
      : ((input.ambiguousUserNames ?? []).find((name) =>
          mentionsName(segment, name)
        ) ?? null);
    const involvesOtherUser =
      otherIds.length > 0 || people.ambiguous || people.third;

    facts.push({
      content: factOf(segment),
      category: categoryOf(input, primarySubjectId !== null || subjectDisplayName !== null),
      relatedUserIds: people.ids,
      primarySubjectId,
      subjectDisplayName,
      involvesOtherUser,
      isDurableFact: true,
      decisionScope: input.decisionScope ?? "user",
      structuredValue: null,
      isNickname: false,
      sourceText: segment,
      confidence: involvesOtherUser ? 0.85 : explicit ? 0.9 : 0.75,
      isExplicit: cue
    });
  }

  return facts;
};
