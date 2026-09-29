import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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

await mkdir(dirname(TARGET), { recursive: true });
const staging = `${TARGET}.restoring`;
await rm(staging, { force: true });

const out = createWriteStream(staging);
const hash = createHash("sha256");
let written = 0;
for (const part of manifest.parts) {
  for await (const chunk of createReadStream(join(SEED_DIR, part.name))) {
    hash.update(chunk);
    written += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
  }
}
await new Promise((r) => out.end(r));

if (written !== manifest.totalBytes) {
  await rm(staging, { force: true });
  console.error(`restore failed: wrote ${written} bytes, manifest expects ${manifest.totalBytes}`);
  process.exit(1);
}
if (hash.digest("hex") !== manifest.sha256) {
  await rm(staging, { force: true });
  console.error("restore failed: sha256 mismatch, seed parts are corrupt");
  process.exit(1);
}

await rename(staging, TARGET);
console.log(`restored ${TARGET} from ${manifest.parts.length} part(s), ${written.toLocaleString()} bytes, sha256 ok`);
