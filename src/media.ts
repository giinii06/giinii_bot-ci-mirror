import { restoreChunkedMedia } from "./media-seed.js";
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
/**
 * 워커는 pending 만 처리하므로 일시적 실패(failed)는 기동마다 한 번 재시도하고,
 * 크기 제한으로 건너뛴 항목(too_large)은 현재 제한 안에 들어왔을 때만 다시 받는다.
 * 없는 파일(missing)은 영구 상태이므로 건드리지 않는다.
 */
export const requeueRetryableMedia = () => {
  const oversized = all<{ media_id: string }>(
    "SELECT media_id FROM media_files WHERE status = 'too_large' AND bytes IS NOT NULL AND bytes <= ?", config.mediaMaxBytes
  );
  for (const row of oversized) run("UPDATE media_files SET status = 'pending' WHERE media_id = ?", row.media_id);
  const failed = all<{ media_id: string }>("SELECT media_id FROM media_files WHERE status = 'failed'");
  for (const row of failed) run("UPDATE media_files SET status = 'pending' WHERE media_id = ?", row.media_id);
  return { oversized: oversized.length, failed: failed.length };
};

export const startMediaWorker = async (intervalMs = 5_000) => {
  const { restored, chunked } = await restoreChunkedMedia();
  if (restored > 0) console.log(`Media worker: restored ${restored} of ${chunked} chunked media file(s)`);
  const requeued = requeueRetryableMedia();
  if (requeued.oversized > 0 || requeued.failed > 0) {
    console.log(`Media worker: requeued ${requeued.oversized} oversized and ${requeued.failed} failed media file(s)`);
  }
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
