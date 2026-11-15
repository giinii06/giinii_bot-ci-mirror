export const NICKNAME_MAX_LENGTH = 20;

export type NicknameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * 별명은 저장 자체를 거부하지 않는다. 빈 값과 길이만 기술적으로 막고,
 * 링크나 @everyone 같은 문자열은 일반 텍스트로 저장한다. 실제 멘션 차단은
 * Discord 전송 계층의 allowedMentions가 담당한다.
 */
export const validateNickname = (raw: string): NicknameValidation => {
  const value = raw
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) return { ok: false, reason: "별명이 비어 있습니다" };
  if ([...value].length > NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: `별명은 ${NICKNAME_MAX_LENGTH}자 이하여야 합니다` };
  }
  return { ok: true, value };
};
