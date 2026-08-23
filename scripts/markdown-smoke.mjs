#!/usr/bin/env node
/**
 * Data-fidelity smoke for the record renderer's parser.
 *
 *   node scripts/markdown-smoke.mjs           # fixtures + every record in ./AgentMonitoring
 *   node scripts/markdown-smoke.mjs --dir X   # …and a project folder somewhere else
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
import { highlightCode } from "../src/lib/highlight.ts";
import { parseBlocks, parseInline, inlineText } from "../src/lib/markdown-parse.ts";
import { splitLabelledSections } from "../src/lib/sections.ts";
import { readHumanStory } from "../src/lib/human.ts";
import { sections, splitHuman } from "./project-fs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir");
const dataDir = dirArg >= 0 && args[dirArg + 1] ? args[dirArg + 1] : join(root, "AgentMonitoring");

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
      // this file exists to catch, and the numbers are part of what the reader sees. A
      // task's `[x]` is state the renderer draws as a box — flattened back to its
      // source form here, so the sweep can see nothing was eaten.
      return b.items
        .map(
          (it, i) =>
            `${b.ordered ? `${b.start + i}.` : "-"} ` +
            `${it.task ? `[${it.task === "done" ? "x" : " "}] ` : ""}` +
            inlineText(parseInline(it.text))
        )
        .join("\n");
    case "table":
      return [b.header, ...b.rows].flat().map((c) => inlineText(parseInline(c))).join(" ");
    case "callout":
      // The consumed marker line, restored for the sweep.
      return `[!${b.tone}] ${inlineText(parseInline(b.text))}`;
    case "figure":
      return `![${b.alt}](${b.src})`;
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

// 10b. A clause bound to the label is never amputated from it. Six live records used to
// render an <h3> "Fix" above a paragraph starting ", in the new src/lib/markdown-parse.ts…"
// — the renderer cutting the author's sentence in half (P6 round 2 design critic).
{
  // The clause wraps onto a second line and ends the paragraph: all of it is the title.
  const wrapped = [
    "**Root cause.** The paragraph loop tested the raw line.",
    "",
    "**Fix**, in the new `src/lib/markdown-parse.ts` (the parser, split out of",
    "`src/lib/markdown.tsx` so it can be run without React):",
    "",
    "1. `interruptsParagraph(line)` replaces the regex test.",
  ].join("\n");
  const wrap = splitLabelledSections(wrapped).sections[1];
  eq("a wrapped clause rides on the heading whole", wrap.trailer.endsWith("without React):"), true);
  check("…and the body starts on the author's next word", wrap.body.startsWith("1. `interruptsParagraph"), wrap.body);

  // The clause closes on a colon and prose runs on after it: the heading takes the clause.
  const colon = [
    "**Root cause.** `validate::resolution` checked only the top level.",
    "",
    "**Fix**, in `crates/agentmon-core/src/validate.rs`: a new `reject_section_headings()` runs",
    "on all four bodies after the existing unwrap step.",
  ].join("\n");
  const cut = splitLabelledSections(colon).sections[1];
  eq("a clause that closes on a colon is cut there", cut.trailer, ", in `crates/agentmon-core/src/validate.rs`:");
  check("…and the body keeps the prose after it", cut.body.startsWith("a new `reject_section_headings()`"), cut.body);

  // "**Screenshots**: <prose>" — the colon binds nothing but the label to its own prose.
  const plain = "**Backdating**: `time.rs` parses the stamps.\n\n**Screenshots**: `screenshot.mjs` takes `SHOT_PORT`.";
  const two = splitLabelledSections(plain).sections;
  eq("a bare binding colon leaves the label alone", two[1].trailer, "");
  eq("…and the body opens on a word", two[1].body, "`screenshot.mjs` takes `SHOT_PORT`.");

  // The last line of a record is still the end of its paragraph.
  const last = "**Root cause.** The loop tested the raw line.\n\n**Fix**, one rule in `app.css`.";
  const end = splitLabelledSections(last).sections[1];
  eq("a clause on the record's last line still rides the heading", end.trailer, ", one rule in `app.css`.");
  eq("…leaving no body behind it", end.body, "");

  // A bound clause that just runs on as prose has no honest cut: the paragraph is left
  // whole, bold lead-in and all, rather than beheaded.
  const runOn = [
    "**Root cause.** The loop tested the raw line.",
    "",
    "**Fix**, which took three attempts and a rewrite of the block scanner before the",
    "paragraph loop stopped renumbering the author's own sentences on every render.",
  ].join("\n");
  const kept = splitLabelledSections(runOn);
  eq("an uncuttable clause is not promoted", kept.sections.length, 0);
  check("…and its paragraph keeps its label", kept.preamble.includes("**Fix**, which took"), kept.preamble);
}

// 10c. …and a retelling's lead-in is a whole sentence, so the same rule bites harder there.
// `splitLabelledSections(…, { sentence: true })` is what lib/human.ts calls to find the beats
// of a human area, and for a round it cut a heading out of the middle of the author's
// sentence on 12 beats of this repo's own records: a 19px "The row is one line taller" over a
// paragraph opening "below 1260 pixels", which makes the record assert flatly what its author
// conditioned on a window width (D3 round 5 critic, BUG-0007).
{
  const beat = (src) => splitLabelledSections(src, { min: 1, sentence: true });

  // The author carried straight on after the closing asterisks: one sentence, left whole.
  const runOn = "**The row is one line taller** below 1260 pixels, and a name past 180 ends in a “…”.";
  const kept = beat(runOn);
  eq("a lead-in the author never ended is not a heading", kept.sections.length, 0);
  eq("…and its paragraph is returned exactly as written", kept.preamble, runOn);

  // Their own dash binds the halves whatever case the second one opens in.
  const dash = beat("**The Menu key opened the menu and killed it a millisecond later** — `BUG-0020`.");
  eq("a dash binds the rest to the lead-in too", dash.sections.length, 0);

  // The author's colon *is* an ending, and it rides the heading line where they wrote it.
  const colon = beat("**Lifting it any later would have been a race**: the browser's own box arrives at 500ms.");
  eq("a lead-in ended on a colon is a beat", colon.sections.length, 1);
  eq("…keeping the colon the author typed", colon.sections[0].trailer, ":");
  eq("…and opening the body on their next word", colon.sections[0].body, "the browser's own box arrives at 500ms.");

  // A stop inside the author's quotes is still the stop (WORK-0067's first beat).
  const quoted = beat('**Three pieces of code each answered "is this line a heading?"** `body::heading` refuses.');
  eq("a sentence that ends inside quotes is finished", quoted.sections.length, 1);
  check("…and the beat keeps its own words", quoted.sections[0].body.startsWith("`body::heading`"), quoted.sections[0].body);

  // Case is a Latin-script test and says nothing about Korean: those beats are untouched.
  const ko = beat("**저장한 것은 자리가 아니라 숫자였다.** 시계를 한 시간 되돌리면 같은 시각이 두 번 옵니다.");
  eq("a Korean lead-in is still a beat", ko.sections.length, 1);

  // None of this reaches a resolution, where the bold run is a heading word rather than a
  // sentence and "Fix" over prose is what the author meant (fixture 10b pins that reading).
  const label = splitLabelledSections("**Root cause.** The loop tested the raw line.\n\n**Fix** in `app.css` two rules.");
  eq("a resolution's label splits as it always did", label.sections.length, 2);
  eq("…with no colon invented for it", label.sections[1].trailer, "");
}

// 10d. …and where that retelling ends (src/lib/human.ts). The closing line gets the one
// accent-painted block on the page, and for two rounds a last beat that was a lead-in and one
// line never got one: BUG-0020, BUG-0021 and WORK-0022 each close on a rule of thumb that is
// the *whole* body of their final beat, and all three were drawn as one more grey paragraph
// (D3 round 7 critic). Lifting it takes two things — the line standing alone in its own
// paragraph, and a finished statement above it — and the two live records that fail those,
// BUG-0019 and BUG-0024, are here to keep them failing.
{
  const doc = (...paragraphs) => paragraphs.join("\n\n");
  const lastBeat = (story) => story.beats[story.beats.length - 1];

  // BUG-0020's shape: the last beat is a lead-in and one line, alone in its paragraph.
  const alone = readHumanStory(
    doc(
      "Somebody watching the screen would have seen the Menu key do nothing at all.",
      "**The mouse and Shift+F10 were never affected: a dead key, not a leak.**",
      "A key nobody presses in the check is a key nobody has tested.",
    ),
  );
  eq(
    "a last beat that is a lead-in and one line closes the retelling on that line",
    alone.takeaway,
    "A key nobody presses in the check is a key nobody has tested.",
  );
  eq("…the beat keeping its lead-in", lastBeat(alone).lead, "The mouse and Shift+F10 were never affected: a dead key, not a leak.");
  eq("…with nothing left under it", lastBeat(alone).body, "");
  eq("…and the opening where the author put it", alone.lede, "Somebody watching the screen would have seen the Menu key do nothing at all.");

  // BUG-0021 and WORK-0022 end the heading line on the clause they bound to the lead-in, and
  // the statement the screen draws is the two of them together.
  const bound = readHumanStory(
    doc(
      "**A right-click while a menu is open still only closes it**, rather than moving to whatever is under the new cursor.",
      "A gesture that answers on some rows and not others teaches nobody to use it.",
    ),
  );
  eq(
    "a lead-in finished by its bound clause closes the retelling too",
    bound.takeaway,
    "A gesture that answers on some rows and not others teaches nobody to use it.",
  );
  eq("…and the clause still rides the heading line", lastBeat(bound).trailer, ", rather than moving to whatever is under the new cursor.");

  // BUG-0019's shape: the same two sentences, written on one line. There is no last paragraph
  // to lift, so the beat keeps every word where its author put it.
  const inline = readHumanStory(
    doc(
      "Somebody watching the screen would have seen the Menu key do nothing at all.",
      "**Everywhere except a box you type in, the right button is now the app's.** Whatever you never answer, something else answers for you.",
    ),
  );
  eq("a closing line sharing the lead-in's paragraph is not lifted", inline.takeaway, null);
  eq("…and stays the beat's body", lastBeat(inline).body, "Whatever you never answer, something else answers for you.");

  // BUG-0024's shape: the same, and its paragraph taken whole is 215 characters.
  const long = readHumanStory(
    "**Any two agents writing to one project at the same moment could hit this.** The test with its eight writers only rolls the dice faster. Two writers now wait for each other, which is the whole point of taking turns.",
  );
  eq("…however long that paragraph is", long.takeaway, null);
  check("…which stays two sentences of body", lastBeat(long).body.startsWith("The test with its eight"), lastBeat(long).body);

  // …and the ceiling is unmoved by any of this: a paragraph of its own, two sentences and
  // past MAX_TAKEAWAY, is a paint swatch rather than a line to leave holding.
  const over =
    "The test with its eight writers only rolls the dice faster, which is why it failed one run in five rather than every run, and two writers now wait for each other, which is the whole point of taking turns.";
  check("the fixture is over the ceiling", over.length > 200, `${over.length} characters`);
  eq(
    "a single paragraph past the ceiling is not a closing line",
    readHumanStory(doc("**Any two agents writing to one project at once could hit this.**", over)).takeaway,
    null,
  );

  // Nor is a paragraph that is not prose — the floor `carveTakeaway` already applies to the
  // last of several holds for the only one just the same.
  const list = readHumanStory(
    doc("**The three keys were each answered somewhere else.**", "- the mouse\n- Shift+F10\n- the Menu key"),
  );
  eq("a list under a lead-in is not a closing line", list.takeaway, null);

  // An unfinished lead-in is *completed* by the paragraph under it; lifting that would leave
  // half a sentence as a heading with nothing beneath it.
  const half = readHumanStory(doc("**We saved a number**", "Not a place, which is the whole bug."));
  eq("an unfinished lead-in keeps the paragraph that finishes it", half.takeaway, null);
  eq("…as its body", lastBeat(half).body, "Not a place, which is the whole bug.");

  // The author's hard wrap is not a paragraph break here either (the reason is on
  // `carveTakeaway`): the same beat wrapped mid-sentence closes on the same line.
  const wrapped = readHumanStory(
    doc(
      "**The mouse and Shift+F10 were never affected: a dead key, not a leak.**",
      "A key nobody presses in the check\nis a key nobody has tested.",
    ),
  );
  eq("a wrapped closing line is still one line", wrapped.takeaway, "A key nobody presses in the check is a key nobody has tested.");

  // A beat-less retelling — the shape the contract gives a thin record — is untouched by all
  // of it: it still closes on its own last paragraph, and one that is a single paragraph
  // still keeps that paragraph.
  const thin = readHumanStory(
    doc(
      "The tool wrote the same file twice and the second write won.",
      "A colour is only as legible as the colours you checked it beside.",
    ),
  );
  eq("a beat-less retelling still closes on its last paragraph", thin.takeaway, "A colour is only as legible as the colours you checked it beside.");
  eq("…with no beats invented", thin.beats.length, 0);
  eq("…and its opening left whole", thin.lede, "The tool wrote the same file twice and the second write won.");
  const one = readHumanStory("The tool wrote the same file twice and the second write won.");
  eq("a one-paragraph retelling keeps its one paragraph", one.takeaway, null);
  eq("…as the opening", one.lede, "The tool wrote the same file twice and the second write won.");
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

// 13. Task lists carry their state, and the state is not words.
{
  const blocks = parseBlocks("- [x] shipped the parser\n- [ ] draw the diagram\n- plain item");
  eq("one list", blocks.length, 1);
  eq("…done state read", blocks[0].items[0].task, "done");
  eq("…open state read", blocks[0].items[1].task, "open");
  eq("…plain item untouched", blocks[0].items[2].task, null);
  eq("…marker not left in the words", blocks[0].items[0].text, "shipped the parser");
}

// 14. Strikethrough nests like the other emphasis containers.
{
  const nodes = parseInline("the flag is ~~`legacy_mode`~~ now");
  const del = nodes.find((n) => n.kind === "del");
  check("del parsed", !!del);
  eq("…code inside is code", del.children[0].kind, "code");
  eq("…and the words survive flattening", inlineText(nodes), "the flag is legacy_mode now");
}

// 15. Callouts: a bare marker line is state; a marker with trailing words is not the syntax.
{
  const blocks = parseBlocks(
    "> [!warning]\n> The registry is shared.\n\n> [!warning] with trailing words\n> stays a quote"
  );
  eq("first is a callout", blocks[0].kind, "callout");
  eq("…toned", blocks[0].tone, "warning");
  eq("…with its words", blocks[0].text, "The registry is shared.");
  eq("second stays a quote", blocks[1].kind, "quote");
  check("…keeping the marker text", blocks[1].text.includes("[!warning] with trailing words"));
}

// 16. An image alone in a paragraph is a figure; inside a sentence it is inline data —
//     never a literal "!" beside a link, which is what the old grammar made of it.
{
  const blocks = parseBlocks(
    "![flow of a delivery](assets/flow.svg)\n\nSee ![icon](assets/dot.png) beside it."
  );
  eq("figure block", blocks[0].kind, "figure");
  eq("…alt kept", blocks[0].alt, "flow of a delivery");
  eq("…src kept", blocks[0].src, "assets/flow.svg");
  const img = parseInline("See ![icon](assets/dot.png) beside it.").find((n) => n.kind === "image");
  check("inline image parsed", !!img);
  eq("…with its src", img.src, "assets/dot.png");
}

// 17. `[[note-name]]` is an explicit cross-reference (the way a live vault indexes its
//     notes); a bare kebab word in a sentence never links.
{
  const nodes = parseInline("decisions live in [[unrealnetcore-mission-decisions]] now");
  const ref = nodes.find((n) => n.kind === "ref");
  check("wikilink parsed", !!ref);
  eq("…to the note's name", ref.id, "unrealnetcore-mission-decisions");
  eq(
    "…and flattens back to the source spelling",
    inlineText(nodes),
    "decisions live in [[unrealnetcore-mission-decisions]] now"
  );
  eq(
    "a bare kebab word stays text",
    parseInline("the registry-gate-gotcha note").every((n) => n.kind === "text"),
    true
  );
  // Inside a table cell it is still a ref — the memory-map note that motivated this.
  const table = parseBlocks("| q | where |\n| - | - |\n| queue | [[unrealnetcore-queue]] |")[0];
  eq("…in a table cell too", parseInline(table.rows[0][1])[0].kind, "ref");
  // Not the syntax: spaces, array literals, code spans, bracket-opening link labels.
  eq(
    "spaces are not a name",
    parseInline("[[not a name]]").every((n) => n.kind !== "ref"),
    true
  );
  check(
    "array literals stay the author's text",
    inlineText(parseInline("pairs [[0, 1], [2, 3]] here")).includes("[[0, 1], [2, 3]]")
  );
  eq("a code span keeps its brackets", parseInline("`[[start-here]]`")[0].kind, "code");
  check(
    "…and [[label](url) is still a link",
    parseInline("[[label](https://x.dev)").some((n) => n.kind === "link")
  );
  eq("a bracketed record id is a ref", parseInline("[[WORK-0004]]")[0].kind, "ref");
}

// 18. A link's href is data, and flattening keeps it — like an image's src above.
//     WORK-0061 writes `[[label](url)` in prose to document the grammar in 17; the label
//     parses as `[label` (CommonMark), so a flatten that kept the label alone dropped
//     `](url)` and the sweep below read it, correctly, as words gone missing.
{
  eq(
    "a link flattens back to its source spelling",
    inlineText(parseInline("see [the docs](https://x.dev/a) now")),
    "see [the docs](https://x.dev/a) now"
  );
  eq(
    "…including the one whose label opens with a bracket",
    inlineText(parseInline("because [[label](url) is a link")),
    "because [[label](url) is a link"
  );
  eq(
    "…and markup inside the label is still flattened",
    inlineText(parseInline("[the **fix**](notes/a.md)")),
    "[the fix](notes/a.md)"
  );
}

// 19. Highlighting may be wrong about a token, never about the bytes.
{
  const samples = [
    ["js", "const n = 1; // half\nconst s = `a ${b} c`;"],
    ["rust", "fn main() { let x: &'static str = \"hi\"; /* done */ }"],
    ["python", 'def f():\n    return "x"  # done'],
    ["bash", 'echo "$HOME" # home'],
    ["sql", "SELECT id FROM runs WHERE state = 'done' -- newest"],
    ["not-a-language", "anything at all"],
  ];
  for (const [lang, code] of samples) {
    const joined = highlightCode(code, lang)
      .map((s) => s.text)
      .join("");
    eq(`highlight(${lang}) preserves the bytes`, joined, code);
  }
}

