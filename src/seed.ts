import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config, databasePath } from "./config.js";
import { snapshotDatabase } from "./storage.js";

const PREFIX = "bot.sqlite.part-";

export type SeedPart = { name: string; bytes: number; sha256: string };
export type SeedManifest = {
  source: string;
  sourceBytes: number;
  totalBytes: number;
  chunkBytes: number;
  sha256: string;
  parts: SeedPart[];
};

export const seedDirectory = () => join(dirname(databasePath), "seed");

const sha256File = (path: string) =>
  new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", reject);
  });

export const readSeedManifest = async (seedDir = seedDirectory()): Promise<SeedManifest | null> =>
  readFile(join(seedDir, "manifest.json"), "utf8")
    .then((text) => JSON.parse(text) as SeedManifest)
    .catch(() => null);

const liveSize = async (dbPath = databasePath) => stat(dbPath).then((s) => s.size).catch(() => 0);

/** 스냅샷은 VACUUM 으로 압축되므로 조각 크기보다 원본 파일 크기를 기준으로 뒤처짐을 판단한다. */
export const isSeedStale = async (growthBytes = config.seedGrowthBytes, seedDir = seedDirectory()) => {
  const manifest = await readSeedManifest(seedDir);
  if (!manifest) return (await liveSize()) > 0;
  return (await liveSize()) > manifest.sourceBytes + growthBytes;
};

const splitInto = async (snapshot: string, target: string, chunkBytes: number, sourceBytes: number) => {
  await mkdir(target, { recursive: true });
  const { size } = await stat(snapshot);
  const partCount = Math.max(1, Math.ceil(size / chunkBytes));
  const parts: SeedPart[] = [];

  for (let index = 0; index < partCount; index += 1) {
    const start = index * chunkBytes;
    const end = Math.min(start + chunkBytes, size);
    const name = `${PREFIX}${String(index + 1).padStart(3, "0")}`;
    const out = createWriteStream(join(target, name));
    for await (const chunk of createReadStream(snapshot, { start, end: end - 1 })) {
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((r) => out.end(r));
    const written = await stat(join(target, name));
    parts.push({ name, bytes: written.size, sha256: await sha256File(join(target, name)) });
  }

  const manifest: SeedManifest = {
    source: "bot.sqlite",
    sourceBytes,
    totalBytes: size,
    chunkBytes,
    sha256: await sha256File(snapshot),
    parts
  };
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

/**
 * 살아있는 DB를 일관된 스냅샷으로 받아 조각낸 뒤, 디렉터리 교체로 한 번에 갈아 끼운다.
 * 교체 전까지 예전 시드가 그대로 남아 있으므로 도중에 죽어도 복구 경로는 깨지지 않는다.
 */
export const produceChunkedSeed = async (options: { seedDir?: string; chunkBytes?: number } = {}) => {
  const seedDir = options.seedDir ?? seedDirectory();
  const chunkBytes = options.chunkBytes ?? config.seedChunkBytes;

  const snapshot = join(dirname(databasePath), `.seed-snapshot-${process.pid}.sqlite`);
  const staging = `${seedDir}.staging-${process.pid}`;
  const retired = `${seedDir}.retired-${process.pid}`;

  let manifest: SeedManifest | null = null;
  try {
    snapshotDatabase(snapshot);
    manifest = await splitInto(snapshot, staging, chunkBytes, await liveSize());

    await rm(retired, { recursive: true, force: true });
    if (await stat(seedDir).then(() => true).catch(() => false)) await rename(seedDir, retired);
    await rename(staging, seedDir);
    await rm(retired, { recursive: true, force: true });
    return manifest;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (manifest === null) {
      const stillThere = await stat(seedDir).then(() => true).catch(() => false);
      const retiredThere = await stat(retired).then(() => true).catch(() => false);
      if (!stillThere && retiredThere) await rename(retired, seedDir);
    }
    throw error;
  } finally {
    await rm(snapshot, { force: true });
  }
};

export const startSeedWorker = (intervalMs = 10 * 60_000) => {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (!await isSeedStale()) return;
      const startedAt = Date.now();
      const manifest = await produceChunkedSeed();
      console.log(`Seed updated: ${manifest.parts.length} part(s), ${manifest.totalBytes.toLocaleString()} bytes, ${Date.now() - startedAt}ms`);
    } catch (error) {
      console.error("Seed worker failed", error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
};
