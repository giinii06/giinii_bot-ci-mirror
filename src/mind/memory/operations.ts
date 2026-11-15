import type {
  MemoryActor,
  MemoryDecision,
  MemoryOperationResult,
  MemoryVisibility,
  ReferencedUser
} from "../types.js";
import type { BotUserRelationshipStore } from "../relationship/store.js";
import { EXPLICIT_CUE, extractMemory, factOf } from "./extractor.js";
import { SENSITIVE, guildApprovalFor, validateNickname } from "./policy.js";
import type { MindMemoryStore } from "./store.js";

export type MemoryCommitInput = {
  actor: MemoryActor;
  messageId: string;
  channelId: string;
  text: string;
  decision: MemoryDecision;
  referencedUsers: ReferencedUser[];
  authorDisplayName: string;
  autoMemory: boolean;
  guildAutoNickname: boolean;
  guildApprovalRequired: boolean;
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

const pending = (content: string, reason: string): MemoryOperationResult => ({
  status: "pending",
  added: [content],
  updated: [],
  removed: [],
  reason
});

/**
 * 기억 변경은 Decision의 의도와 TypeScript의 검증을 함께 통과해야 한다.
 * 저장 범위·대상·공개 여부·권한은 모델이 아니라 이 함수가 확정한다.
 */
export const commitMemoryOperation = (
  store: MindMemoryStore,
  relationship: BotUserRelationshipStore,
  input: MemoryCommitInput
): MemoryOperationResult => {
  const { actor, decision } = input;

  if (decision.operation === "none") return empty("none");
  if (decision.operation === "unclear") {
    return empty("needs_confirmation", "어떤 기억을 말하는지 분명하지 않습니다");
  }

  const extracted = extractMemory({
    text: input.text,
    category: decision.category,
    subjectUserId: decision.subjectUserId,
    referencedUsers: input.referencedUsers,
    authorId: actor.userId,
    authorDisplayName: input.authorDisplayName
  });
  const fact = extracted?.content ?? factOf(input.text);
  const explicit =
    decision.explicit || extracted?.isExplicit === true || EXPLICIT_CUE.test(input.text);

  if (decision.operation === "add") {
    if (decision.scope === "none") return empty("none");

    if (decision.scope === "user") {
      const subject = decision.subjectUserId ?? actor.userId;
      if (subject !== actor.userId) {
        return empty("blocked", "다른 사람의 개인 기억은 저장할 수 없습니다");
      }
      if (!explicit && !input.autoMemory) return empty("none");
      if (!explicit && SENSITIVE.test(fact)) return empty("none");

      const category =
        decision.category === "nickname" || decision.category === "server_convention"
          ? "preference"
          : decision.category;
      const content =
        extracted?.category === "nickname" && extracted.structuredValue
          ? `나의 선호 호칭은 "${extracted.structuredValue}"이다.`
          : fact;

      const saved = store.addPersonal({
        ownerUserId: actor.userId,
        createdByUserId: actor.userId,
        content,
        category,
        visibility: decision.visibility,
        confidence: explicit ? 0.9 : 0.7,
        importance: explicit ? 0.7 : 0.5,
        sourceMessageId: input.messageId,
        sourceChannelId: input.channelId
      });
      if (!saved) return empty("none", "이미 같은 내용이 저장돼 있습니다");
      return success([saved.content]);
    }

    // 공용 기억은 명시적인 요청 없이는 만들지 않는다.
    if (!explicit) return empty("none");
    if (SENSITIVE.test(fact)) {
      return empty("blocked", "민감한 내용은 공용 기억으로 저장할 수 없습니다");
    }

    const category = extracted?.category ?? decision.category;
    if (category === "nickname") {
      return addNickname(store, input, extracted?.content ?? fact, extracted?.structuredValue ?? null);
    }

    const approval = guildApprovalFor({
      isAdministrator: actor.isAdministrator,
      category,
      autoNickname: input.guildAutoNickname,
      approvalRequired: input.guildApprovalRequired
    });
    const saved = store.addGuild({
      createdByUserId: actor.userId,
      category,
      subjectUserId: decision.subjectUserId,
      content: fact,
      approval,
      confidence: explicit ? 0.9 : 0.7,
      importance: explicit ? 0.7 : 0.5,
      sourceMessageId: input.messageId,
      sourceChannelId: input.channelId,
      source: "natural_language"
    });
    if (!saved) return empty("none", "이미 같은 내용이 저장돼 있습니다");
    return saved.approval === "pending"
      ? pending(saved.content, "관리자 승인을 기다립니다")
      : success([saved.content]);
  }

  if (decision.operation === "update") {
    if (decision.targetMemoryId === null) {
      return empty("needs_confirmation", "수정할 기억을 하나로 특정하지 못했습니다");
    }
    const target = store.byId(decision.targetMemoryId);
    if (!target) return empty("failed", "수정할 기억을 찾지 못했습니다");

    if (target.scope === "user") {
      if (target.ownerUserId !== actor.userId) {
        return empty("blocked", "다른 사람의 개인 기억은 수정할 수 없습니다");
      }
      const updated = store.updatePersonal(
        target.id,
        actor.userId,
        extracted?.content ?? factOf(input.text)
      );
      if (!updated) return empty("failed", "기억을 수정하지 못했습니다");
      return success([], [updated.content]);
    }

    if (actor.isAdministrator) {
      const updated = store.updateGuild(target.id, actor, {
        content: extracted?.content ?? fact,
        structuredValue: extracted?.structuredValue ?? target.structuredValue
      });
      if (!updated) return empty("failed", "공용 기억을 수정하지 못했습니다");
      return success([], [updated.content]);
    }

    if (!explicit) return empty("none");
    const proposed = store.addGuild({
      createdByUserId: actor.userId,
      category: target.category,
      subjectUserId: target.subjectUserId,
      content: extracted?.content ?? fact,
      structuredValue: extracted?.structuredValue ?? target.structuredValue,
      approval: "pending",
      sourceMessageId: input.messageId,
      sourceChannelId: input.channelId,
      source: "natural_language"
    });
    return proposed
      ? pending(proposed.content, "관리자 승인을 기다립니다")
      : empty("none", "이미 처리 중인 요청이 있습니다");
  }

  // delete
  if (decision.scope === "guild" && decision.category === "nickname") {
    const active = store.findGuildNickname(actor.userId);
    const targetsSelf =
      decision.subjectUserId === actor.userId || decision.subjectUserId === null;
    if (active && targetsSelf) {
      const released = store.releaseGuildNickname(actor.userId, actor.userId);
      if (released) {
        relationship.recordBoundary(actor.userId, input.text);
        return success([], [], [released.content]);
      }
    }
    return empty("none", "적용 중인 별명이 없습니다");
  }

  if (decision.scope === "guild") {
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

const addNickname = (
  store: MindMemoryStore,
  input: MemoryCommitInput,
  content: string,
  rawNickname: string | null
): MemoryOperationResult => {
  const { actor, decision } = input;
  const subject = decision.subjectUserId;
  if (!subject) return empty("needs_confirmation", "누구의 별명인지 분명하지 않습니다");
  if (!rawNickname) return empty("needs_confirmation", "별명을 분명히 알려주세요");

  const validation = validateNickname(rawNickname);
  if (!validation.ok) return empty("blocked", validation.reason);
  const nickname = validation.value;

  const rejection = store.findNicknameRejection(subject, nickname);
  if (rejection) return empty("blocked", "대상 사용자가 그 호칭을 거부했습니다");

  const existing = store.findGuildNickname(subject);
  if (existing) {
    if (existing.structuredValue?.toLowerCase() === nickname.toLowerCase()) {
      return empty("none", "이미 같은 별명이 있습니다");
    }
    if (actor.isAdministrator) {
      const updated = store.updateGuild(existing.id, actor, {
        content,
        structuredValue: nickname,
        subjectUserId: subject
      });
      return updated
        ? success([], [updated.content])
        : empty("failed", "별명을 바꾸지 못했습니다");
    }

    // 일반 사용자의 기존 별명 변경은 관리자 승인을 받는다.
    const proposed = store.addGuild({
      createdByUserId: actor.userId,
      category: "nickname",
      subjectUserId: subject,
      content,
      structuredValue: nickname,
      approval: "pending",
      sourceMessageId: input.messageId,
      sourceChannelId: input.channelId,
      source: "natural_language"
    });
    return proposed
      ? pending(proposed.content, "관리자 승인을 기다립니다")
      : empty("none", "이미 처리 중인 요청이 있습니다");
  }

  const approval = guildApprovalFor({
    isAdministrator: actor.isAdministrator,
    category: "nickname",
    autoNickname: input.guildAutoNickname,
    approvalRequired: input.guildApprovalRequired
  });
  const saved = store.addGuild({
    createdByUserId: actor.userId,
    category: "nickname",
    subjectUserId: subject,
    content,
    structuredValue: nickname,
    approval,
    confidence: 0.9,
    importance: 0.7,
    sourceMessageId: input.messageId,
    sourceChannelId: input.channelId,
    source: "natural_language"
  });
  if (!saved) return empty("none", "이미 같은 별명이 있습니다");
  return saved.approval === "pending"
    ? pending(saved.content, "관리자 승인을 기다립니다")
    : success([saved.content]);
};

export const describeMemoryResult = (result: MemoryOperationResult): string => {
  if (result.status === "none") return "이번 턴에는 기억을 바꾸지 않았다.";
  if (result.status === "needs_confirmation") {
    return `기억을 바꾸지 않았다. ${result.reason ?? "대상이 불분명하다"}. 어떤 기억인지 되물어야 한다.`;
  }
  if (result.status === "pending") {
    return `기억을 바로 반영하지 않고 관리자 승인 대기로 남겼다. ${result.reason ?? ""}. 승인 전에는 저장됐다고 말하지 않는다.`;
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