/* -------------------------------------- the reserved heading, across parsers */

/**
 * Three parsers, one answer: what is a `## For humans` heading?
 *
 *   * crates/agentmon-core/src/body.rs — the guard, and what the desktop app reads;
 *   * scripts/project-fs.mjs — the browser transport;
 *   * src/lib/markdown-parse.ts — what the app actually *draws*.
 *
 * They disagreed. The guard closed the hash run on `' '` alone while `parseBlocks` closes
 * it on `\s`, so `##\tFor humans` in a `--body` was written at exit 0 and the Agent view
 * drew a level-2 heading reading "For humans" over prose saying it was not the record's
 * human area — the confusion the reserved section exists to prevent, right under the
 * Agent/Human toggle. A leading U+FEFF split the two transports instead: JavaScript's
 * `trim` strips it, Rust's does not, so browser mode served a reserved-titled section that
 * desktop mode did not have.
 *
 * The list of spellings is shared with crates/agentmon-core/tests/human_area.rs, which
 * drives every one of them through the real write path. Here we hold the other two
 * parsers to it, and to the property that matters end to end: **whatever stays in a
 * record's agent-area payload never renders as the reserved heading.**
 */
console.log("reserved heading");

/**
 * What paints nothing is not part of what the reader reads.
 *
 * Written out here rather than imported from the transport, so this file can disagree with
 * the code it is checking. `\s` matches none of these characters, which is exactly why
 * `## For humans` with a zero-width space after it was a different title to the guard and
 * eight identical glyphs to the reader.
 */
