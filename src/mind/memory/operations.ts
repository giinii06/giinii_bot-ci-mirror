import type {
  MemoryActor,
  MemoryDecision,
  MemoryOperationResult,
  MemoryVisibility,
  ReferencedUser
} from "../types.js";
import { extractMemory, factOf, type ExtractedMemoryFact } from "./extractor.js";
import { validateNickname } from "./policy.js";
import type { MindMemoryStore } from "./store.js";

export type MemoryCommitInput = {
  actor: MemoryActor;
  messageId: string;
  channelId: string;
  text: string;
  decision: MemoryDecision;
  referencedUsers: ReferencedUser[];
  ambiguousUserNames?: string[];
  authorDisplayName: string;
  autoMemory: boolean;
};

const empty = (
  status: MemoryOperationResult["status"],
  reason: string | null = null
): MemoryOperationResult => ({
  status,
  added: [],
  updated: [],
  removed: [],
  reason
});

const success = (
  added: string[] = [],
  updated: string[] = [],
  removed: string[] = []
): MemoryOperationResult => ({
  status: "success",
  added,
  updated,
  removed,
  reason: null
});

export type ScopeInput = {
  actorUserId: string;
  relatedUserIds: string[];
  involvesOtherUser?: boolean;
  modelScope: "user" | "guild" | "none";
};

/**
 * 저장 범위의 최종 결정은 모델이 아니라 이 함수가 한다.
 * 기억 내용에 다른 사용자가 조금이라도 관련되면 개인 범위로 남길 수 없다.
 */
export const resolveMemoryScope = (
  input: ScopeInput
): "user" | "guild" | "none" => {
  const hasOtherUser =
    input.involvesOtherUser === true ||
    input.relatedUserIds.some((id) => id !== input.actorUserId);

  if (hasOtherUser) return "guild";
  if (input.modelScope === "guild") return "guild";
  // 명확한 사실로 판단된 경우 none은 개인 기억 후보로 다시 읽는다.
  return "user";
};

const saveNickname = (
  store: MindMemoryStore,
  input: MemoryCommitInput,
  fact: ExtractedMemoryFact
): MemoryOperationResult => {
  if (!fact.primarySubjectId) {
    return empty("needs_confirmation", "누구의 별명인지 분명하지 않습니다");
  }
  if (!fact.structuredValue) {
    return empty("needs_confirmation", "별명을 분명히 알려주세요");
  }

  const validation = validateNickname(fact.structuredValue);
  if (!validation.ok) return empty("blocked", validation.reason);

  const existing = store.findGuildNickname(fact.primarySubjectId);
  if (existing?.structuredValue?.toLowerCase() === validation.value.toLowerCase()) {
    return empty("none", "이미 같은 별명이 있습니다");
  }

  const saved = store.replaceGuildNickname({
    subjectUserId: fact.primarySubjectId,
    nickname: validation.value,
    content: fact.content,
    actorUserId: input.actor.userId,
    sourceMessageId: input.messageId,
    sourceChannelId: input.channelId,
    source: "natural_language"
  });
  if (!saved) return empty("failed", "별명을 저장하지 못했습니다");
  return existing ? success([], [saved.content]) : success([saved.content]);
};

const updateMemory = (
  store: MindMemoryStore,
  input: MemoryCommitInput
): MemoryOperationResult => {
  const { actor, decision } = input;
  if (decision.targetMemoryId === null) {
    return empty("needs_confirmation", "수정할 기억을 하나로 특정하지 못했습니다");
  }

  const target = store.byId(decision.targetMemoryId);
  if (!target) return empty("failed", "수정할 기억을 찾지 못했습니다");

  if (target.scope === "user") {
    if (target.ownerUserId !== actor.userId) {
      return empty("blocked", "다른 사람의 개인 기억은 수정할 수 없습니다");
    }
    const updated = store.updatePersonal(target.id, actor.userId, factOf(input.text));
    if (!updated) return empty("failed", "기억을 수정하지 못했습니다");
    return success([], [updated.content]);
  }

  if (!actor.isAdministrator) {
    return empty("blocked", "공용 기억 수정은 관리자만 할 수 있습니다");
  }
  const updated = store.updateGuild(target.id, actor, {
    content: factOf(input.text),
    structuredValue: target.structuredValue
  });
  if (!updated) return empty("failed", "공용 기억을 수정하지 못했습니다");
  return success([], [updated.content]);
};

const deleteMemory = (input: MemoryCommitInput): MemoryOperationResult => {
  if (input.decision.scope === "guild") {
    if (input.decision.category === "nickname") {
      return empty(
        "blocked",
        "공용 별명은 /shared-memory nickname 또는 delete 슬래시 명령으로만 관리합니다"
      );
    }
    return empty(
      "blocked",
      "공용 기억은 /shared-memory delete 슬래시 명령으로만 지울 수 있습니다"
    );
  }
  return empty(
    "blocked",
    "자연어로는 기억을 삭제할 수 없습니다. /memory delete 슬래시 명령을 써야 합니다"
  );
};

