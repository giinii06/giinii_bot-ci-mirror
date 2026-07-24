import { expect, test } from "bun:test";

function levelAt(xp: number) {
  let level = 1;
  while (xp >= ((10 * (level + 1)) ** 2 - 5) / 2 + 1) level++;
  return level;
}

test("level formula uses cumulative XP thresholds", () => {
  expect(levelAt(0)).toBe(1);
  expect(levelAt(198)).toBe(1);
  expect(levelAt(199)).toBe(2);
});
