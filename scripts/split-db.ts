import { produceChunkedSeed } from "../src/seed.js";

const manifest = await produceChunkedSeed();

for (const part of manifest.parts) {
  console.log(`${part.name}  ${part.bytes.toLocaleString()} bytes  ${part.sha256.slice(0, 12)}`);
}
console.log(`\n${manifest.parts.length} part(s), total ${manifest.totalBytes.toLocaleString()} bytes`);
console.log(`manifest sha256 ${manifest.sha256}`);
