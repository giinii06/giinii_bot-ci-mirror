import { expect, test } from "bun:test";
import { removeRetiredCommands, retiredSlashNames } from "../scripts/cleanup-slash.js";

test("퇴역한 7종 슬래시만 선택하고 나머지와 Activity Entry Point를 보존한다", async () => {
  const names = [...retiredSlashNames, "친밀도", "관리자머리끄댕이", "launch"];
  const removed: string[] = [];
  const fake = {
    fetch: async () => new Map(names.map((name) => [name, {
      name, delete: async () => { removed.push(name); }
    }]))
  };
  const count = await removeRetiredCommands(fake as never, "test");
  expect(count).toBe(7);
  expect(removed).toEqual([...retiredSlashNames]);
  expect(removed).not.toContain("launch");
});

test("dry-run은 삭제를 호출하지 않고, 반복하면 0건이다", async () => {
  const commands = new Map<string, { name: string; delete: () => Promise<void> }>();
  commands.set("model", { name: "model", delete: async () => { commands.delete("model"); } });
  const manager = { fetch: async () => commands };
  expect(await removeRetiredCommands(manager as never, "test", true)).toBe(1);
  expect(commands.size).toBe(1);
  expect(await removeRetiredCommands(manager as never, "test")).toBe(1);
  expect(await removeRetiredCommands(manager as never, "test")).toBe(0);
});
