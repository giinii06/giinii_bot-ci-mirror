import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../src/config.js";
import { mediaSeedDirectory, produceChunkedMedia } from "../src/media-seed.js";

const produced = await produceChunkedMedia();
const root = mediaSeedDirectory();

for (const localPath of produced) console.log(`chunked  ${localPath}`);

// 원본은 디스크에 남긴다(로컬에서는 바로 쓰인다). git 에서는 조각만 보내고 원본은 제외한다 —
// 그래야 clone 한 곳에서 media-seed 가 원래 위치로 되살린다.
const MARK_START = "# >>> chunked media (scripts/chunk-media.ts)";
const MARK_END = "# <<< chunked media";
const gitignorePath = join(config.mediaRoot, "..", "..", ".gitignore");
const current = await readFile(gitignorePath, "utf8");
const base = current.split(MARK_START)[0]!.trimEnd();
await writeFile(
  gitignorePath,
  `${base}\n${MARK_START}\n${["!data/media-seed/", ...produced.map((p) => `data/media/${p}`)].join("\n")}\n${MARK_END}\n`
);

console.log(`\n${produced.length} chunked under ${root}`);
console.log(".gitignore 의 chunked media 블록을 갱신했습니다.");
