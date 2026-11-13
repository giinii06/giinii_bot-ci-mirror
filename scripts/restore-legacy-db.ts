import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assembleParts } from "../src/chunk-files.js";

/**
 * 서버별 DB 구조로 옮기기 전의 단일 시드(data/seed/bot.sqlite.part-NNN)만 임시로 복원한다.
 * 한 번 분할하고 나면(data/seed/<서버ID>/) 이 형식은 더 이상 쓰이지 않는다.
 */
type Part = { name: string; bytes: number; sha256: string };
type Manifest = { totalBytes: number; chunkBytes: number; sha256: string; parts: Part[] };

const SEED_DIR = resolve(process.argv[2] ?? "data/seed");
const TARGET = resolve(process.argv[3] ?? "data/bot.sqlite.legacy");
const FORCE = process.argv.includes("--force");

const existing = await stat(TARGET).catch(() => null);
if (existing && !FORCE) {
  console.log(`${TARGET} exists (${existing.size.toLocaleString()} bytes), skipping`);
  process.exit(0);
}

const manifest = await readFile(join(SEED_DIR, "manifest.json"), "utf8")
  .then((text) => JSON.parse(text) as Manifest)
  .catch(() => null);
if (!manifest) {
  console.error(`no legacy manifest at ${join(SEED_DIR, "manifest.json")}`);
  process.exit(1);
}
const partsPresent = (await readdir(SEED_DIR)).filter((name) => name.startsWith("bot.sqlite.part-"));
if (partsPresent.length < manifest.parts.length) {
  console.error(`manifest wants ${manifest.parts.length} part(s) but only ${partsPresent.length} present in ${SEED_DIR}`);
  process.exit(1);
}

const result = await assembleParts(SEED_DIR, TARGET, manifest.parts, {
  bytes: manifest.totalBytes,
  sha256: manifest.sha256
});
if (!result.ok) {
  if (result.reason === "size") {
    console.error(`restore failed: wrote ${result.bytes} bytes, manifest expects ${manifest.totalBytes}`);
  } else {
    console.error("restore failed: sha256 mismatch, seed parts are corrupt");
  }
  process.exit(1);
}

console.log(`restored ${TARGET} from ${manifest.parts.length} part(s), ${result.bytes.toLocaleString()} bytes, sha256 ok`);
