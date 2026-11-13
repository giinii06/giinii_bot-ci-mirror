import type { HistoryEntry } from "./history.js";
import type { ChatMessage } from "./router.js";

export const MAX_HISTORY_CHARS = 1200;
const MAX_ENTRY_CHARS = 300;

export const formatQuestion = (speaker: string, text: string) =>
  `[질문자: ${speaker}]\n${text}`;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const recentWithinBudget = (entries: HistoryEntry[]): HistoryEntry[] => {
  const kept: HistoryEntry[] = [];
  let used = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    const cost = Math.min(entry.content.length, MAX_ENTRY_CHARS) + entry.author.length;
    if (kept.length > 0 && used + cost > MAX_HISTORY_CHARS) break;
    kept.unshift(entry);
    used += cost;
  }

  return kept;
};

const mergeConsecutive = (messages: ChatMessage[]): ChatMessage[] => {
  const merged: ChatMessage[] = [];
  for (const message of messages) {
    const last = merged.at(-1);
    if (last && last.role === message.role) {
      last.content = `${last.content}\n${message.content}`;
      continue;
    }
    merged.push({ ...message });
  }
  return merged;
};

export const buildConversation = (
  entries: HistoryEntry[],
  current: { speaker: string; text: string }
): ChatMessage[] => {
  const historyMessages: ChatMessage[] = recentWithinBudget(entries).map((entry) =>
    entry.fromBot
      ? { role: "assistant", content: clip(entry.content, MAX_ENTRY_CHARS) }
      : { role: "user", content: `${entry.author}: ${clip(entry.content, MAX_ENTRY_CHARS)}` }
  );

  return mergeConsecutive([
    ...historyMessages,
    { role: "user", content: formatQuestion(current.speaker, current.text) }
  ]);
};
