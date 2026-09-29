import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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

  await mkdir(dirname(target), { recursive: true });

  // 조각을 모으는 동안 실제 파일이 잠기지 않도록 임시 이름에 먼저 쓴 뒤 옮긴다.
  const staging = `${target}.restoring`;
  await rm(staging, { force: true });
  const out = createWriteStream(staging);
  const hash = createHash("sha256");
  let written = 0;

  for (const part of manifest.parts) {
    for await (const chunk of createReadStream(join(seedDir, part.name))) {
      hash.update(chunk);
      written += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
  }
  await new Promise((r) => out.end(r));

  if (written !== manifest.totalBytes) {
    await rm(staging, { force: true });
    console.error(`restore failed for ${target}: wrote ${written} bytes, manifest expects ${manifest.totalBytes}`);
    process.exit(1);
  }
  if (hash.digest("hex") !== manifest.sha256) {
    await rm(staging, { force: true });
    console.error(`restore failed for ${target}: sha256 mismatch, seed parts are corrupt`);
    process.exit(1);
  }

  await rename(staging, target);
  console.log(`restored ${target} from ${manifest.parts.length} seed part(s), ${written.toLocaleString()} bytes, sha256 ok`);
};

if (!existsSync(SEED_ROOT)) {
  console.log(`no seed directory at ${SEED_ROOT}, starting with empty databases`);
  process.exit(0);
}

const entries = await readdir(SEED_ROOT, { withFileTypes: true });
const seedDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
if (seedDirs.length === 0) {
  console.log(`no per-guild seed under ${SEED_ROOT}, starting with empty databases`);
  process.exit(0);
}

for (const guildId of seedDirs) {
  await restoreOne(join(SEED_ROOT, guildId), join(TARGET_ROOT, `${guildId}.sqlite`));
}
