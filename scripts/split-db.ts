import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CHUNK_SIZE = 30 * 1024 * 1024;
const SEED_DIR = resolve(process.argv[2] ?? "data/seed");
const SOURCE = resolve(process.argv[3] ?? "data/bot.sqlite");
const PREFIX = "bot.sqlite.part-";

const sha256 = (path: string) =>
  new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", reject);
  });

await mkdir(SEED_DIR, { recursive: true });

for (const name of await readdir(SEED_DIR)) {
  if (name.startsWith(PREFIX) || name === "manifest.json") {
    await rm(join(SEED_DIR, name), { force: true });
  }
}

const { size } = await stat(SOURCE);
const partCount = Math.max(1, Math.ceil(size / CHUNK_SIZE));
const parts: { name: string; bytes: number; sha256: string }[] = [];

for (let index = 0; index < partCount; index += 1) {
  const start = index * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, size);
  const name = `${PREFIX}${String(index + 1).padStart(3, "0")}`;
  const target = join(SEED_DIR, name);

  const out = createWriteStream(target);
  const stream = createReadStream(SOURCE, { start, end: end - 1 });
  for await (const chunk of stream) {
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((r) => out.end(r));

  const partStat = await stat(target);
  parts.push({ name, bytes: partStat.size, sha256: await sha256(target) });
  console.log(`${name}  ${partStat.size.toLocaleString()} bytes`);
}

const manifest = {
  source: SOURCE.split("/").pop(),
  totalBytes: size,
  chunkBytes: CHUNK_SIZE,
  sha256: await sha256(SOURCE),
  parts
};
await writeFile(join(SEED_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\n${partCount} part(s), total ${size.toLocaleString()} bytes`);
console.log(`manifest written to ${join(SEED_DIR, "manifest.json")}`);