const NO_INK = /[\u00ad\u200b-\u200f\u2060-\u2064\ufe00-\ufe0f\ufeff]/g;

const drawnAsReserved = (md) =>
  parseBlocks(md).some(
    (b) =>
      b.kind === "heading" &&
      b.level === 2 &&
      b.text
        .replace(NO_INK, "")
        .replace(/[#:\s]+$/, "")
        .split(/\s+/)
        .join(" ")
        .toLowerCase() === "for humans",
  );

{
  const shapesFile = join(root, "crates", "agentmon-core", "tests", "reserved-heading-shapes.json");
  const { shapes } = JSON.parse(readFileSync(shapesFile, "utf8"));
  check("the shared shape list is populated", shapes.length >= 20, `${shapes.length} shapes`);

  for (const { line, reserved, why } of shapes) {
    const body = `## What\n\nSomething real.\n\n${line}\n\nThis is NOT the human area.\n\n## Why\n\nA reason.\n`;
    const label = JSON.stringify(line);

    // 1. The browser transport reads the section exactly where the Rust guard refuses it.
    const { agent, human } = splitHuman(body);
    check(
      `${label} is ${reserved ? "" : "not "}the human area to project-fs (${why})`,
      (human !== null) === reserved,
      `human=${JSON.stringify(human)}`,
    );

    // 2. …and whatever is left for the Agent view never draws the reserved heading.
    check(`${label} never reaches the agent payload as a heading`, !drawnAsReserved(agent));

    // 3. The agent area a record would store carries no reserved-titled section either.
    check(
      `${label} leaves no reserved-titled section behind`,
      !sections(agent).some((s) => drawnAsReserved(`## ${s.title}`)),
      JSON.stringify(sections(agent).map((s) => s.title)),
    );
  }

  // A fenced example is an example in either marker, and a ``` block holds a ~~~ as
  // content — the rule src/lib/markdown-parse.ts renders by, which a single toggled
  // boolean got wrong in a way that hid a real heading from the guard.
  eq("a fenced heading is not the human area", splitHuman("## What\n\n```md\n## For humans\n```\n").human, null);
  eq("…in tildes either", splitHuman("## What\n\n~~~md\n## For humans\n~~~\n").human, null);
  check(
    "a ~~~ inside a ``` block cannot hide the heading",
    splitHuman("```\na\n~~~\nb\n```\n## For humans\n\nReal.\n").human === "Real.",
  );
}

/* ------------------------------------------------------- every vault record */

console.log("record sweep");

/** Words the renderer is allowed to consume: markdown syntax itself. */
const SYNTAX = /^[-*_>#`|.)(\[\]]+$/;
/** Emphasis, code fences and strikethrough are markup, not letters — compare without. */
const bare = (s) => s.replace(/[`*~]/g, "");

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

  // The two areas do not bleed: whatever this record hands the Agent view never draws a
  // heading reading "For humans", whatever spelling the file uses.
  const halves = splitHuman(body);
  check(
    `${name} keeps the reserved heading out of its agent area`,
    !drawnAsReserved(halves.agent),
  );

  // The Human view reads the retelling back as an opening, its beats and its closing line
  // (src/lib/human.ts), and that reading is the whole text — "nothing is summarised,
  // reordered, counted or invented" is the promise the screen is built on, so it is swept
  // here for the same reason the resolution's split is: a re-arrangement may lose no word.
  if (halves.human) {
    const story = readHumanStory(halves.human);
    const retold = bare(
      [story.lede, ...story.beats.map((b) => `${b.lead} ${b.trailer} ${b.body}`), story.takeaway ?? ""].join("\n"),
    );
    const gone = lost(halves.human, retold);
    check(`${name} retells without loss`, gone.length === 0, gone.slice(0, 6).join(" · "));
  }

  // Every code block in the record, re-joined from its highlight spans: colour may be
  // wrong about a token, never about the bytes (lib/highlight.ts).
  for (const b of parseBlocks(body)) {
    if (b.kind === "code") {
      const joined = highlightCode(b.text, b.lang)
        .map((s) => s.text)
        .join("");
      check(`${name} highlights without loss`, joined === b.text, `lang=${b.lang}`);
    }
  }

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

  // …and never by beheading a sentence: a body that opens on the author's comma is a label
  // that was lifted out of its own clause.
  for (const s of sections) {
    check(
      `${name} keeps “${s.short}” in one piece`,
      !/^[,;:]/.test(s.body),
      `body starts "${s.body.slice(0, 60)}…"`,
    );
  }
}

if (!existsSync(dataDir)) {
  console.error(`  no project folder at ${dataDir} — fixtures only`);
} else {
  for (const kind of ["worklogs", "bugs", "notes"]) {
    const dir = join(dataDir, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) sweep(join(dir, f));
  }
}

console.log(
  failures === 0
    ? `\nOK — ${checks} checks passed`
    : `\nFAILED — ${failures} of ${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
