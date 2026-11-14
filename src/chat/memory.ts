/**
 * 기존 memory.md 시절의 텍스트 처리만 남긴다.
 * 기억의 저장·수정·삭제·검색은 이제 src/mind/memory 가 SQLite에서 담당한다.
 */
export const MAX_MEMORY_ENTRY_LENGTH = 120;

const oneLine = (value: string) => value.trim().replace(/\s+/g, " ");

/** 기억 문장에서 멘션과 @아이디를 지우고 표시 이름만 남긴다. */
export const cleanMemoryText = (value: string): string =>
  oneLine(
    oneLine(value)
      .replace(/<@!?\d+>/g, "")
      .replace(/\s*\(@[\w.]+\)/g, "")
      .replace(/(^|\s)@[\w.]+/g, "$1")
  );

/**
 * memory.md의 머리말·주석을 걷어내고 기억 줄만 뽑는다.
 * 목록 표시가 하나라도 있으면 그것만 기억으로 본다. 손으로 적은 파일은 줄 전체를 쓴다.
 */
export const parseLegacyEntries = (raw: string): string[] => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const bullets = lines
    .filter((line) => /^[-*+]\s+/.test(line))
    .map((line) => oneLine(line.replace(/^[-*+]\s+/, "")))
    .filter((line) => line.length > 0);

  if (bullets.length > 0) return bullets;
  return lines.map(oneLine).filter((line) => line.length > 0);
};
