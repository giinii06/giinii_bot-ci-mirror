export type TriggerKind = "prefix" | "mention" | "reply";

export type Trigger = {
  kind: TriggerKind;
  text: string;
};

export type TriggerInput = {
  content: string;
  botId: string;
  mentionedBot: boolean;
  repliedToBot: boolean;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const stripPrefix = (text: string, prefix: string): string | null => {
  const head = new RegExp(`^\\s*${escapeRegExp(prefix)}(?=$|\\s|[!?,.~])`);
  if (!head.test(text)) return null;
  return text.replace(head, "").replace(/^[!?,.~\s]+/, "").trim();
};

export const stripBotMention = (text: string, botId: string): string =>
  text
    .replace(new RegExp(`<@!?${botId}>`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();

export const detectTrigger = (input: TriggerInput, prefix: string): Trigger | null => {
  const content = input.content ?? "";

  if (input.mentionedBot || input.repliedToBot) {
    if (!content.trim()) return { kind: input.mentionedBot ? "mention" : "reply", text: "" };
    const withoutMention = stripBotMention(content, input.botId);
    const text = stripPrefix(withoutMention, prefix) ?? withoutMention;
    return { kind: input.mentionedBot ? "mention" : "reply", text };
  }

  const text = stripPrefix(content, prefix);
  if (text === null) return null;
  return { kind: "prefix", text };
};
