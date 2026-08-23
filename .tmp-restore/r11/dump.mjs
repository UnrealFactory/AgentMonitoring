import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const CLI = "C:/Code/AgentMonitoring/target/release/agentmon.exe";
const kind = (id) => id.startsWith("WORK") ? "work" : id.startsWith("BUG") ? "bug" : "note";
const ids = process.argv.slice(2);
for (const id of ids) {
  const out = execFileSync(CLI, [kind(id), "view", id, "--json"], { cwd: "C:/Code/AgentMonitoring", encoding: "utf8", maxBuffer: 16*1024*1024 });
  const j = JSON.parse(out);
  const h = j.human ?? "";
  writeFileSync(`C:/Code/AgentMonitoring/.tmp-restore/r11/${id}.live.md`, h, "utf8");
  const words = h.split(/\s+/).filter(Boolean).length;
  console.log(`${id}\t${words} words\t${h.length} chars`);
}
