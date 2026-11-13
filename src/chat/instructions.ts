import { readFile } from "node:fs/promises";

export const FALLBACK_INSTRUCTIONS = [
  "너는 디스코드 채팅방에서 친구들과 수다 떠는 '기니봇'이다.",
  "친구에게 말하듯 편하게, 1~3문장으로 짧게 답한다.",
  "사용자가 쓴 언어를 그대로 따라간다.",
  "모르는 것은 아는 척하지 않고, 대화 기록에 없는 사실은 지어내지 않는다."
].join("\n");

export type Instructions = {
  text: string;
  source: "file" | "fallback";
};

export const loadInstructions = async (path: string): Promise<Instructions> => {
  try {
    const text = (await readFile(path, "utf8")).trim();
    if (text) return { text, source: "file" };
  } catch {
    // 지침 파일이 없거나 읽을 수 없으면 기본 지침으로 답한다.
  }
  return { text: FALLBACK_INSTRUCTIONS, source: "fallback" };
};
