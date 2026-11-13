import { expect, test } from "bun:test";
import { Client, ClientApplication, Guild, Routes } from "discord.js";
import { commands, syncCommands } from "../src/commands.ts";
import { ALLOWED_GUILD_ID } from "../src/command-rules.ts";

const applicationId = "1000000000000000000";
const targetGuildId = "1564358683641778237";
const removedCommands = ["question", "mbti", "결투", "계급", "싸이코지수", "별명", "흑역사", "요약", "캐릭터"]
  .map((name) => ({ name, description: "Legacy AI analysis", type: 1 }));
const globalPath = Routes.applicationCommands(applicationId);
const guildPath = (id) => Routes.applicationGuildCommands(applicationId, id);

const fakeDiscord = () => {
  const client = new Client({ intents: [] });
  client.application = new ClientApplication(client, { id: applicationId });
  for (const id of [ALLOWED_GUILD_ID, targetGuildId]) {
    client.guilds.cache.set(id, new Guild(client, { id, name: id, features: [] }));
  }
  let sequence = 0;
  const response = (body) => body.map((command) => ({ ...command,
    id: String(BigInt(applicationId) + BigInt(++sequence)), application_id: applicationId, version: "1",
    default_member_permissions: command.default_member_permissions ?? null,
    contexts: command.contexts ?? [], integration_types: command.integration_types ?? [],
  }));
  const state = new Map([
    [globalPath, response(removedCommands)],
    [guildPath(ALLOWED_GUILD_ID), response([...commands, ...removedCommands])],
    [guildPath(targetGuildId), response(removedCommands)],
  ]);
  const writes = [];
  client.rest.request = async ({ method, fullRoute, body }) => {
    if (method === "GET" && state.has(fullRoute)) return structuredClone(state.get(fullRoute));
    if (method === "PUT" && state.has(fullRoute) && Array.isArray(body)) {
      writes.push(fullRoute);
      const registered = response(body);
      state.set(fullRoute, registered);
      return structuredClone(registered);
    }
    throw new Error(`Unexpected Discord request: ${method} ${fullRoute}`);
  };
  return { client, state, writes };
};

test("removes legacy AI commands globally and from guilds while preserving voice commands and roulette", async () => {
  const { client, state, writes } = fakeDiscord();
  try {
    await syncCommands(client);
    const global = state.get(globalPath);
    expect(global.map((command) => command.name)).toEqual(["친밀도그래프", "친밀도", "통화량", "통계"]);
    expect(global.every((command) => command.contexts.join() === "0" && command.integration_types.join() === "0")).toBe(true);
    expect(state.get(guildPath(targetGuildId))).toEqual([]);
    // 기니봇아 대화 명령은 룰렛과 같이 전용 서버에만 등록한다.
    expect(state.get(guildPath(ALLOWED_GUILD_ID)).map((command) => command.name)).toEqual([
      "타겟", "관리자_타겟", "관리자머리끄댕이", "관리자머리끄댕이방어권_역할", "model", "reasoning",
    ]);
    expect(writes).toHaveLength(3);
    await syncCommands(client);
    expect(writes).toHaveLength(3);
  } finally { await client.destroy(); }
});

test("a newly joined guild sync also ensures globals and leaves other guild registrations alone", async () => {
  const { client, state, writes } = fakeDiscord();
  const allowedBefore = structuredClone(state.get(guildPath(ALLOWED_GUILD_ID)));
  try {
    await syncCommands(client, client.guilds.cache.get(targetGuildId));
    expect(state.get(globalPath).some((command) => command.name === "친밀도그래프")).toBe(true);
    expect(state.get(guildPath(targetGuildId))).toEqual([]);
    expect(state.get(guildPath(ALLOWED_GUILD_ID))).toEqual(allowedBefore);
    expect(writes).toEqual([globalPath, guildPath(targetGuildId)]);
  } finally { await client.destroy(); }
});
