import { listGuildIds } from "../src/storage.js";
import { produceChunkedSeed } from "../src/seed.js";

for (const guildId of listGuildIds()) {
  const manifest = await produceChunkedSeed(guildId);
  console.log(`\n[${guildId}]`);
  for (const part of manifest.parts) {
    console.log(`  ${part.name}  ${part.bytes.toLocaleString()} bytes  ${part.sha256.slice(0, 12)}`);
  }
  console.log(`  ${manifest.parts.length} part(s), total ${manifest.totalBytes.toLocaleString()} bytes, manifest sha256 ${manifest.sha256}`);
}
