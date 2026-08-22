// Copies a record with its '## For humans' section stripped — for generating eli5
// baselines and judging against the agent area only (never contaminated by our own
// human text). Usage: node agent-area.mjs <record.md> <out.md>
import { readFileSync, writeFileSync } from "node:fs";
const [, , inPath, outPath] = process.argv;
const t = readFileSync(inPath, "utf8");
const i = t.indexOf("\n## For humans");
writeFileSync(outPath, (i === -1 ? t : t.slice(0, i).trimEnd() + "\n"));
console.log(outPath);
