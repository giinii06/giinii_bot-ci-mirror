import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { config, databasePath } from "./config.js";
import { all } from "./storage.js";

const CHUNK_BYTES = 30 * 1024 * 1024;

/** GitHub 는 파일 하나가 100 MB 를 넘으면 push 를 거절하므로, 큰 파일은 30 MB 조각으로 보낸다. */
export const CHUNKABLE_ABOVE_BYTES = 100 * 1024 * 1024 - 1024 * 1024;

export const isChunkable = (bytes: number | null, capBytes = CHUNKABLE_ABOVE_BYTES) => (bytes ?? 0) > capBytes;

export const mediaSeedDirectory = () => join(dirname(databasePath), "media-seed");

type ChunkManifest = { bytes: number; sha256: string; parts: { name: string; bytes: number }[] };

const sha256File = (path: string) =>
  new Promise<string>((ok, no) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => ok(hash.digest("hex")))
      .on("error", no);
  });

const chunkDirectoryFor = (localPath: string) => join(mediaSeedDirectory(), localPath);
const mediaPathFor = (localPath: string) => join(config.mediaRoot, localPath);

const splitInto = async (source: string, target: string) => {
  await mkdir(target, { recursive: true });
  const { size } = await stat(source);
  const partCount = Math.max(1, Math.ceil(size / CHUNK_BYTES));
  const parts: { name: string; bytes: number }[] = [];

  for (let index = 0; index < partCount; index += 1) {
    const start = index * CHUNK_BYTES;
    const end = Math.min(start + CHUNK_BYTES, size);
    const name = `part-${String(index + 1).padStart(3, "0")}`;
    const out = createWriteStream(join(target, name));
    for await (const chunk of createReadStream(source, { start, end: end - 1 })) {
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((r) => out.end(r));
    parts.push({ name, bytes: (await stat(join(target, name))).size });
  }

  const manifest: ChunkManifest = { bytes: size, sha256: await sha256File(source), parts };
  await writeFile(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

const reassemble = async (chunkDir: string, target: string) => {
  const manifest = await readFile(join(chunkDir, "manifest.json"), "utf8")
    .then((text) => JSON.parse(text) as ChunkManifest)
    .catch(() => null);
  if (!manifest) return false;

  const staging = `${target}.restoring`;
  await mkdir(dirname(target), { recursive: true });
  const out = createWriteStream(staging);
  for (const part of manifest.parts) {
    for await (const chunk of createReadStream(join(chunkDir, part.name))) {
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
  }
  await new Promise((r) => out.end(r));

  if (statSync(staging).size !== manifest.bytes) { await rm(staging, { force: true }); return false; }
  if (await sha256File(staging) !== manifest.sha256) { await rm(staging, { force: true }); return false; }
  await rename(staging, target);
  return true;
};

const chunkDirectories = async (dir: string, out: string[] = []): Promise<string[]> => {
  const entries = await readdir(dir).catch(() => [] as string[]);
  for (const name of entries) {
    const path = join(dir, name);
    if ((await stat(path).catch(() => null))?.isDirectory()) await chunkDirectories(path, out);
    else if (name === "manifest.json") out.push(path.slice(0, -"manifest.json".length));
  }
  return out;
};

const GITIGNORE_START = "# >>> chunked media (maintained by src/media-seed.ts)";
const GITIGNORE_END = "# <<< chunked media";

/**
 * data/ 는 호스트와 공유 볼륨이라 컨테이너도 쓸 수 있다. 저장소 루트 .gitignore 는
 * 이미지에 없으므로 여기(data/.gitignore)에 써야 컨테이너에서 갱신할 수 있다.
 */
const syncGitignore = async (chunked: string[]) => {
  const gitignore = join(dirname(config.mediaRoot), ".gitignore");
  const current = await readFile(gitignore, "utf8").catch(() => "");
  const base = current.split(GITIGNORE_START)[0]!.trimEnd();
  const block = [GITIGNORE_START, ...[...chunked].sort().map((p) => `media/${p}`), GITIGNORE_END].join("\n");
  await writeFile(gitignore, `${base}${base ? "\n" : ""}${block}\n`);
  return true;
};

/** 기동 시점에 현재 조각 목록을 .gitignore 에 맞춘다. 이미 처리된 파일도 누락되지 않게. */
export const syncChunkedGitignore = async () => {
  await syncGitignore(await chunkedMediaPaths());
};

export const chunkedMediaPaths = async () => {
  const root = mediaSeedDirectory();
  return (await chunkDirectories(root))
    .map((dir) => relative(root, dir))
    .filter((p) => p && !p.startsWith(".."));
};

/**
 * 저장 시점에 조각으로 바꾼다. 원본은 지운다 — 복사본을 남기면 아카이브가 큰 파일
 * 크기만큼 더 커진다. 그리고 data/media 에서 빠진 경로를 .gitignore 에 자동 반영한다.
 */
export const chunkIfOversized = async (localPath: string, capBytes = CHUNKABLE_ABOVE_BYTES) => {
  const source = mediaPathFor(localPath);
  if (!existsSync(source)) return false;
  const { size } = await stat(source);
  if (!isChunkable(size, capBytes)) return false;

  await splitInto(source, chunkDirectoryFor(localPath));
  await rm(source, { force: true });
  await syncGitignore(await chunkedMediaPaths());
  return true;
};

/** 조각으로 보관된 파일의 정체는 manifest 가 이미 갖고 있다. 펼칠 필요가 없다. */
export const readChunkedManifest = async (localPath: string) => {
  const manifestPath = join(chunkDirectoryFor(localPath), "manifest.json");
  return readFile(manifestPath, "utf8")
    .then((text) => JSON.parse(text) as ChunkManifest)
    .catch(() => null);
};

/** 조각으로만 남아 있는 파일을 원래 위치에 되살린다. */
export const materializeChunkedMedia = async (localPath: string) => {
  const target = mediaPathFor(localPath);
  if (existsSync(target) && statSync(target).size > 0) return false;
  return reassemble(chunkDirectoryFor(localPath), target);
};

export const restoreChunkedMedia = async () => {
  const root = mediaSeedDirectory();
  const dirs = await chunkDirectories(root);
  let restored = 0;
  for (const dir of dirs) {
    const localPath = relative(root, dir);
    if (!localPath || localPath.startsWith("..")) continue;
    const target = mediaPathFor(localPath);
    if (existsSync(target) && statSync(target).size > 0) continue;
    if (await reassemble(dir, target)) restored += 1;
  }
  return { restored, chunked: dirs.length };
};

/** 100 MB 를 넘는 파일만 조각으로 만든다. 나머지는 data/media 로 그대로 커밋된다. */
export const produceChunkedMedia = async () => {
  const rows = all<{ local_path: string; bytes: number }>(
    "SELECT local_path, bytes FROM media_files WHERE status = 'downloaded' AND bytes IS NOT NULL"
  );
  const produced: string[] = [];
  for (const row of rows) {
    if (!isChunkable(row.bytes)) continue;
    const source = mediaPathFor(row.local_path);
    if (!existsSync(source)) continue;
    await splitInto(source, chunkDirectoryFor(row.local_path));
    produced.push(row.local_path);
  }
  return produced;
};
