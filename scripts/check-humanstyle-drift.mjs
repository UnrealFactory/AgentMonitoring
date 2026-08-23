#!/usr/bin/env node
/**
 * One contract, three surfaces — the doc, the doc the binary carries, and the block a
 * refusal prints. Prove they are the same bytes.
 *
 *   npm run check:humanstyle
 *   node scripts/check-humanstyle-drift.mjs [--verbose]
 *
 * ## Why this gate exists
 *
 * No agent reads docs/HUMAN_STYLE.md off disk. It reaches them two ways, and both go
 * through the binary. The compact rules — the block between the `<!-- compact-rules -->`
 * markers — are cut out at build time by `crates/agentmon-core/build.rs`; every `--human`
 * refusal prints them whole and mcp/lib/tools.mjs hands the same block over on the first
 * tool result of a session. The rest of the document, the worked example that is four
 * fifths of it, goes over whole when someone asks: `agentmon human-style`, or
 * `status(mode="human_style")`, which shells out to exactly that.
 *
 * So the doc can be edited and what actually teaches stays whatever the last
 * `cargo build --release` froze into target/release. That is not hypothetical: round 5 of
 * the human-area work found exactly that — the shipped binary teaching a superseded
 * contract while the document on screen said something else, caught only because someone
 * compared them by hand. Editing prose does not feel like a code change, so nobody
 * rebuilds, and nothing anywhere says the two disagree.
 *
 * Three surfaces, compared byte for byte after a trim:
 *
 *   1. docs/HUMAN_STYLE.md, read here, now — the source of truth, whole.
 *   2. `agentmon human-style` stdout — the whole contract as the binary carries it
 *      (`include_str!`), the copy an agent gets when it asks for the contract. Compared
 *      whole, because a stale worked example misleads exactly as far as stale rules do.
 *   3. `agentmon human-style --json` → `compactRules` — the block build.rs extracted into
 *      the binary, the bytes a refusal and the MCP hand-over print. A second extraction
 *      from the same file, so it can be stale or mis-cut while surface 2 is fine.
 *
 * Any difference is a stale build, and the repair is always the same one command. A missing
 * or empty block fails too: a rejection with no rules teaches nothing, which is why
 * build.rs refuses to build one.
 *
 * Spawns the CLI twice, reads one file, writes nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Prove the style rules inside the agentmon binary are the ones in the doc.

  npm run check:humanstyle
  node scripts/check-humanstyle-drift.mjs [--verbose]

  --verbose    print the compact block that matched, not just its size

Compares docs/HUMAN_STYLE.md whole against what \`agentmon human-style\` prints, and its
<!-- compact-rules --> block against the compactRules the binary prints on a refusal. A
difference means the release binary was built before the doc was edited, and the fix is
\`cargo build --release -p agentmon-cli\`.`);
  process.exit(0);
}

const VERBOSE = args.includes("--verbose") || args.includes("-v");
const log = (...m) => console.log("[check-humanstyle-drift]", ...m);
const REBUILD = "rebuild: cargo build --release -p agentmon-cli";
const rel = (p) => relative(repoRoot, p).replaceAll("\\", "/");
const die = (msg) => {
  console.error(`[check-humanstyle-drift] FAILED: ${msg}`);
  process.exit(1);
};

const OPEN = "<!-- compact-rules -->";
const CLOSE = "<!-- /compact-rules -->";

/** The block between the markers, trimmed — null when it is missing, unclosed or empty. */
function compactRules(text) {
  const from = text.indexOf(OPEN);
  if (from < 0) return null;
  const to = text.indexOf(CLOSE, from + OPEN.length);
  if (to < 0) return null;
  const block = text.slice(from + OPEN.length, to).trim();
  return block === "" ? null : block;
}

/** Where two texts first part company, by line, so the report points at a sentence. */
function firstDifference(doc, built) {
  const a = doc.split("\n");
  const b = built.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return { line: i + 1, doc: a[i], built: b[i] };
  }
  return { line: a.length, doc: a.at(-1), built: b.at(-1) };
}

