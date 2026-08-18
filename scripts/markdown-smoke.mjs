#!/usr/bin/env node
/**
 * Data-fidelity smoke for the record renderer's parser.
 *
 *   node scripts/markdown-smoke.mjs            # fixtures + every record in ./vault
 *   node scripts/markdown-smoke.mjs --vault X  # …and a vault somewhere else
 *
 * There is no unit-test runner in this project, and one parser bug already ate a number
 * out of a live record (WORK-0005 update 1: "…503 for three hours, then / 200." rendered
 * as a list item "1.", deleting the 200). So this file does two things:
 *
 *   1. asserts on fixtures taken verbatim from the vault, including that one;
 *   2. sweeps every record in the vault and fails if any *word* of the source is missing
 *      from the parsed output — a renderer may reformat, it may never lose data.
 *
 * It runs the real module (node 24 strips the TypeScript), so it tests what ships.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBlocks, parseInline, inlineText } from "../src/lib/markdown-parse.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const vaultArg = args.indexOf("--vault");
const vault = vaultArg >= 0 && args[vaultArg + 1] ? args[vaultArg + 1] : join(root, "vault");

let failures = 0;
let checks = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
}

const eq = (name, actual, expected) =>
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/** Flatten a parsed block back to the text a reader would see. */
function blockText(b) {
  switch (b.kind) {
    case "code":
      return `${b.lang} ${b.text}`;
    case "list":
      // Markers included: an ordered list that renumbers itself is exactly the failure
      // this file exists to catch, and the numbers are part of what the reader sees.
      return b.items
        .map((it, i) => `${b.ordered ? `${b.start + i}.` : "-"} ${inlineText(parseInline(it))}`)
        .join("\n");
    case "table":
      return [b.header, ...b.rows].flat().map((c) => inlineText(parseInline(c))).join(" ");
    case "rule":
      return "";
    default:
      return inlineText(parseInline(b.text));
  }
}

const rendered = (src) => parseBlocks(src).map(blockText).join("\n");

/* ---------------------------------------------------------------- fixtures */

console.log("fixtures");

// 1. The bug this file exists for: a wrapped sentence whose second line starts with a
//    number is a sentence. (vault/projects/relay/worklogs/WORK-0005.md, update 1)
{
  const src = [
    "Setup: 4,300 pending deliveries for one endpoint, receiver returns 503 for three hours, then",
    "200. Without jitter, 4,300 deliveries came due inside the same 900ms window every step of",
    "the way.",
  ].join("\n");
  const blocks = parseBlocks(src);
  const flow = rendered(src).replace(/\s+/g, " ");
  eq("wrapped '200.' stays one paragraph", blocks.length, 1);
  eq("…and is a paragraph, not a list", blocks[0].kind, "paragraph");
  check("…and still contains the 200", flow.includes("then 200. Without jitter"), flow);
}

// 2. A list that really does start mid-sequence keeps its own numbers.
{
  const blocks = parseBlocks("3. third step\n4. fourth step");
  eq("list starting at 3 is a list", blocks[0].kind, "list");
  eq("…reports start 3", blocks[0].start, 3);
  eq("…and keeps both items", blocks[0].items.length, 2);
}

// 3. A list numbered from 1 may interrupt a paragraph (CommonMark), and does.
{
  const blocks = parseBlocks("The shape of the fix:\n1. Claim in its own transaction.\n2. Send with no connection held.");
  eq("paragraph before a 1. list", blocks[0].kind, "paragraph");
  eq("…then the list", blocks[1].kind, "list");
  eq("…starting at 1", blocks[1].start, 1);
}

// 4. Markup nests: code inside bold (vault/projects/relay/worklogs/WORK-0005.md follow-ups).
{
  const nodes = parseInline("**`Retry-After` is ignored.**");
  eq("bold wraps the whole run", nodes.length, 1);
  eq("…as strong", nodes[0].kind, "strong");
  eq("…whose first child is code", nodes[0].children[0].kind, "code");
  eq("…with the backticks gone", inlineText(nodes), "Retry-After is ignored.");
}

// 5. A record id inside bold is still a cross-reference.
{
  const nodes = parseInline("**WORK-0001 shipped without a sweeper.**");
  eq("ref inside strong is a ref", nodes[0].children[0].kind, "ref");
  eq("…with the id intact", nodes[0].children[0].id, "WORK-0001");
}

// 6. Ids inside code spans stay literal (they are shell text, not links).
{
  const nodes = parseInline("`agentmon bug view BUG-0004 -p relay`");
  eq("code span is one node", nodes.length, 1);
  eq("…of kind code", nodes[0].kind, "code");
  check("…containing the id as text", nodes[0].text.includes("BUG-0004"));
}

// 7. Indented transcripts stay verbatim (vault/projects/relay/bugs/BUG-0008.md).
{
  const src = [
    "Observed on staging:",
    "",
    "    12:03:11  attempt 1  429 Retry-After: 120",
    "    12:03:21  attempt 2  429 Retry-After: 120     (ladder step 1: 10s)",
    "",
    "Four requests inside the two-minute window.",
  ].join("\n");
  const blocks = parseBlocks(src);
  eq("transcript is a code block", blocks[1].kind, "code");
  check("…with its columns kept", blocks[1].text.includes("attempt 2  429 Retry-After: 120     (ladder"));
  eq("…and the prose after it survives", blocks[2].kind, "paragraph");
}

// 8. Snake_case identifiers are not emphasis (`locked_at`, `idle in transaction`).
{
  const nodes = parseInline("rows whose locked_at is older than the send timeout");
  eq("underscores are plain text", nodes.length, 1);
  eq("…untouched", nodes[0].text, "rows whose locked_at is older than the send timeout");
}

// 9. Links keep their label markup and their href.
{
  const nodes = parseInline("see [the *manual*](https://cli.github.com/manual)");
  const link = nodes.find((n) => n.kind === "link");
  check("link parsed", !!link);
  eq("…href kept", link.href, "https://cli.github.com/manual");
  eq("…label markup parsed", link.children.some((c) => c.kind === "em"), true);
}

/* ------------------------------------------------------- every vault record */

console.log("vault sweep");

/** Words the renderer is allowed to consume: markdown syntax itself. */
const SYNTAX = /^[-*_>#`|.)(\[\]]+$/;
/** Emphasis and code fences are markup, not letters — compare without them. */
const bare = (s) => s.replace(/[`*]/g, "");

function sweep(file) {
  const raw = readFileSync(file, "utf8");
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const out = bare(rendered(body));
  const missing = [];
  for (const word of body.split(/\s+/)) {
    const w = bare(word.trim()).replace(/^[(\[]+/, "").replace(/[)\].,;:]+$/, "");
    if (!w || SYNTAX.test(w)) continue;
    if (!out.includes(w)) missing.push(w);
  }
  check(`${file.split(/[\\/]/).slice(-3).join("/")} loses nothing`, missing.length === 0, missing.slice(0, 6).join(" · "));
}

if (!existsSync(vault)) {
  console.error(`  no vault at ${vault} — fixtures only`);
} else {
  const projects = join(vault, "projects");
  for (const slug of existsSync(projects) ? readdirSync(projects) : []) {
    for (const kind of ["worklogs", "bugs"]) {
      const dir = join(projects, slug, kind);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) sweep(join(dir, f));
    }
  }
}

console.log(
  failures === 0
    ? `\nOK — ${checks} checks passed`
    : `\nFAILED — ${failures} of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
