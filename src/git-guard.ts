import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * GitHub 는 100 MB 를 넘는 blob 을 push 단계에서 거절한다. 그때는 이미 커밋이 만들어진 뒤라
 * 복구가 어렵다. 30 MB 로 잘라 두면 조각만 올라가고, 복원은 각 조각의 manifest.json
 * (서버 시드는 data/seed/<서버ID>/, 미디어는 data/media-seed/)이 담당한다.
 *
 * 조각 하나의 크기가 정확히 이 값이라 `>` 로 비교한다 — `>=` 면 조각 자체가 거부된다.
 *
 * 의존성을 갖지 않아야 한다 — git 훅에서 실행되는데, src/config.ts 는 import 시점에
 * DISCORD_BOT_TOKEN 을 요구하므로 하나만 추가해도 훅이 조용히 죽는다.
 */
export const MAX_COMMITTED_FILE_BYTES = 30 * 1024 * 1024;

export type OversizedFile = { path: string; bytes: number };

const git = async (args: string[], cwd?: string): Promise<string> => {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
};

const nulList = (raw: string) => raw.split("\0").filter((entry) => entry.length > 0);

export const stagedPaths = async (cwd?: string): Promise<string[]> =>
  nulList(await git(["diff", "--cached", "--name-only", "-z"], cwd));

export const trackedPaths = async (cwd?: string): Promise<string[]> =>
  nulList(await git(["ls-files", "-z"], cwd));

const sizeOf = async (cwd: string | undefined, path: string): Promise<number | null> => {
  const resolved = cwd && !isAbsolute(path) ? join(cwd, path) : path;
  const info = await stat(resolved).catch(() => null);
  return info?.isFile() ? info.size : null;
};

export const findOversized = async (paths: string[], cwd?: string): Promise<OversizedFile[]> => {
  const found: OversizedFile[] = [];
  for (const path of paths) {
    const bytes = await sizeOf(cwd, path);
    if (bytes !== null && bytes > MAX_COMMITTED_FILE_BYTES) found.push({ path, bytes });
  }
  return found.sort((a, b) => b.bytes - a.bytes);
};

export const oversizedStagedFiles = async (cwd?: string) => findOversized(await stagedPaths(cwd), cwd);
export const oversizedTrackedFiles = async (cwd?: string) => findOversized(await trackedPaths(cwd), cwd);

const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** 거부 사유와 복구 방법을 함께 알린다. 조각화는 앱 컨텍스트가 필요하므로 하지 않고 안내만 한다. */
export const formatOversizedReport = (files: OversizedFile[]): string => {
  const lines = files.map((file) => `  ${mib(file.bytes).padStart(10)}  ${file.path}`);
  return [
    `30 MB 를 넘는 파일 ${files.length}개를 커밋할 수 없습니다.`,
    ...lines,
    "",
    "이 저장소는 30 MB 를 넘는 파일을 조각으로 나눠 커밋합니다.",
    "  bun run scripts/split-db.ts     # data/guilds/*.sqlite -> data/seed/<서버ID>/ 조각",
    "  bun run scripts/chunk-media.ts  # data/media 의 큰 파일 -> data/media-seed/ 조각",
    "조각을 만든 뒤 원본은 .gitignore 로 빠져야 합니다. 그 다음 git rm --cached <원본 경로> 로 인덱스에서 빼세요."
  ].join("\n");
};
