import type { Database } from "bun:sqlite";
import type { Snowflake } from "discord.js";
import { dbFor, rootDb } from "../storage.js";
import {
  MIND_INDEXES,
  MIND_TABLES,
  ROOT_SCHEMA,
  migrateMindSchema
} from "./schema.js";

const prepared = new Set<string>();

/** 서버 DB에 Mind 스키마를 준비한다. 서버마다 한 번만 실행한다. */
export const ensureMindSchema = (guildId: Snowflake | string): Database => {
  const database = dbFor(guildId);
  const key = String(guildId);
  if (!prepared.has(key)) {
    database.exec(MIND_TABLES);
    migrateMindSchema(database);
    database.exec(MIND_INDEXES);
    prepared.add(key);
  }
  return database;
};

export const ensureRootSchema = (): Database => {
  const database = rootDb();
  if (!prepared.has("__root__")) {
    database.exec(ROOT_SCHEMA);
    prepared.add("__root__");
  }
  return database;
};
