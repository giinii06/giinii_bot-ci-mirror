import { all } from "../src/storage.js";
import { chunkIfOversized, chunkedMediaPaths } from "../src/media-seed.js";

/** 이미 저장돼 있는데 아직 조각으로 안 나간 파일을 처리한다. 평소에는 0건이다. */
const rows = all<{ local_path: string }>(
  "SELECT local_path FROM media_files WHERE status = 'downloaded' AND local_path IS NOT NULL"
);

let chunked = 0;
for (const row of rows) {
  if (await chunkIfOversized(row.local_path)) {
    console.log(`chunked  ${row.local_path}`);
    chunked += 1;
  }
}

console.log(`\n${chunked} newly chunked, ${(await chunkedMediaPaths()).length} chunked media file(s) total`);
