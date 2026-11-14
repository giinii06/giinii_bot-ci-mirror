import { expect, test } from "bun:test";
import { ADMIN_USER_ID, handleAdminCommand } from "../src/admin-commands.ts";

const fakeMessage = (content, authorId) => {
  const replies = [];
  return {
    message: {
      content,
      author: { bot: false, id: authorId },
      reply: async (payload) => { replies.push(payload); }
    },
    replies
  };
};

test("denies every admin command for anyone but ADMIN_USER_ID", async () => {
  for (const content of ["!서버목록", "!서버별명령어", "!도움", "!서버별명령어 내 서버 disable 통화량"]) {
    const { message, replies } = fakeMessage(content, "1000000000000000000");
    expect(await handleAdminCommand(message, {})).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0].embeds[0].data.title).toBe("권한이 없어요");
  }
});

test("lets ADMIN_USER_ID run a read-only admin command", async () => {
  const { message, replies } = fakeMessage("!도움", ADMIN_USER_ID);
  expect(await handleAdminCommand(message, {})).toBe(true);
  expect(replies).toHaveLength(1);
  expect(replies[0].embeds[0].data.title).toBe("사용법");
});
