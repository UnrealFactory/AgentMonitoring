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
import { splitLabelledSections } from "../src/lib/sections.ts";

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

// 10. Resolutions split into the parts their author labelled, and the proof is one of them.
{
  const src = [
    "**Root cause.** `dispatcher.rs` ran the claim, the send and the release in one",
    "transaction.",
    "",
    "**Fix**, in `relay-worker/src/dispatcher.rs` and `relay-store/src/queue.rs`:",
    "",
    "1. The claim gets its own transaction.",
    "2. The send holds no connection.",
    "",
    "**Verified.**",
    "",
    "- `cargo test --workspace` — 71 passed.",
    "- Killed a worker mid-batch: 41 deliveries reclaimed 90 seconds later.",
    "",
    "**Consequence, stated plainly.** At-least-once becomes reachable through a new door.",
  ].join("\n");
  const { preamble, sections } = splitLabelledSections(src);
  eq("nothing before the first label", preamble, "");
  eq("four labelled parts", sections.length, 4);
  eq("…first is the cause", sections[0].label, "Root cause");
  eq("…the fix keeps its binding clause on the heading", sections[1].trailer.startsWith(","), true);
  eq("…and counts its steps", sections[1].items, 2);
  eq("…the proof is found", sections[2].evidence, true);
  eq("…with its checks counted", sections[2].items, 2);
  eq("…and gets its own anchor", sections[2].id, "res-verified");
  eq("…a long label is shortened for the rail", sections[3].short, "Consequence");
  eq("…without rewriting the heading", sections[3].label, "Consequence, stated plainly");
  check(
    "…and the fix's own words stay in its body",
    sections[1].body.includes("The claim gets its own transaction."),
    sections[1].body,
  );
}

// 11. A resolution written as plain prose is left exactly as it is — no invented headings.
{
  const src = "Replaced the capturing closure with a free function.\n\nVerified with `cargo build`.";
  const { preamble, sections } = splitLabelledSections(src);
  eq("no sections invented", sections.length, 0);
  eq("…and the text is untouched", preamble, src);
}

// 12. One bold lead-in is an emphasised sentence, not a section (two is a pattern).
{
  const { sections } = splitLabelledSections("**Note.** The endpoint was already dead.");
  eq("a single label is not a structure", sections.length, 0);
}

/* ------------------------------------------------------- every vault record */

console.log("vault sweep");

/** Words the renderer is allowed to consume: markdown syntax itself. */
const SYNTAX = /^[-*_>#`|.)(\[\]]+$/;
/** Emphasis and code fences are markup, not letters — compare without them. */
const bare = (s) => s.replace(/[`*]/g, "");

/** Every word of `source` that `out` does not contain. */
function lost(source, out) {
  const missing = [];
  for (const word of source.split(/\s+/)) {
    const w = bare(word.trim()).replace(/^[(\[]+/, "").replace(/[)\].,;:]+$/, "");
    if (!w || SYNTAX.test(w)) continue;
    if (!out.includes(w)) missing.push(w);
  }
  return missing;
}

function sweep(file) {
  const raw = readFileSync(file, "utf8");
  const name = file.split(/[\\/]/).slice(-3).join("/");
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const missing = lost(body, bare(rendered(body)));
  check(`${name} loses nothing`, missing.length === 0, missing.slice(0, 6).join(" · "));

  // The record page splits Resolution and Outcome into the parts their author labelled.
  // Splitting is a re-arrangement of the author's bytes and must lose none of them either.
  const parts = body.split(/\n## (?:Resolution|Outcome)\s*\n/);
  if (parts.length < 2) return;
  const section = parts.slice(1).join("\n").split(/\n## /)[0];
  const { preamble, sections } = splitLabelledSections(section);
  if (!sections.length) return;
  const out = bare(
    [preamble, ...sections.map((s) => `${s.label} ${s.trailer} ${s.body}`)].join("\n"),
  );
  const dropped = lost(section, out);
  check(`${name} splits without loss`, dropped.length === 0, dropped.slice(0, 6).join(" · "));
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
