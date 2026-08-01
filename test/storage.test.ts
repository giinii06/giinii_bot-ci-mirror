import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

process.env.DISCORD_BOT_TOKEN = "test-token";
const directory = mkdtempSync(join(tmpdir(), "giinii-board-"));
const databasePath = join(directory, "bot.sqlite");
const legacyDb = new Database(databasePath);
legacyDb.exec(`
  CREATE TABLE command_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL,
    user_name TEXT NOT NULL, command_name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    output TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  )
`);
legacyDb.close();
process.env.DATABASE_PATH = databasePath;

const storage = await import("../src/storage.js");

test("migrates and stores AI questions in command logs", () => {
  storage.initDatabase();
  storage.insertCommandLog({
    guildId: "guild", channelId: "channel", userId: "user", userName: "tester",
    commandName: "question", question: "최근 분위기는?", provider: "gemini", model: "test-model", output: "평온합니다."
  });

  expect(storage.sql<{ question: string; output: string }>("SELECT question, output FROM command_logs LIMIT 1")).toEqual({
    question: "최근 분위기는?", output: "평온합니다."
  });
});

afterAll(() => {
  storage.db.close();
  rmSync(directory, { recursive: true, force: true });
});
