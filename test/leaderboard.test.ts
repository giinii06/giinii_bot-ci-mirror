import { expect, test } from "bun:test";
import { renderMemory } from "../src/leaderboard.js";

test("memory card renders a PNG", async () => {
  const images = await renderMemory("여름 여행", { name: "주최자" }, "2026년 7월 27일 오후 3시 04분", [
    { name: "참가자", content: "좋은 추억이었어요!", avatarUrl: undefined },
  ]);
  expect(images).toHaveLength(1);
  expect(images[0].subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("long memories are split into multiple vertical PNGs", async () => {
  const images = await renderMemory("긴 추억", { name: "주최자" }, "2026년 7월 27일 오후 3시 04분", Array.from({ length: 12 }, (_, index) => ({
    name: `참가자${index + 1}`, content: "휴대폰에서 보기 좋은 세로 카드입니다.",
  })));
  expect(images.length).toBeGreaterThan(1);
});
