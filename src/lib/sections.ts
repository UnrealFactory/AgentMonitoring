/**
 * Structure that agents already write, made navigable.
 *
 * Every resolution in this vault is written the same way — a paragraph that opens with a
 * bold label, then the prose under it:
 *
 *     **Root cause.** `relay-worker/src/dispatcher.rs` ran the claim, the outbound HTTP …
 *     **Fix**, in `relay-worker/src/dispatcher.rs` and `relay-store/src/queue.rs`:
 *     **Verified.**
 *     **Consequence, stated plainly.** At-least-once becomes reachable through a new door …
 *
 * Rendered as inline bold inside one long card, those labels have exactly the weight of any
 * other bolded phrase, and the load-bearing one gets lost: a reader who reconstructed a
 * 2,000-word resolution correctly reported *no verification evidence at all*, because
 * "Verified." looked like a sentence rather than a landmark. The words were on the screen
 * and the structure was not.
 *
 * This module recovers that structure from the author's own text: each labelled paragraph
 * becomes an anchored sub-section with a heading, a contents entry and a count. Nothing is
 * summarised, reordered or invented — the label is promoted from bold to heading and every
 * other byte is rendered where the author put it (scripts/markdown-smoke.mjs asserts that
 * splitting a record loses no word of it).
 *
 * Deliberately NOT done here: reading numbers out of the prose to build a "94 → 3" metrics
 * strip. The sentences that carry those deltas are written six different ways ("peaked at 3,
 * against 94 before"; "restored … of 8 to 32"; "back to 2,900 … from 940"), and a regex
 * confident enough to pair them up is confident enough to pair up the wrong ones. Printing a
 * number the record does not contain, on the one screen whose whole job is to show a record
 * faithfully, is a worse failure than not printing it. The evidence gets a landmark, its own
 * contents row and its own count instead; the figures stay in the author's sentences, where
 * they are true.
 */
// The `.ts` is deliberate: scripts/markdown-smoke.mjs runs this module under plain node
// (which resolves real paths), and the bundler is configured to accept it.
import { parseBlocks } from "./markdown-parse.ts";

export interface LabelledSection {
  /** DOM id for the anchor, unique within one record. */
  id: string;
  /** The author's label, minus its trailing punctuation: "Root cause", "Fix". */
  label: string;
  /** First clause of the label, for the contents rail: "Consequence", "Follow-up". */
  short: string;
  /** A clause that binds to the label rather than opening the prose (", in four parts:"). */
  trailer: string;
  /** Markdown source of everything under the label. */
  body: string;
  /** List items in the body — a count worth putting in the rail, like a comment count. */
  items: number;
  /** The verification block: the proof that the fix works. */
  evidence: boolean;
}

export interface SplitResult {
  /** Anything written before the first labelled paragraph. */
  preamble: string;
  sections: LabelledSection[];
}

/** `**Label**` plus whatever follows it on the same line. */
const LEAD = /^\*\*(.+?)\*\*(.*)$/;
const FENCE = /^\s*(?:```|~~~)/;
const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;
/** How long a bold run may be and still be a label rather than an emphasised sentence. */
const MAX_LABEL = 80;
/** How much may ride along on the heading line before it is prose in its own right. */
const MAX_TRAILER = 140;

const EVIDENCE = /^(?:verified|verification|proof|evidence|tested|testing)\b/i;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "part";

/**
 * Split a record body into the sub-sections its author labelled.
 *
 * A section starts at a line that begins a paragraph (column 0, after a blank line, outside
 * a fence) with a short `**bold**` run. Fewer than two such labels means the body is not
 * written in sections, and it is returned untouched as the preamble — a resolution written
 * as three plain paragraphs must not sprout headings it never had.
 */
export function splitLabelledSections(source: string): SplitResult {
  const text = (source ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  const starts: { line: number; label: string; rest: string; consumed: number }[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!/^\*\*\S/.test(lines[i])) continue;
    if (i > 0 && lines[i - 1].trim()) continue; // must open a paragraph, not continue one

    // A wrapped label ("**Why it works, including the part that is not\nobvious.**") still
    // closes within a line or two; join at most three before giving up.
    let joined = lines[i];
    let consumed = 1;
    while (!LEAD.test(joined) && consumed < 3 && i + consumed < lines.length) {
      joined += ` ${lines[i + consumed].trim()}`;
      consumed += 1;
    }
    const m = joined.match(LEAD);
    if (!m) continue;
    const label = m[1].trim();
    if (!label || label.length > MAX_LABEL) continue;
    starts.push({ line: i, label, rest: m[2], consumed });
  }

  if (starts.length < 2) return { preamble: text, sections: [] };

  const used = new Set<string>();
  const sections = starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].line : lines.length;
    const rest = start.rest.trim();
    const after = lines.slice(start.line + start.consumed, end);

    // ", in `relay-worker/src/dispatcher.rs` and `relay-store/src/queue.rs`:" is not the
    // first sentence of the section — it is the rest of its title. It rides on the heading
    // when it is short and the paragraph ends with it.
    const nextLine = after[0] ?? "";
    const binds =
      /^[,;:]/.test(rest) &&
      rest.length <= MAX_TRAILER &&
      (!nextLine.trim() || LIST_LINE.test(nextLine));

    const body = [binds ? "" : rest, ...after].join("\n").replace(/^\n+|\s+$/g, "");
    const label = start.label.replace(/[.,:;]+$/, "").trim();
    const firstClause = label.split(",")[0].trim();
    const short = firstClause.length >= 3 ? firstClause : label;

    let id = `res-${slug(short)}`;
    for (let n = 2; used.has(id); n += 1) id = `res-${slug(short)}-${n}`;
    used.add(id);

    let items = 0;
    for (const block of parseBlocks(body)) if (block.kind === "list") items += block.items.length;

    return {
      id,
      label,
      short,
      trailer: binds ? rest : "",
      body,
      items,
      evidence: EVIDENCE.test(short),
    };
  });

  return { preamble: lines.slice(0, starts[0].line).join("\n").trim(), sections };
}
