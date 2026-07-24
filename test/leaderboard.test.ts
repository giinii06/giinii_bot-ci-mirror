import { expect, test } from "bun:test";
import { renderLeaderboard, renderRank, renderShop, renderShopPurchase, renderTransferReceipt } from "../src/leaderboard.js";

test("leaderboard renders a PNG", async () => {
  const entries = [{ name: "코덱스", xp: 1250 }];
  const firstPage = await renderLeaderboard("테스트 서버", entries);
  const secondPage = await renderLeaderboard("테스트 서버", entries, 11);
  expect(firstPage.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(secondPage.equals(firstPage)).toBe(false);
});

test("rank card renders a PNG", async () => {
  const image = await renderRank({ name: "hongsi27", xp: 68808, level: 37, rank: 33 });
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("shop renders a PNG", () => {
  const image = renderShop("테스트 서버", [{ name: "역할", price: 1000, purchased: true }], 1250);
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("shop purchase renders a PNG", async () => {
  const image = await renderShopPurchase("테스트 서버", { name: "이디" }, "기니 소원권", 75000);
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("transfer receipt renders a PNG", async () => {
  const image = await renderTransferReceipt("테스트 서버", { name: "보낸이", xp: 1250.5 }, { name: "받는이", xp: 2500.75 }, 1250.5);
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});
