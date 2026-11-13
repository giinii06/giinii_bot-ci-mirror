import { chunkIfOversized, materializeChunkedMedia, readChunkedManifest, sha256File, syncChunkedGitignore } from "./media-seed.js";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { finished } from "node:stream/promises";
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

const markStatus = (guildId: string, mediaId: string, status: string, extra: { localPath?: string; sha256?: string; bytes?: number } = {}) =>
  run(guildId, `UPDATE media_files SET status = ?, local_path = COALESCE(?, local_path), sha256 = COALESCE(?, sha256),
       stored_bytes = COALESCE(?, stored_bytes), downloaded_at = CASE WHEN ? = 'downloaded' THEN ? ELSE downloaded_at END
     WHERE media_id = ?`,
    status, extra.localPath ?? null, extra.sha256 ?? null, extra.bytes ?? null,
    status, Date.now(), mediaId);

class MediaTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`media is larger than ${config.mediaMaxBytes} bytes`);
    this.name = "MediaTooLargeError";
  }
}

/** 파일 전체를 메모리에 올리지 않고 내려받으면서 해시를 만든다. */
const streamToFile = async (target: string, response: Response) => {
  await mkdir(dirname(target), { recursive: true });
  const hash = createHash("sha256");
  const out = createWriteStream(target);
  let bytes = 0;
  try {
    if (!response.body) throw new Error(`empty response body for ${target}`);
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > config.mediaMaxBytes) throw new MediaTooLargeError(bytes);
      hash.update(buffer);
      if (!out.write(buffer)) await new Promise((resolve) => out.once("drain", resolve));
    }
    out.end();
    await finished(out);
  } catch (error) {
    out.destroy();
    await rm(target, { force: true });
    throw error;
  }
  return { sha256: hash.digest("hex"), bytes };
};

const finishStored = async (guildId: string, mediaId: string, relative: string, stored: { sha256: string; bytes: number }, reused: boolean) => {
  markStatus(guildId, mediaId, "downloaded", { localPath: relative, sha256: stored.sha256, bytes: stored.bytes });
  if (await chunkIfOversized(relative)) {
    console.log(`Media worker: chunked ${relative} into 30mb parts (${stored.bytes.toLocaleString()} bytes is over the git file cap)`);
  }
  return { status: "downloaded", localPath: relative, sha256: stored.sha256, bytes: stored.bytes, reused } satisfies MediaResult;
};

export const downloadMedia = async (guildId: string, media: PendingMedia) => {
  const relative = mediaRelativePath(media);
  const target = join(config.mediaRoot, relative);

  const chunked = await readChunkedManifest(relative);
  if (chunked && !existsSync(target)) {
    return finishStored(guildId, media.media_id, relative, { sha256: chunked.sha256, bytes: chunked.bytes }, true);
  }

  await materializeChunkedMedia(relative);
  if (existsSync(target)) {
    const info = await stat(target);
    return finishStored(guildId, media.media_id, relative, { sha256: await sha256File(target), bytes: info.size }, true);
  }

  const response = await fetch(media.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    markStatus(guildId, media.media_id, response.status === 404 ? "missing" : "failed");
    return { status: response.status === 404 ? "missing" : "failed", httpStatus: response.status } satisfies MediaResult;
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > config.mediaMaxBytes) {
    markStatus(guildId, media.media_id, "too_large");
    return { status: "too_large", bytes: declared } satisfies MediaResult;
  }

  try {
    const stored = await streamToFile(target, response);
    return finishStored(guildId, media.media_id, relative, stored, false);
  } catch (error) {
    if (error instanceof MediaTooLargeError) {
      markStatus(guildId, media.media_id, "too_large");
      return { status: "too_large", bytes: error.bytes } satisfies MediaResult;
    }
    throw error;
  }
};

const takePending = (guildId: string, limit: number): PendingMedia[] =>
  all<PendingMedia>(
    guildId,
    `SELECT media_id, kind, filename, url, bytes FROM media_files
     WHERE status = 'pending' ORDER BY recorded_at LIMIT ?`, limit
  );

