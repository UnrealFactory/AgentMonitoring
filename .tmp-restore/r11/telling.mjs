// Mirror of crates/agentmon-core/src/human.rs longest_telling.
import { readFileSync } from "node:fs";
const words = (s) => s.split(/[ \t\r\n ]+/).filter(Boolean).length;
const isLeadIn = (line) => {
  let t = line.trim();
  if (t.startsWith("-") || t.startsWith("+")) t = t.slice(1).trim();
  if (!t.startsWith("**")) return false;
  return t.slice(2).includes("**");
};
export function longestTelling(text) {
  let longest = 0, run = 0, blockStart = true, fence = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) { fence = !fence; run += words(line); blockStart = false; continue; }
    if (!fence && t === "") { blockStart = true; continue; }
    if (!fence && blockStart && isLeadIn(line)) { longest = Math.max(longest, run); run = 0; }
    blockStart = false;
    run += words(line);
  }
  return Math.max(longest, run);
}
for (const f of process.argv.slice(2)) {
  const t = readFileSync(f, "utf8");
  const blocks = [];
  let cur = [];
  for (const line of t.split("\n")) {
    if (line.trim() === "") { continue; }
    if (isLeadIn(line) && cur.length) { blocks.push(cur.join(" ")); cur = []; }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join(" "));
  const name = f.split(/[\/]/).pop();
  console.log(`${name}\ttotal ${words(t)}\tlongest telling ${longestTelling(t)}\tblocks ${blocks.length} [${blocks.map(words).join(",")}]`);
}
