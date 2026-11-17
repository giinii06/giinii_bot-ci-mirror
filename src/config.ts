import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * 봇 토큰 첫 조각은 base64로 인코딩된 애플리케이션 ID다.
 * DISCORD_CLIENT_ID를 따로 넣지 않았을 때만 쓰는 추측이고, 형식이 어긋나면 빈 문자열이다.
 */
export const applicationIdFromToken = (token: string): string => {
  const [first] = token.split(".");
  if (!first) return "";
  const decoded = Buffer.from(first, "base64").toString("utf8").trim();
  return /^\d{17,20}$/.test(decoded) ? decoded : "";
};

export const databasePath = process.env.DATABASE_PATH?.trim() || "./data/bot.sqlite";
export const rouletteAudioPaths = [
  process.env.VOICE_AUDIO_PATH?.trim() || "./audio/roulette.ogg",
  "./audio/roulette-2.ogg",
  "./audio/roulette-3.ogg"
];

/** Vite가 만든 SPA 정적 파일. 서버는 이 파일을 읽어서 돌려주기만 한다. */
const defaultActivityDist = fileURLToPath(new URL("../activity/dist", import.meta.url));

const discordToken = required(process.env.DISCORD_BOT_TOKEN?.trim() ? "DISCORD_BOT_TOKEN" : "DISCORD_TOKEN");

export const config = {
  discordToken,
  mediaRoot: process.env.MEDIA_PATH?.trim() || join(dirname(databasePath), "media"),
  mediaMaxBytes: toInt(process.env.MEDIA_MAX_BYTES, 512 * 1024 * 1024, 1024, 2_147_483_647),
  mediaConcurrency: toInt(process.env.MEDIA_CONCURRENCY, 4, 1, 16),
  skipBackfill: toBool(process.env.SKIP_BACKFILL, false),
  seedChunkBytes: toInt(process.env.SEED_CHUNK_BYTES, 30 * 1024 * 1024, 1024 * 1024, 2_147_483_647),
  seedGrowthBytes: toInt(process.env.SEED_GROWTH_BYTES, 30 * 1024 * 1024, 0, 2_147_483_647),
  activity: {
    enabled: toBool(process.env.ACTIVITY_ENABLED, false),
    clientId: process.env.DISCORD_CLIENT_ID?.trim() || applicationIdFromToken(discordToken),
    clientSecret: (process.env.DISCORD_CLIENT_SECRET ?? "").trim(),
    hostname: process.env.ACTIVITY_HTTP_HOST?.trim() || "127.0.0.1",
    port: toInt(process.env.ACTIVITY_HTTP_PORT, 8787, 1, 65535),
    distDir: process.env.ACTIVITY_DIST_PATH?.trim() || defaultActivityDist
  }
};
