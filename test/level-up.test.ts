import { expect, test } from "bun:test";
import { renderLevelUp } from "../src/leaderboard.js";

test("level-up card renders without an avatar", async () => {
  const image = await renderLevelUp("테스트 서버", { name: "이디" }, 15);
  expect(image.subarray(1, 4).toString()).toBe("PNG");
});
