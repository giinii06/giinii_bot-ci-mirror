import type { MemoryApproval, MemoryCategory } from "../types.js";

export const NICKNAME_MAX_LENGTH = 20;

/** 민감한 주제는 명시 요청 없이는 자동 저장하지 않는다. */
export const SENSITIVE =
  /(병원|질병|우울증|정신과|정치|종교|교회|성당|절에|투표|대통령|국회|약을\s*먹)/;

const NICKNAME_BLOCKED = /(https?:\/\/|www\.|<@|@everyone|@here|[\n\r])/i;
const NICKNAME_SLURS =
  /(병신|장애인|틀딱|한남|한녀|김치녀|김치남|좆|씨발|개새끼|벌레|기생충)/;

export type NicknameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

export const validateNickname = (raw: string): NicknameValidation => {
  const value = raw
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();

  if (!value) return { ok: false, reason: "별명이 비어 있습니다" };
  if ([...value].length > NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: `별명은 ${NICKNAME_MAX_LENGTH}자 이하여야 합니다` };
  }
  if (NICKNAME_BLOCKED.test(value)) {
    return { ok: false, reason: "별명에 링크나 멘션을 넣을 수 없습니다" };
  }
  if (NICKNAME_SLURS.test(value)) {
    return { ok: false, reason: "모욕적인 별명은 저장할 수 없습니다" };
  }
  return { ok: true, value };
};

/**
 * 공용 기억의 승인 상태는 모델이 아니라 이 표가 정한다.
 * 관리자는 바로 활성화하고, 일반 사용자는 안전한 별명만 자동 반영한다.
 */
export const guildApprovalFor = (input: {
  isAdministrator: boolean;
  category: MemoryCategory;
  autoNickname: boolean;
  approvalRequired: boolean;
}): MemoryApproval => {
  if (input.isAdministrator) return "active";
  if (input.category === "nickname") return input.autoNickname ? "active" : "pending";
  return input.approvalRequired ? "pending" : "active";
};
