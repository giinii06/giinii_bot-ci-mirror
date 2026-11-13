import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { dirname, join } from "node:path";

export const sha256File = (path: string) =>
  new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", reject);
  });

export type AssembleResult =
  | { ok: true; bytes: number }
  | { ok: false; bytes: number; reason: "size" | "sha256" };

/**
 * 조각을 임시 파일로 모아 크기와 sha256을 확인한 뒤 대상 경로로 옮긴다.
 * 검증에 실패하면 임시 파일만 지우고 기존 대상을 건드리지 않는다.
 */
export const assembleParts = async (
  sourceDirectory: string,
  target: string,
  parts: { name: string }[],
  expected: { bytes: number; sha256: string }
): Promise<AssembleResult> => {
  const staging = `${target}.restoring`;
  await mkdir(dirname(target), { recursive: true });
  await rm(staging, { force: true });
  const out = createWriteStream(staging);
  const hash = createHash("sha256");
  let written = 0;

  try {
    for (const part of parts) {
      for await (const chunk of createReadStream(join(sourceDirectory, part.name))) {
        hash.update(chunk);
        written += chunk.length;
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
      }
    }
    out.end();
    await finished(out);
  } catch (error) {
    out.destroy();
    await rm(staging, { force: true });
    throw error;
  }

  if (written !== expected.bytes) {
    await rm(staging, { force: true });
    return { ok: false, bytes: written, reason: "size" };
  }
  if (hash.digest("hex") !== expected.sha256) {
    await rm(staging, { force: true });
    return { ok: false, bytes: written, reason: "sha256" };
  }
  await rename(staging, target);
  return { ok: true, bytes: written };
};
