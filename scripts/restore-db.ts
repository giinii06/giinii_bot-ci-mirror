import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type Part = { name: string; bytes: number; sha256: string };
type Manifest = { totalBytes: number; chunkBytes: number; sha256: string; parts: Part[] };

const SEED_DIR = resolve(process.argv[2] ?? "data/seed");
const TARGET = resolve(process.argv[3] ?? "data/bot.sqlite");
const FORCE = process.argv.includes("--force");

const existing = await stat(TARGET).catch(() => null);
if (existing && !FORCE) {
  console.log(`${TARGET} exists (${existing.size.toLocaleString()} bytes), skipping seed restore`);
  process.exit(0);
}

const manifestPath = join(SEED_DIR, "manifest.json");
const manifest = await readFile(manifestPath, "utf8")
  .then((text) => JSON.parse(text) as Manifest)
  .catch(() => null);

if (!manifest) {
  console.log(`no seed manifest at ${manifestPath}, starting with an empty database`);
  process.exit(0);
}

await mkdir(dirname(TARGET), { recursive: true });

const out = createWriteStream(TARGET);
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
  console.error(`restore failed: wrote ${written} bytes, manifest expects ${manifest.totalBytes}`);
  process.exit(1);
}
if (hash.digest("hex") !== manifest.sha256) {
  console.error("restore failed: sha256 mismatch, seed parts are corrupt");
  process.exit(1);
}

console.log(`restored ${TARGET} from ${manifest.parts.length} seed part(s), ${written.toLocaleString()} bytes, sha256 ok`);
