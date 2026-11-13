import { EmbedBuilder } from "discord.js";

const BRAND = {
  warning: 0xf59e0b,
  error: 0xef4444
} as const;

export const createNoticeEmbed = (title: string, description: string, kind: "warning" | "error" = "warning") =>
  new EmbedBuilder()
    .setColor(kind === "error" ? BRAND.error : BRAND.warning)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