const runPool = async (guildId: string, items: PendingMedia[], size: number) => {
  const results: MediaResult[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (!item) return;
      try {
        results.push(await downloadMedia(guildId, item));
      } catch (error) {
        console.error(`Media download failed for ${item.media_id}`, error);
        markStatus(guildId, item.media_id, "failed");
        results.push({ status: "failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
};

/** 서버별로 pending 을 나눠 받는다. 한 서버가 멈춰도 다른 서버 미디어는 계속 받는다. */
export const drainPendingMedia = async (guildId: string, limit = 200) => {
  const pending = takePending(guildId, limit);
  if (pending.length === 0) return { processed: 0, downloaded: 0, failed: 0, tooLarge: 0, missing: 0 };
  const results = await runPool(guildId, pending, config.mediaConcurrency);
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
export const normalizeStoredMediaPaths = (guildId: string) => {
  const root = config.mediaRoot.endsWith("/") ? config.mediaRoot : `${config.mediaRoot}/`;
  const rows = all<{ media_id: string; local_path: string }>(
    guildId, "SELECT media_id, local_path FROM media_files WHERE local_path LIKE ?", `${root}%`
  );
  for (const row of rows) {
    run(guildId, "UPDATE media_files SET local_path = ? WHERE media_id = ?", row.local_path.slice(root.length), row.media_id);
  }
  return rows.length;
};

/**
 * 워커는 pending 만 처리하므로 일시적 실패(failed)는 기동마다 한 번 재시도하고,
 * 크기 제한으로 건너뛴 항목(too_large)은 현재 제한 안에 들어왔을 때만 다시 받는다.
 * 없는 파일(missing)은 영구 상태이므로 건드리지 않는다.
 */
export const requeueRetryableMedia = (guildId: string) => {
  const oversized = all<{ media_id: string }>(
    guildId, "SELECT media_id FROM media_files WHERE status = 'too_large' AND bytes IS NOT NULL AND bytes <= ?", config.mediaMaxBytes
  );
  for (const row of oversized) run(guildId, "UPDATE media_files SET status = 'pending' WHERE media_id = ?", row.media_id);
  const failed = all<{ media_id: string }>(guildId, "SELECT media_id FROM media_files WHERE status = 'failed'");
  for (const row of failed) run(guildId, "UPDATE media_files SET status = 'pending' WHERE media_id = ?", row.media_id);
  return { oversized: oversized.length, failed: failed.length };
};

export const startMediaWorker = async (getGuildIds: string[] | (() => string[]), intervalMs = 5_000) => {
  // 멀티 서버 모드: 기동 시점 스냅샷에 갇히지 않도록 tick 마다 live 목록을 다시 읽는다.
  // GuildCreate 로 늦게 들어온 서버도 다음 tick 부터 자동으로 처리된다.
  const resolveIds = () => (typeof getGuildIds === "function" ? getGuildIds() : getGuildIds);
  // 조각 파일은 필요할 때 펼친다. 기동 시 전부 복원하면 data/media 에 다시 큰 파일이
  // 나타나 git 트리가 푸시 불가해지고 시작도 느려진다.
  await syncChunkedGitignore();
  for (const guildId of resolveIds()) {
    const requeued = requeueRetryableMedia(guildId);
    if (requeued.oversized > 0 || requeued.failed > 0) {
      console.log(`Media worker (${guildId}): requeued ${requeued.oversized} oversized and ${requeued.failed} failed media file(s)`);
    }
    const normalized = normalizeStoredMediaPaths(guildId);
    if (normalized > 0) console.log(`Media worker (${guildId}): normalized ${normalized} absolute path(s) to relative`);
  }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const guildId of resolveIds()) {
        const tally = await drainPendingMedia(guildId);
        if (tally.processed > 0) {
          console.log(`Media worker (${guildId}): ${tally.processed} processed, ${tally.downloaded} saved, ${tally.failed} failed, ${tally.tooLarge} too large, ${tally.missing} missing`);
        }
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
