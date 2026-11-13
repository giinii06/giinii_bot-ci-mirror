import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assembleParts } from "../src/chunk-files.js";

type Part = { name: string; bytes: number; sha256: string };
type Manifest = { totalBytes: number; chunkBytes: number; sha256: string; parts: Part[] };

/** 시드 한 벌은 서버 하나다. data/seed/<서버ID>/manifest.json 형태다. */
const SEED_ROOT = resolve(process.argv[2] ?? "data/seed");
const TARGET_ROOT = resolve(process.argv[3] ?? "data/guilds");
const FORCE = process.argv.includes("--force");

const restoreOne = async (seedDir: string, target: string) => {
  const existing = await stat(target).catch(() => null);
  if (existing && !FORCE) {
    console.log(`${target} exists (${existing.size.toLocaleString()} bytes), skipping seed restore`);
    return;
  }

  const manifestPath = join(seedDir, "manifest.json");
  const manifest = await readFile(manifestPath, "utf8")
    .then((text) => JSON.parse(text) as Manifest)
    .catch(() => null);

  if (!manifest) {
    console.log(`no seed manifest at ${manifestPath}, starting with an empty database`);
    return;
  }

  const result = await assembleParts(seedDir, target, manifest.parts, {
    bytes: manifest.totalBytes,
    sha256: manifest.sha256
  });
  if (!result.ok) {
    if (result.reason === "size") {
      console.error(`restore failed for ${target}: wrote ${result.bytes} bytes, manifest expects ${manifest.totalBytes}`);
    } else {
      console.error(`restore failed for ${target}: sha256 mismatch, seed parts are corrupt`);
    }
    process.exit(1);
  }

  console.log(`restored ${target} from ${manifest.parts.length} seed part(s), ${result.bytes.toLocaleString()} bytes, sha256 ok`);
};

if (!existsSync(SEED_ROOT)) {
  console.log(`no seed directory at ${SEED_ROOT}, starting with empty databases`);
  process.exit(0);
}

const entries = await readdir(SEED_ROOT, { withFileTypes: true });
const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const guildIds = directories.filter((name) => /^\d{15,25}$/.test(name));
const skipped = directories.filter((name) => !/^\d{15,25}$/.test(name));
if (skipped.length > 0) {
  console.warn(`skipping ${skipped.length} seed folder(s) that are not guild IDs: ${skipped.join(", ")}`);
}
if (guildIds.length === 0) {
  console.log(`no per-guild seed under ${SEED_ROOT}, starting with empty databases`);
  process.exit(0);
}

for (const guildId of guildIds) {
  await restoreOne(join(SEED_ROOT, guildId), join(TARGET_ROOT, `${guildId}.sqlite`));
}
