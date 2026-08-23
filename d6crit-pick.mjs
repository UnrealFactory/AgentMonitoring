/** D6: pick live records by the shape of their human area (chars, beats, closing line). */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = "C:/Code/AgentMonitoring/AgentMonitoring";
const rows = [];
for (const kind of ["worklogs", "bugs", "notes"]) {
  const dir = join(root, kind);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const src = readFileSync(join(dir, f), "utf8");
    const i = src.indexOf("\n## For humans");
    if (i < 0) continue;
    const human = src.slice(i + "\n## For humans".length).trim();
    const paras = human.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const beats = paras.filter((p) => /^\*\*/.test(p)).length;
    const last = paras[paras.length - 1] ?? "";
    const takeaway = !/^\*\*/.test(last) && last.length <= 200 && !last.includes("\n");
    rows.push({
      kind,
      id: f.replace(/\.md$/, ""),
      chars: human.length,
      paras: paras.length,
      beats,
      takeaway,
      lastLen: last.length,
    });
  }
}
rows.sort((a, b) => b.chars - a.chars);
console.log("longest 12:");
for (const r of rows.slice(0, 12))
  console.log(
    `  ${r.kind.padEnd(9)} ${r.id.padEnd(34)} chars=${String(r.chars).padStart(5)} paras=${String(r.paras).padStart(2)} beats=${String(r.beats).padStart(2)} takeaway=${r.takeaway} lastLen=${r.lastLen}`
  );
console.log("\nlongest per kind (with beats>=3 and takeaway):");
for (const kind of ["worklogs", "bugs", "notes"]) {
  const best = rows.filter((r) => r.kind === kind && r.beats >= 3 && r.takeaway).slice(0, 3);
  for (const r of best)
    console.log(`  ${kind.padEnd(9)} ${r.id.padEnd(34)} chars=${r.chars} beats=${r.beats}`);
}
console.log("\ntotals:", rows.length, "no-takeaway:", rows.filter((r) => !r.takeaway).length);