/**
 * 기억 변경은 Decision의 의도와 TypeScript의 검증을 함께 통과해야 한다.
 * 저장 범위·대상·공개 여부는 모델이 아니라 이 함수가 확정한다.
 */
export const commitMemoryOperation = (
  store: MindMemoryStore,
  input: MemoryCommitInput
): MemoryOperationResult => {
  const { actor, decision } = input;

  if (decision.operation === "unclear") {
    return empty("needs_confirmation", "어떤 기억을 말하는지 분명하지 않습니다");
  }
  if (decision.operation === "update") return updateMemory(store, input);
  if (decision.operation === "delete") return deleteMemory(input);

  const facts = extractMemory({
    text: input.text,
    category: decision.category,
    subjectUserId: decision.subjectUserId,
    referencedUsers: input.referencedUsers,
    ambiguousUserNames: input.ambiguousUserNames,
    authorId: actor.userId,
    authorDisplayName: input.authorDisplayName,
    worthiness: decision.memoryWorthiness,
    explicit: decision.explicit,
    operation: decision.operation,
    decisionScope: decision.scope
  });

  const added: string[] = [];
  const updated: string[] = [];
  let duplicate = false;
  let issue: { status: "blocked" | "failed" | "needs_confirmation"; reason: string } | null =
    null;

  for (const fact of facts) {
    if (!fact.isDurableFact) continue;

    const explicit = decision.explicit || fact.isExplicit;
    if (!explicit && !input.autoMemory) continue;

    if (fact.isNickname) {
      const result = saveNickname(store, input, fact);
      if (result.status === "success") {
        added.push(...result.added);
        updated.push(...result.updated);
      } else if (result.status === "none") {
        duplicate = true;
      } else if (result.reason) {
        issue ??= { status: result.status, reason: result.reason };
      }
      continue;
    }

    const scope = resolveMemoryScope({
      actorUserId: actor.userId,
      relatedUserIds: fact.relatedUserIds,
      involvesOtherUser: fact.involvesOtherUser,
      modelScope: fact.decisionScope
    });
    if (scope === "none") continue;

    if (scope === "guild") {
      const saved = store.addGuild({
        createdByUserId: actor.userId,
        category: fact.category,
        subjectUserId: fact.primarySubjectId,
        relatedUserIds: fact.relatedUserIds,
        content: fact.content,
        confidence: fact.confidence,
        importance: explicit ? 0.7 : 0.5,
        sourceMessageId: input.messageId,
        sourceChannelId: input.channelId,
        source: "natural_language"
      });
      if (saved) added.push(saved.content);
      else duplicate = true;
      continue;
    }

    const category =
      fact.category === "nickname" || fact.category === "server_convention"
        ? "preference"
        : fact.category;
    const saved = store.addPersonal({
      ownerUserId: actor.userId,
      createdByUserId: actor.userId,
      content: fact.content,
      category,
      visibility: decision.visibility,
      confidence: fact.confidence,
      importance: explicit ? 0.7 : 0.5,
      sourceMessageId: input.messageId,
      sourceChannelId: input.channelId
    });
    if (saved) added.push(saved.content);
    else duplicate = true;
  }

  if (added.length === 0 && updated.length === 0) {
    if (issue) return empty(issue.status, issue.reason);
    return empty("none", duplicate ? "이미 같은 내용이 저장돼 있습니다" : null);
  }

  return {
    status: "success",
    added,
    updated,
    removed: [],
    reason: issue?.reason ?? null
  };
};

export const describeMemoryResult = (result: MemoryOperationResult): string => {
  if (result.status === "none") return "이번 턴에는 기억을 바꾸지 않았다.";
  if (result.status === "needs_confirmation") {
    return `기억을 바꾸지 않았다. ${result.reason ?? "대상이 불분명하다"}. 어떤 기억인지 되물어야 한다.`;
  }
  if (result.status === "failed") {
    return `기억 변경에 실패했다. ${result.reason ?? ""}. 성공했다고 말하지 않는다.`;
  }
  if (result.status === "blocked") {
    return `기억을 바꾸지 않았다. ${result.reason ?? "권한이 없다"}. 바꿨다고 말하지 않는다.`;
  }

  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`저장: ${result.added.join(" / ")}`);
  if (result.updated.length > 0) parts.push(`수정: ${result.updated.join(" / ")}`);
  if (result.removed.length > 0) parts.push(`삭제: ${result.removed.join(" / ")}`);
  return `실제로 반영된 기억 변경이다. ${parts.join(" · ")}`;
};

export const visibilityLabel = (visibility: MemoryVisibility): string =>
  visibility === "shareable" ? "공유 가능" : "비공개";