const clip = (line) =>
  line == null ? "(the text ends here)" : line.length > 110 ? `${line.slice(0, 110)}…` : line;

/** Same rules, different newlines — worth saying, because the bytes look identical. */
const eolOnly = (a, b) => a.replaceAll("\r\n", "\n") === b.replaceAll("\r\n", "\n");

// ── 1 · the source of truth ─────────────────────────────────────────────────
const DOC = join(repoRoot, "docs", "HUMAN_STYLE.md");
if (!existsSync(DOC)) die(`${rel(DOC)} is not there — this gate has nothing to compare against.`);

const docText = readFileSync(DOC, "utf8").trim();
const docRules = compactRules(docText);
if (!docRules) {
  die(
    `${rel(DOC)} has no non-empty ${OPEN} … ${CLOSE} block.\n` +
      `        That block is what every --human refusal prints; without it the CLI teaches ` +
      `nothing, and crates/agentmon-core/build.rs fails the build rather than ship an empty one.`
  );
}

// ── 2 · what the built binary carries ───────────────────────────────────────
const exe = process.platform === "win32" ? ".exe" : "";
const CLI = join(repoRoot, "target", "release", `agentmon${exe}`);
if (!existsSync(CLI)) die(`no CLI at ${rel(CLI)}, so the doc has nothing to disagree with — ${REBUILD}`);

const runCli = (extra) => {
  try {
    return execFileSync(CLI, ["human-style", ...extra], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    die(
      `\`${`${rel(CLI)} human-style ${extra.join(" ")}`.trim()}\` did not run: ` +
        `${err.stderr?.toString().trim() || err.message}\n        ${REBUILD}`
    );
  }
};

const printed = runCli([]).trim();

let embedded = null;
const json = runCli(["--json"]);
try {
  embedded = String(JSON.parse(json).compactRules ?? "").trim() || null;
} catch (err) {
  die(`\`agentmon human-style --json\` did not print JSON (${err.message}):\n        ${clip(json.trim())}`);
}
if (!embedded) {
  die(
    `\`agentmon human-style --json\` reports no compactRules, so a --human refusal would ` +
      `print nothing, while ${rel(DOC)} holds ${docRules.length} chars of rules — ${REBUILD}`
  );
}

// ── 3 · byte for byte ───────────────────────────────────────────────────────
/* Both halves of the reach, not just the loud one. Surface 2 is the whole document — the
   worked example is four fifths of what `status(mode="human_style")` hands over, and a
   gate that reads only the compact block calls the binary clean while the example in it
   teaches last month's contract. Surface 3 stays because build.rs cuts the block out in a
   separate pass: it can be stale or mis-cut on its own. */
const surfaces = [
  {
    name: "`agentmon human-style`",
    what: 'the whole contract, the copy status(mode="human_style") hands over',
    where: rel(DOC),
    doc: docText,
    built: printed,
  },
  {
    name: "`agentmon human-style --json` compactRules",
    what: "the block a --human refusal and the first MCP result print",
    where: `the ${OPEN} block`,
    doc: docRules,
    built: embedded,
  },
];

for (const { name, what, where, doc, built } of surfaces) {
  if (built === doc) continue;
  const d = firstDifference(doc, built);
  die(
    `${name} — ${what} — is not what ${rel(DOC)} says.\n` +
      `        doc ${doc.length} chars, binary ${built.length} chars` +
      `${eolOnly(doc, built) ? " (they differ only in line endings)" : ""}\n` +
      `        first difference, line ${d.line} of ${where}:\n` +
      `          doc:    ${clip(d.doc)}\n` +
      `          binary: ${clip(d.built)}\n` +
      `        The doc is the source of truth and the binary froze an older copy of it — ${REBUILD}`
  );
}

if (VERBOSE) console.log(docRules);
log(
  `clean: the whole contract (${docText.length.toLocaleString()} chars) and its compact block ` +
    `(${docRules.length.toLocaleString()} chars) are identical in ${rel(DOC)}, ` +
    `\`agentmon human-style\` and the block a refusal prints`
);
