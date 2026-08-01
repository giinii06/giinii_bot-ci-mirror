import { EmbedBuilder } from "discord.js";

const BRAND = {
  primary: 0x7c3aed,
  success: 0x16a34a,
  warning: 0xf59e0b,
  error: 0xef4444
} as const;

const BAR_SIZE = 10;

export const progressBar = (seconds: number, done = false) => {
  if (done) return "▰".repeat(BAR_SIZE);
  const filled = Math.max(1, Math.min(BAR_SIZE - 1, Math.floor((seconds % 20) / 20 * BAR_SIZE) + 1));
  return "▰".repeat(filled) + "▱".repeat(BAR_SIZE - filled);
};

export const createProgressEmbed = (
  seconds: number,
  _limit: number,
  done = false,
  subject?: string,
  action = "질문 분석",
  titlePrefix = "질문"
) => {
  const status = done ? `${action} 완료` : `${action} 중`;

  return new EmbedBuilder()
    .setColor(done ? BRAND.success : BRAND.primary)
    .setTitle(subject ? `${titlePrefix}: ${trimForTitle(subject)}` : status)
    .setDescription(subject ? `${status}\n\`${progressBar(seconds, done)}\`` : `\`${progressBar(seconds, done)}\``)
    .addFields(
      { name: "경과 시간", value: `\`${seconds}s\``, inline: true }
    );
};

export const createResultEmbed = (question: string, answer: string, page: number, totalPages: number, elapsedSeconds: number) =>
  new EmbedBuilder()
    .setColor(BRAND.success)
    .setTitle(totalPages === 1 ? trimForTitle(question) : `${trimForTitle(question)} (${page}/${totalPages})`)
    .setDescription(answer)
    .addFields(
      { name: "걸린 시간", value: `${elapsedSeconds}s`, inline: true }
    );

export const createNoticeEmbed = (title: string, description: string, kind: "warning" | "error" = "warning") =>
  new EmbedBuilder()
    .setColor(kind === "error" ? BRAND.error : BRAND.warning)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();

const trimForTitle = (value: string) => {
  if (value.length <= 250) return value;
  return `${value.slice(0, 247)}...`;
};
