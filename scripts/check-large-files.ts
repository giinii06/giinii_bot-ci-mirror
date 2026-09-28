import { formatOversizedReport, oversizedStagedFiles, oversizedTrackedFiles } from "../src/git-guard.js";

const tracked = process.argv.includes("--tracked");
const scope = tracked ? "tracked" : "staged";
const files = tracked ? await oversizedTrackedFiles() : await oversizedStagedFiles();

if (files.length === 0) {
  console.log(`guard: no ${scope} file over 30 MB`);
  process.exit(0);
}

console.error(formatOversizedReport(files));
process.exit(1);
