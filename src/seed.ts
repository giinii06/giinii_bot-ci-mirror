import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config, databasePath } from "./config.js";
import { dbFor, listGuildIds, snapshotDatabase } from "./storage.js";

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

/** 서버별 DB 는 제각각 자란다. 시드 한 벌을 통째로 갱신하면 어느 서버가 오래된지 알 수 없으므로 서버별 시드를 따로 둔다. */
export const guildSeedDirectory = (guildId: string) => join(seedDirectory(), guildId);

const sha256File = (path: string) =>
  new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", reject);
  });

export const readSeedManifest = async (seedDir: string): Promise<SeedManifest | null> =>
  readFile(join(seedDir, "manifest.json"), "utf8")
    .then((text) => JSON.parse(text) as SeedManifest)
    .catch(() => null);

const liveSize = async (dbPath: string) => stat(dbPath).then((s) => s.size).catch(() => 0);

/** 스냅샷은 VACUUM 으로 압축되므로 조각 크기보다 원본 파일 크기를 기준으로 뒤처짐을 판단한다. */
export const isSeedStale = async (guildId: string, growthBytes = config.seedGrowthBytes, seedDir = guildSeedDirectory(guildId)) => {
  const sourcePath = dbFor(guildId).filename;
  const manifest = await readSeedManifest(seedDir);
  if (!manifest) return (await liveSize(sourcePath)) > 0;
  return (await liveSize(sourcePath)) > manifest.sourceBytes + growthBytes;
};

const splitInto = async (snapshot: string, target: string, chunkBytes: number, sourceBytes: number, source: string) => {
  // 0 이면 partCount 가 무한대가 되고, 음수면 읽기 범위가 뒤집혀 조각이 조용히 깨진다.
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) throw new Error(`조각 크기는 1 이상의 정수여야 합니다: ${chunkBytes}`);
  // pid 는 프로세스가 재사용되기도 하므로 지난번 조각이 남아 있으면 먼저 걷어낸다.
  // 남은 조각 수와 이번 조각 수가 맞지 않으면 조립이 조용히 깨진다.
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const { size } = await stat(snapshot);
  const partCount = Math.max(1, Math.ceil(size / chunkBytes));
  const parts: SeedPart[] = [];

  for (let index = 0; index < partCount; index += 1) {
    const start = index * chunkBytes;
    const end = Math.min(start + chunkBytes, size);
    const name = `${PREFIX}${String(index + 1).padStart(3, "0")}`;
    const out = createWriteStream(join(target, name));
    // 읽기가 깨지면 out.end() 가 아직 끝나지 않은 상태로 던져진다. 닫아 두지 않으면
    // 그 오류가 나중에 unhandled rejection 으로 새어나 프로세스를 죽인다.
    try {
      for await (const chunk of createReadStream(snapshot, { start, end: end - 1 })) {
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      }
      await new Promise((r) => out.end(r));
    } catch (error) {
      out.destroy();
      throw error;
    }
    const written = await stat(join(target, name));
    parts.push({ name, bytes: written.size, sha256: await sha256File(join(target, name)) });
  }

  const manifest: SeedManifest = {
    source,
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
export const produceChunkedSeed = async (guildId: string, options: { seedDir?: string; chunkBytes?: number } = {}) => {
  const seedDir = options.seedDir ?? guildSeedDirectory(guildId);
  const chunkBytes = options.chunkBytes ?? config.seedChunkBytes;
  const database = dbFor(guildId);

  const snapshot = join(dirname(databasePath), `.seed-snapshot-${guildId}-${process.pid}.sqlite`);
  const staging = `${seedDir}.staging-${process.pid}`;
  const retired = `${seedDir}.retired-${process.pid}`;

  let manifest: SeedManifest | null = null;
  try {
    snapshotDatabase(database, snapshot);
    manifest = await splitInto(snapshot, staging, chunkBytes, await liveSize(database.filename), `${guildId}.sqlite`);

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

export const startSeedWorker = (guildIds: string[], intervalMs = 10 * 60_000) => {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const guildId of guildIds) {
        if (!await isSeedStale(guildId)) continue;
        const startedAt = Date.now();
        const manifest = await produceChunkedSeed(guildId);
        console.log(`Seed updated for ${guildId}: ${manifest.parts.length} part(s), ${manifest.totalBytes.toLocaleString()} bytes, ${Date.now() - startedAt}ms`);
      }
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
