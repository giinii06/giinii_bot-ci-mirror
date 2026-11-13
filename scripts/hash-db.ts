import { stat } from "node:fs/promises";
import { sha256File } from "../src/chunk-files.js";

for (const path of process.argv.slice(2)) {
  const { size } = await stat(path);
  console.log(`${path}\n  size   ${size.toLocaleString()}\n  sha256 ${await sha256File(path)}`);
}
