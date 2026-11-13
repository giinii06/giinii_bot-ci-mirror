import { dirname, join } from "node:path";

const toInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
};

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const databasePath = process.env.DATABASE_PATH?.trim() || "./data/bot.sqlite";
export const rouletteAudioPaths = [
  process.env.VOICE_AUDIO_PATH?.trim() || "./audio/roulette.ogg",
  "./audio/roulette-2.ogg",
  "./audio/roulette-3.ogg"
];

export const config = {
  discordToken: required(process.env.DISCORD_BOT_TOKEN?.trim() ? "DISCORD_BOT_TOKEN" : "DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
  mediaRoot: process.env.MEDIA_PATH?.trim() || join(dirname(databasePath), "media"),
  mediaMaxBytes: toInt(process.env.MEDIA_MAX_BYTES, 512 * 1024 * 1024, 1024, 2_147_483_647),
  mediaConcurrency: toInt(process.env.MEDIA_CONCURRENCY, 4, 1, 16),
  skipBackfill: toBool(process.env.SKIP_BACKFILL, false),
  seedChunkBytes: toInt(process.env.SEED_CHUNK_BYTES, 30 * 1024 * 1024, 1024 * 1024, 2_147_483_647),
  seedGrowthBytes: toInt(process.env.SEED_GROWTH_BYTES, 30 * 1024 * 1024, 0, 2_147_483_647)
};
