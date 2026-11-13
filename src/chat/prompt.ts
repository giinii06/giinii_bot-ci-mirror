import { FALLBACK_INSTRUCTIONS } from "./instructions.js";

export const MAX_MEMORY_CHARS = 1200;

export const formatMemoryForPrompt = (memory: string): string => {
  const lines = memory
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^[-*+]\s+/, ""));

  if (lines.length === 0) return "(아직 없음)";

  const numbered = lines.map((text, index) => `${index + 1}. ${text}`);
  const kept: string[] = [];
  let used = 0;

  for (let index = numbered.length - 1; index >= 0; index -= 1) {
    const line = numbered[index];
    if (line === undefined) continue;
    if (kept.length > 0 && used + line.length + 1 > MAX_MEMORY_CHARS) break;
    kept.unshift(line);
    used += line.length + 1;
  }

  const omitted = numbered.length - kept.length;
  if (omitted === 0) return kept.join("\n");
  return `…(오래된 기억 ${omitted}개 생략)\n${kept.join("\n")}`;
};

const OUTPUT_RULES = [
  "## 지켜야 할 규칙",
  "- 대화는 이 채널의 최근 메시지다. 형식은 `이름 (@아이디): 내용`이고 네 발언은 assistant로 들어온다.",
  "- 마지막 메시지는 `[질문자: 이름 (@아이디)]`로 시작한다. 그 사람에게 답한다.",
  "- 기억 목록은 참고용이다. 사용자가 번호로 말하면 그 번호의 문장을 쓴다.",
  "- 기억은 말한 사람이 아니라 사실 자체로 쓴다. 예: '설하는 공주병이 심하다'.",
  "- '~라고 생각한다', '~라고 말했다', '~에 따르면' 같은 전달 표현을 쓰지 않는다. 선호는 '~을 원한다', 믿음은 '~라고 여긴다'로 쓴다.",
  "- 저장은 답변 맨 끝에 `<memory>한 줄 요약</memory>`, 수정은 `<memory-edit>기존 => 새 내용</memory-edit>`, 삭제는 `<memory-delete>지울 기억</memory-delete>`.",
  "- 태그에는 번호가 아니라 기억 목록에 있는 문장을 그대로 적는다. 비슷한 기억이 여럿이거나 애매해도 되묻지 않고 가장 잘 맞는 하나를 골라 처리한다.",
  "- 기억은 120자 이내로 사용자에 대한 사실만 담고 표시 이름만 쓴다. `@아이디`, 멘션, 숫자 ID는 넣지 않는다. 저장할 내용이 없으면 태그를 쓰지 않는다.",
  "- 사용자가 말한 기억이 목록에 없으면 태그 없이 못 찾았다고 답한다. 전부 지우는 요청은 거절하고 하나씩 골라 달라고 안내한다.",
  "- 태그를 설명하거나 언급하지 않는다. 저장·수정·삭제 안내는 시스템이 따로 보낸다.",
  "",
  "## <memory>"
].join("\n");

export const buildSystemPrompt = (input: { instructions: string; memory: string }): string => {
  const instructions = input.instructions.trim() || FALLBACK_INSTRUCTIONS;
  return [instructions, "", OUTPUT_RULES, formatMemoryForPrompt(input.memory)].join("\n");
};
