import type { MemoryOperation, MemoryOperationResult } from "../types.js";
import type { MindMemoryStore } from "./store.js";

/** 사용자가 직접 요청한 경우. 자동 저장이 꺼져 있어도 이 표현이 있으면 저장한다. */
const EXPLICIT_CUE = /(기억해|기억해줘|기억해\s*줘|잊어|잊어줘|까먹지|메모해|외워)/;

/** 민감한 주제는 명시 요청 없이는 자동 저장하지 않는다. */
const SENSITIVE =
  /(병원|질병|우울증|정신과|정치|종교|교회|성당|절에|투표|대통령|국회|약을\s*먹)/;

const REQUEST_TAIL =
  /[\s,.!?~]*(?:기억해\s*줘|기억해줘|기억해|잊어\s*줘|잊어줘|잊어|까먹지\s*마|메모해\s*줘|메모해|저장해\s*줘|저장해|외워\s*줘|외워)[\s.!?~]*$/;

export type MemoryCommitInput = {
  operation: MemoryOperation;
  targetId: number | null;
  userId: string;
  messageId: string;
  text: string;
};

const empty = (status: MemoryOperationResult["status"], reason: string | null = null): MemoryOperationResult => ({
  status,
  added: [],
  updated: [],
  removed: [],
  reason
});

/** 저장할 문장에서 "기억해" 같은 요청 표현만 떼고 나머지는 원문을 살린다. */
const factOf = (text: string): string => {
  const trimmed = text.trim();
  const stripped = trimmed.replace(REQUEST_TAIL, "").trim();
  return stripped.length > 0 ? stripped : trimmed;
};

/**
 * 기억 변경은 Decision의 의도와 TypeScript의 검증을 함께 통과해야 한다.
 * 대상이 모호하거나 소유자가 다르면 아무것도 바꾸지 않고 확인을 요청한다.
 */
export const commitMemoryOperation = (
  store: MindMemoryStore,
  input: MemoryCommitInput,
  options: { autoMemory: boolean }
): MemoryOperationResult => {
  const fact = factOf(input.text);
  const explicit = EXPLICIT_CUE.test(input.text);

  switch (input.operation) {
    case "none":
      return empty("none");
    case "unclear":
      return empty("needs_confirmation", "어떤 기억을 말하는지 분명하지 않습니다");

    case "add": {
      if (!explicit && (!options.autoMemory || SENSITIVE.test(fact))) {
        return empty("none");
      }
      const saved = store.add({
        ownerUserId: input.userId,
        scope: "user",
        kind: "semantic",
        content: fact,
        confidence: explicit ? 0.9 : 0.7,
        importance: explicit ? 0.7 : 0.5,
        sourceMessageId: input.messageId,
        sourceAuthorId: input.userId
      });
      if (!saved) return empty("none", "이미 같은 내용이 저장돼 있습니다");
      return { status: "success", added: [saved.content], updated: [], removed: [], reason: null };
    }

    case "update": {
      if (input.targetId === null) {
        return empty("needs_confirmation", "수정할 기억을 하나로 특정하지 못했습니다");
      }
      const updated = store.update(input.targetId, input.userId, fact);
      if (!updated) return empty("failed", "수정할 기억을 찾지 못했거나 소유자가 다릅니다");
      return { status: "success", added: [], updated: [updated.content], removed: [], reason: null };
    }

    case "delete": {
      if (input.targetId === null) {
        return empty("needs_confirmation", "삭제할 기억을 하나로 특정하지 못했습니다");
      }
      if (!store.remove(input.targetId, input.userId)) {
        return empty("failed", "삭제할 기억을 찾지 못했거나 소유자가 다릅니다");
      }
      return { status: "success", added: [], updated: [], removed: ["기억 1개"], reason: null };
    }

    default:
      return empty("none");
  }
};

export const describeMemoryResult = (result: MemoryOperationResult): string => {
  if (result.status === "none") return "이번 턴에는 기억을 바꾸지 않았다.";
  if (result.status === "needs_confirmation") {
    return `기억을 바꾸지 않았다. ${result.reason ?? "대상이 불분명하다"}. 어떤 기억인지 되물어야 한다.`;
  }
  if (result.status === "failed") {
    return `기억 변경에 실패했다. ${result.reason ?? ""}. 성공했다고 말하지 않는다.`;
  }

  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`저장: ${result.added.join(" / ")}`);
  if (result.updated.length > 0) parts.push(`수정: ${result.updated.join(" / ")}`);
  if (result.removed.length > 0) parts.push(`삭제: ${result.removed.join(" / ")}`);
  return `실제로 반영된 기억 변경이다. ${parts.join(" · ")}`;
};
