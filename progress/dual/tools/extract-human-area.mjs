// One-off prep helper: writes each sampled record's CURRENT human area verbatim
// from the CLI's --json output into progress/dual/judge-src/r1/<id>.human.md
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const CLI = "C:/Code/AgentMonitoring/target/release/agentmon.exe";
const OUT = "C:/Code/AgentMonitoring/progress/dual/judge-src/r1";
const CWD = "C:/Code/AgentMonitoring";

const records = [
  ["work", "WORK-0055"],
  ["bug", "BUG-0004"],
  ["note", "handoff-v1-release"],
  ["work", "WORK-0007"],
  ["bug", "BUG-0016"],
  ["work", "WORK-0067"],
  ["note", "python-is-a-store-stub"],
];

const nulls = [];
for (const [kind, id] of records) {
  const raw = execFileSync(CLI, [kind, "view", id, "--json"], {
    cwd: CWD,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const obj = JSON.parse(raw);
  const human = obj.human;
  const out = `${OUT}/${id}.human.md`;
  if (human === null || human === undefined) {
    nulls.push(`${id} (human === ${human === null ? "null" : "undefined"})`);
    console.log(`NULL-HUMAN\t${id}\t${kind}`);
    continue;
  }
  if (typeof human !== "string") {
    nulls.push(`${id} (human is ${typeof human}, not string)`);
    console.log(`NON-STRING-HUMAN\t${id}\t${typeof human}`);
    continue;
  }
  writeFileSync(out, human);
  console.log(`OK\t${id}\t${Buffer.byteLength(human, "utf8")} bytes`);
}

if (nulls.length) {
  console.log("\n!!! NULL/INVALID HUMAN FIELDS: " + nulls.join(", "));
  process.exitCode = 2;
} else {
  console.log("\nAll 7 human fields present as strings.");
}
