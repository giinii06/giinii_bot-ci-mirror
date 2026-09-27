import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { all, run } from "./storage.js";

type PendingMedia = {
  media_id: string;
  kind: string;
  filename: string;
  url: string;
  bytes: number | null;
};

const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).replace(/[^A-Za-z0-9.]/g, "").slice(0, 10) : "";
};

export const mediaPathFor = (media: { kind: string; media_id: string; filename: string }) =>
  join(config.mediaRoot, mediaRelativePath(media));

/** DB에는 환경에 의존하지 않는 상대 경로만 저장한다. 컨테이너/호스트 어디서 보든 같은 값이다. */
export const mediaRelativePath = (media: { kind: string; media_id: string; filename: string }) => {
  const safeId = media.media_id.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(media.kind, `${safeId}${extensionOf(media.filename)}`);
};

export const resolveMediaPath = (relativePath: string) => join(config.mediaRoot, relativePath);

type MediaResult =
  | { status: "downloaded"; localPath: string; sha256: string; bytes: number; reused: boolean }
  | { status: "too_large"; bytes: number }
  | { status: "missing" | "failed"; httpStatus?: number };

const markStatus = (mediaId: string, status: string, extra: { localPath?: string; sha256?: string; bytes?: number } = {}) =>
  run(`UPDATE media_files SET status = ?, local_path = COALESCE(?, local_path), sha256 = COALESCE(?, sha256),
       stored_bytes = COALESCE(?, stored_bytes), downloaded_at = CASE WHEN ? = 'downloaded' THEN ? ELSE downloaded_at END
     WHERE media_id = ?`,
    status, extra.localPath ?? null, extra.sha256 ?? null, extra.bytes ?? null,
    status, Date.now(), mediaId);

const storeBuffer = async (target: string, bytes: Buffer) => {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength };
};

export const downloadMedia = async (media: PendingMedia) => {
  const relative = mediaRelativePath(media);
  const target = join(config.mediaRoot, relative);
  if (existsSync(target)) {
    const existing = Buffer.from(await Bun.file(target).arrayBuffer());
    const sha256 = createHash("sha256").update(existing).digest("hex");
    const bytes = existing.byteLength;
    markStatus(media.media_id, "downloaded", { localPath: relative, sha256, bytes });
    return { status: "downloaded", localPath: relative, sha256, bytes, reused: true } satisfies MediaResult;
  }

  const response = await fetch(media.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    markStatus(media.media_id, response.status === 404 ? "missing" : "failed");
    return { status: response.status === 404 ? "missing" : "failed", httpStatus: response.status } satisfies MediaResult;
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > config.mediaMaxBytes) {
    markStatus(media.media_id, "too_large");
    return { status: "too_large", bytes: declared } satisfies MediaResult;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > config.mediaMaxBytes) {
    markStatus(media.media_id, "too_large");
    return { status: "too_large", bytes: bytes.byteLength } satisfies MediaResult;
  }
  const stored = await storeBuffer(target, bytes);
  markStatus(media.media_id, "downloaded", { localPath: relative, ...stored });
  return { status: "downloaded", localPath: relative, ...stored, reused: false } satisfies MediaResult;
};

const takePending = (limit: number): PendingMedia[] =>
  all<PendingMedia>(
    `SELECT media_id, kind, filename, url, bytes FROM media_files
     WHERE status = 'pending' ORDER BY recorded_at LIMIT ?`, limit
  );

const runPool = async (items: PendingMedia[], size: number) => {
  const results: MediaResult[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (!item) return;
      try {
        results.push(await downloadMedia(item));
      } catch (error) {
        console.error(`Media download failed for ${item.media_id}`, error);
        markStatus(item.media_id, "failed");
        results.push({ status: "failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
};

export const drainPendingMedia = async (limit = 200) => {
  const pending = takePending(limit);
  if (pending.length === 0) return { processed: 0, downloaded: 0, failed: 0, tooLarge: 0, missing: 0 };
  const results = await runPool(pending, config.mediaConcurrency);
  const tally = { processed: results.length, downloaded: 0, failed: 0, tooLarge: 0, missing: 0 };
  for (const result of results) {
    if (result.status === "downloaded") tally.downloaded += 1;
    else if (result.status === "too_large") tally.tooLarge += 1;
    else if (result.status === "missing") tally.missing += 1;
    else tally.failed += 1;
  }
  return tally;
};

/** 예전에 환경 절대 경로로 저장된 행을 상대 경로로 되돌린다. 한 번 고치고 나면 다시 일어난다. */
export const normalizeStoredMediaPaths = () => {
  const root = config.mediaRoot.endsWith("/") ? config.mediaRoot : `${config.mediaRoot}/`;
  const rows = all<{ media_id: string; local_path: string }>(
    "SELECT media_id, local_path FROM media_files WHERE local_path LIKE ?", `${root}%`
  );
  for (const row of rows) {
    run("UPDATE media_files SET local_path = ? WHERE media_id = ?", row.local_path.slice(root.length), row.media_id);
  }
  return rows.length;
};

/** 백필이 도는 동안 조용히 받아 두었다가, 다 받아진 뒤 한 번에 정리한다. */
export const startMediaWorker = (intervalMs = 5_000) => {
  const normalized = normalizeStoredMediaPaths();
  if (normalized > 0) console.log(`Media worker: normalized ${normalized} absolute path(s) to relative`);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const tally = await drainPendingMedia();
      if (tally.processed > 0) {
        console.log(`Media worker: ${tally.processed} processed, ${tally.downloaded} saved, ${tally.failed} failed, ${tally.tooLarge} too large, ${tally.missing} missing`);
      }
    } catch (error) {
      console.error("Media worker tick failed", error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
};
