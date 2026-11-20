import { expect, test } from "bun:test";
import type { Message } from "discord.js";
import { ALLOWED_GUILD_ID } from "../src/command-rules.js";
import { handlePrefixCommand, parsePrefixCommand, prefixCommandNames } from "../src/prefix-commands.js";
import { handleRouletteSettingsCommand, parseRoleId } from "../src/roulette-settings.js";

const fake = (content: string, guildId: string | null = ALLOWED_GUILD_ID, administrator = false) => {
  const replies: string[] = [];
  const message = {
    content,
    author: { id: "999999999999999999", bot: false },
    guildId,
    member: { permissions: { has: () => administrator } },
    reply: async (data: { content: string }) => { replies.push(data.content); },
    guild: { id: guildId, roles: { fetch: async () => null } }
  };
  return { message: message as unknown as Message, replies };
};

test("정확한 8개 접두사만 인식하며 인자 공백을 유지한다", () => {
  expect(prefixCommandNames).toHaveLength(8);
  expect(parsePrefixCommand("!memory delete 3")).toEqual({ name: "memory", args: "delete 3" });
  expect(parsePrefixCommand("!shared-memory add fact 공용 기억")).toEqual({
    name: "shared-memory", args: "add fact 공용 기억"
  });
  expect(parsePrefixCommand("!modelxyz foo")).toBeNull();
  expect(parsePrefixCommand("/model")).toBeNull();
});

test("!help는 어느 길드에서도 볼 수 있다", async () => {
  const { message, replies } = fake("!help", "222222222222222222");
  expect(await handlePrefixCommand(message)).toBe(true);
  expect(replies[0]).toContain("!memory");
  expect(replies[0]).toContain("ADMIN_USER_ID");
  expect(replies[0]).toContain("슬래시");
});

test("전용 서버 밖에서 모델 변경은 실행되지 않는다", async () => {
  const { message, replies } = fake("!model free/test", "222222222222222222");
  expect(await handlePrefixCommand(message)).toBe(true);
  expect(replies[0]).toContain("지정된 서버");
});

test("일반 사용자의 관리자 전용 명령을 거부한다", async () => {
  for (const content of ["!mind status", "!shared-memory list", "!타겟 조회", "!관리자_타겟 조회"]) {
    const { message, replies } = fake(content);
    expect(await handlePrefixCommand(message)).toBe(true);
    expect(replies[0]).toContain("서버 관리자");
  }
});

test("존재하지 않는 ! 명령은 관여하지 않는다", async () => {
  const { message, replies } = fake("!not-a-command");
  expect(await handlePrefixCommand(message)).toBe(false);
  expect(replies).toHaveLength(0);
});

test("역할 멘션·ID만 허용하고 일반 유저 멘션은 거부한다", async () => {
  expect(parseRoleId("<@&123456789012345678>")).toBe("123456789012345678");
  expect(parseRoleId("123456789012345678")).toBe("123456789012345678");
  expect(parseRoleId("<@123456789012345678>")).toBeNull();
  expect(parseRoleId("@everyone")).toBeNull();
});

test("룰렛 설정 핸들러도 내부적으로 권한을 재검증한다", async () => {
  const { message, replies } = fake("!타겟 조회");
  await handleRouletteSettingsCommand(message, message.guild!, "타겟", "조회");
  expect(replies[0]).toContain("서버 관리자");
});
