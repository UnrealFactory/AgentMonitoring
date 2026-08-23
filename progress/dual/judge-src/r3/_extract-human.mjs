// Writes each sampled record's CURRENT human area verbatim, straight from the CLI's
// --json output ("human" field). No trimming, no reformatting.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? ".");
const CLI = resolve(ROOT, "target/release/agentmon.exe");
const OUT = resolve(ROOT, "progress/dual/judge-src/r3");

const targets = [
  ["work", "WORK-0055"],
  ["bug", "BUG-0004"],
  ["note", "handoff-v1-release"],
  ["work", "WORK-0007"],
  ["bug", "BUG-0016"],
  ["work", "WORK-0067"],
  ["note", "python-is-a-store-stub"],
];

const report = [];
for (const [verb, id] of targets) {
  const raw = execFileSync(CLI, [verb, "view", id, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const rec = JSON.parse(raw);
  const human = rec.human;
  const out = resolve(OUT, `${id}.human.md`);
  if (human === null || human === undefined) {
    report.push({ id, out, status: "NULL", bytes: 0 });
    writeFileSync(out, "");
    continue;
  }
  if (typeof human !== "string") {
    report.push({ id, out, status: `NON-STRING(${typeof human})`, bytes: 0 });
    continue;
  }
  writeFileSync(out, human);
  report.push({ id, out, status: "ok", bytes: Buffer.byteLength(human, "utf8") });
}
console.log(JSON.stringify(report, null, 2));
