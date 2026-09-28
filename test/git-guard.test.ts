import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import {
  MAX_COMMITTED_FILE_BYTES, findOversized, formatOversizedReport,
  oversizedStagedFiles, oversizedTrackedFiles, stagedPaths
} from "../src/git-guard.js";

const MIB = 1024 * 1024;
const directories: string[] = [];

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

const initRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "giinii-guard-"));
  directories.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "guard@example.test");
  git(dir, "config", "user.name", "guard");
  return dir;
};

const writeSized = (dir: string, name: string, bytes: number) => {
  const path = join(dir, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, 1));
  return path;
};

test("treats 30 MB as the hard ceiling for a committed file", () => {
  expect(MAX_COMMITTED_FILE_BYTES).toBe(30 * MIB);
});

test("admits a chunk of exactly 30 MB and rejects anything past it", async () => {
  const dir = initRepo();
  const exact = writeSized(dir, "exact.bin", MAX_COMMITTED_FILE_BYTES);
  const over = writeSized(dir, "over.bin", MAX_COMMITTED_FILE_BYTES + 1);

  const found = await findOversized([exact, over], dir);

  expect(found.map((file) => basename(file.path))).toEqual(["over.bin"]);
});

test("flags files past the ceiling and leaves smaller ones alone", async () => {
  const dir = initRepo();
  const under = writeSized(dir, "under.bin", MAX_COMMITTED_FILE_BYTES - 1);
  const exact = writeSized(dir, "exact.bin", MAX_COMMITTED_FILE_BYTES);
  const over = writeSized(dir, "over.bin", MAX_COMMITTED_FILE_BYTES + MIB);

  const found = await findOversized([under, exact, over], dir);

  expect(found.map((file) => basename(file.path)).sort()).toEqual(["over.bin"]);
  expect(found[0]!.bytes).toBe(MAX_COMMITTED_FILE_BYTES + MIB);
  expect(found.map((file) => file.path)).toEqual([over]);
});

test("names the oversized path and the chunking commands in the refusal", async () => {
  const dir = initRepo();
  const path = writeSized(dir, "huge.bin", 40 * MIB);

  const report = formatOversizedReport(await findOversized([path], dir));

  expect(report).toContain("huge.bin");
  expect(report).toContain("40.0 MB");
  expect(report).toContain("scripts/split-db.ts");
  expect(report).toContain("scripts/chunk-media.ts");
});

test("scans only what the commit is about to take, not the whole tree", async () => {
  const dir = initRepo();
  writeSized(dir, "committed-big.bin", MAX_COMMITTED_FILE_BYTES + 1);
  git(dir, "add", "committed-big.bin");
  git(dir, "commit", "-q", "-m", "seed the tree with an oversized file");

  const staged = writeSized(dir, "staged-small.bin", 1024);
  git(dir, "add", "staged-small.bin");

  expect(await stagedPaths(dir)).toEqual(["staged-small.bin"]);
  expect(await oversizedStagedFiles(dir)).toEqual([]);
  expect((await oversizedTrackedFiles(dir)).map((file) => file.path)).toEqual(["committed-big.bin"]);
  expect(existsSync(staged)).toBe(true);
});

test("ignores paths that are not regular files", async () => {
  const dir = initRepo();
  const nested = join(dir, "nested");
  mkdirSync(nested, { recursive: true });

  expect(await findOversized(["nested", "missing.bin"], dir)).toEqual([]);
});

afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});
