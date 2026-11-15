import type { ReferencedUser } from "./types.js";

export type RosterEntry = {
  userId: string;
  displayName: string;
  aliases?: string[];
};

export type IdentityInput = {
  authorId: string;
  botId: string;
  text: string;
  mentions: RosterEntry[];
  replyTo: RosterEntry | null;
  /** 최근 대화 작성자와 길드 멤버 캐시에서 모은 후보. */
  roster: RosterEntry[];
};

export type ResolvedReferences = {
  users: ReferencedUser[];
  /** 이름이 겹쳐 한 명으로 정할 수 없지만 본문에 등장한 표시 이름. */
  ambiguousNames: string[];
};

const MAX_REFERENCED = 5;

const stripLabel = (value: string): string =>
  value.replace(/\s*\(@[\w.]+\)/g, "").replace(/^@/, "").trim();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 한국어 조사가 이름에 바로 붙어도 이름 언급으로 인식한다. */
const PARTICLES = [
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "에서",
  "에게",
  "한테",
  "께",
  "께서",
  "랑",
  "이랑",
  "와",
  "과",
  "도",
  "만",
  "보다",
  "처럼",
  "같이",
  "으로",
  "로",
  "이라고",
  "라고",
  "이라는",
  "라는",
  "아",
  "야",
  "님",
  "씨"
].sort((a, b) => b.length - a.length);

const PARTICLE_PATTERN = PARTICLES.join("|");

/**
 * 이름이 단어 중간에 우연히 들어간 경우와, 조사·서술어가 붙은 경우를 구분한다.
 * 예: "빅시는"은 언급이고 "빅시티"는 언급이 아니다.
 */
export const mentionsName = (text: string, name: string): boolean => {
  const trimmed = stripLabel(name);
  if (trimmed.length < 2) return false;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}]|(?:${PARTICLE_PATTERN}))`,
    "iu"
  );
  return pattern.test(text);
};

const namesOf = (entry: RosterEntry): string[] =>
  [entry.displayName, ...(entry.aliases ?? [])]
    .map(stripLabel)
    .filter((name) => name.length >= 2);

const upsert = (
  found: Map<string, ReferencedUser>,
  user: ReferencedUser
): void => {
  const current = found.get(user.userId);
  if (!current || current.confidence < user.confidence) {
    found.set(user.userId, user);
  }
};

/**
 * 표시 이름만 보고 사용자 ID를 새로 만들지 않는다.
 * Discord가 준 멘션·답장 정보와, 캐시에서 확인한 정확한 이름 일치만 쓴다.
 * 같은 이름을 쓰는 사용자가 둘 이상이면 ID를 고르지 않고 이름만 남긴다.
 */
export const resolveReferencedUsers = (input: IdentityInput): ResolvedReferences => {
  const found = new Map<string, ReferencedUser>();
  const ignored = new Set([input.authorId, input.botId]);

  for (const entry of input.mentions) {
    if (ignored.has(entry.userId)) continue;
    upsert(found, {
      userId: entry.userId,
      displayName: stripLabel(entry.displayName),
      referenceType: "mention",
      confidence: 1
    });
  }

  if (input.replyTo && !ignored.has(input.replyTo.userId)) {
    upsert(found, {
      userId: input.replyTo.userId,
      displayName: stripLabel(input.replyTo.displayName),
      referenceType: "reply",
      confidence: 0.9
    });
  }

  const byName = new Map<string, Set<string>>();
  for (const entry of input.roster) {
    for (const name of namesOf(entry)) {
      const users = byName.get(name) ?? new Set<string>();
      users.add(entry.userId);
      byName.set(name, users);
    }
  }

  const ambiguousNames = new Set<string>();
  for (const [name, users] of byName) {
    if (!mentionsName(input.text, name)) continue;
    if (users.size !== 1) {
      ambiguousNames.add(name);
      continue;
    }

    const userId = [...users][0];
    if (!userId || ignored.has(userId)) continue;
    const entry = input.roster.find((candidate) => candidate.userId === userId);
    if (!entry) continue;
    upsert(found, {
      userId,
      displayName: stripLabel(entry.displayName),
      referenceType: "name",
      confidence: 0.6
    });
  }

  return {
    users: [...found.values()]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_REFERENCED),
    ambiguousNames: [...ambiguousNames]
  };
};
