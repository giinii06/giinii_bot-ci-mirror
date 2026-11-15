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

const MAX_REFERENCED = 5;

const stripLabel = (value: string): string =>
  value.replace(/\s*\(@[\w.]+\)/g, "").replace(/^@/, "").trim();

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
 */
export const resolveReferencedUsers = (input: IdentityInput): ReferencedUser[] => {
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

  // 같은 이름을 쓰는 사용자가 둘 이상이면 아무도 고르지 않는다.
  const byName = new Map<string, Set<string>>();
  for (const entry of input.roster) {
    if (ignored.has(entry.userId)) continue;
    for (const name of namesOf(entry)) {
      const users = byName.get(name) ?? new Set<string>();
      users.add(entry.userId);
      byName.set(name, users);
    }
  }

  for (const [name, users] of byName) {
    if (users.size !== 1) continue;
    if (!input.text.includes(name)) continue;
    const userId = [...users][0];
    if (!userId) continue;
    const entry = input.roster.find((candidate) => candidate.userId === userId);
    if (!entry) continue;
    upsert(found, {
      userId,
      displayName: stripLabel(entry.displayName),
      referenceType: "name",
      confidence: 0.6
    });
  }

  return [...found.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_REFERENCED);
};
