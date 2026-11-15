import type { MemoryCategory, ReferencedUser } from "../types.js";

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

export type ExtractedMemory = {
  category: MemoryCategory;
  subjectUserId: string | null;
  content: string;
  structuredValue: string | null;
  sourceText: string;
  isExplicit: boolean;
  extractionConfidence: number;
};

export type ExtractInput = {
  text: string;
  category: MemoryCategory;
  subjectUserId: string | null;
  referencedUsers: ReferencedUser[];
  authorId: string;
  authorDisplayName: string;
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

/**
 * 정규식과 Discord 사용자 정보만으로 기억 후보를 뽑는다.
 * 별명 요청은 대상과 값을 구조화하고, 그 밖의 요청은 "기억해"를 뗀 문장을 쓴다.
 */
export const extractMemory = (input: ExtractInput): ExtractedMemory | null => {
  const nickname = nicknameOf(input.text);
  if (nickname) {
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

    return {
      category: "nickname",
      subjectUserId,
      content: `${display}의 별명은 "${nickname.nickname}"이다.`,
      structuredValue: nickname.nickname,
      sourceText: input.text,
      isExplicit: true,
      extractionConfidence: subjectUserId ? 0.9 : 0.6
    };
  }

  if (input.category === "nickname") return null;

  return {
    category: input.category,
    subjectUserId: input.subjectUserId,
    content: factOf(input.text),
    structuredValue: null,
    sourceText: input.text,
    isExplicit: EXPLICIT_CUE.test(input.text),
    extractionConfidence: 0.7
  };
};
