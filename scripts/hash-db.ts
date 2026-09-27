import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const sha256 = (path: string) =>
  new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolvePromise(hash.digest("hex")))
      .on("error", reject);
  });

for (const path of process.argv.slice(2)) {
  const { size } = await stat(path);
  console.log(`${path}\n  size   ${size.toLocaleString()}\n  sha256 ${await sha256(path)}`);
}
