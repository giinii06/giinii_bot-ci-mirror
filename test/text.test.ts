import { expect, test } from "bun:test";
import { splitForEmbeds } from "../src/text.js";

test("splits long AI output without exceeding Discord embed size", () => {
  const pages = splitForEmbeds("단어 ".repeat(1_000));
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every((page) => page.length <= 1_800)).toBe(true);
});
