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
/** Punctuation that glues the rest of the line to the label instead of opening a sentence. */
const BOUND = /^[,;:]/;
/** A colon that closes a clause: followed by a space or the end of the line, not by a `/`. */
const CLAUSE_END = /:(?=\s|$)/g;

const EVIDENCE = /^(?:verified|verification|proof|evidence|tested|testing)\b/i;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "part";

/**
 * Where a clause that is glued to the label ends — the only place the label may be lifted
 * out of its own sentence.
 *
 * `**Fix**, in `validate.rs`: a new check runs on all four bodies…` is one sentence whose
 * subject is the bolded word. Promoting "Fix" to a heading and dropping the remainder into
 * the body leaves the reader a paragraph that opens on the author's comma — the record
 * renderer rewriting the vault, which is the one thing this app exists not to do. So the
 * clause is carved off only at a boundary the author wrote:
 *
 *   * the paragraph ends with the clause ("**Fix**, two rules in `app.css`:" + a list) —
 *     the whole clause rides on the heading, wrapped source lines and all; or
 *   * the clause closes on a colon and prose follows it — the heading takes the clause up
 *     to and including that colon, and the body starts at the author's next word.
 *
 * Anything else (a bound clause that runs on as prose, or one longer than a heading line)
 * returns null, and the caller leaves the whole paragraph where it is with its bold lead-in
 * intact. A weaker landmark is a smaller loss than a severed sentence.
 *
 * @param rest   the text after `**Label**` on the label's own line, starting with `,;:`
 * @param follow every line after it, in source order
 */
function carveTrailer(
  rest: string,
  follow: string[],
): { trailer: string; head: string; skip: number } | null {
  let clause = "";
  let line = rest;

  // j is the index in `follow` of the line under consideration; -1 is the label's own line,
  // which is why the bound is inclusive — a label on the last line of a record has no
  // `follow` at all, and its clause still ends its paragraph.
  for (let j = -1; j <= follow.length; j += 1) {
    const cut = clauseEnd(clause, line);
    if (cut !== null) {
      const trailer = join(clause, line.slice(0, cut));
      const head = line.slice(cut).trim();
      // "::" — the next clause is bound too; there is no clean cut here.
      if (trailer.length > MAX_TRAILER || BOUND.test(head)) return null;
      return { trailer: punctuationOnly(trailer) ? "" : trailer, head, skip: j + 1 };
    }

    clause = join(clause, line);
    if (clause.length > MAX_TRAILER) return null;

    // A blank line, a list or a fence ends the paragraph the label opened.
    const next = follow[j + 1] ?? "";
    if (!next.trim() || LIST_LINE.test(next) || FENCE.test(next)) {
      return { trailer: punctuationOnly(clause) ? "" : clause, head: "", skip: j + 1 };
    }
    line = next;
  }
  return null;
}

const join = (a: string, b: string) => (a ? `${a} ${b.trim()}` : b.trim()).trim();
const punctuationOnly = (text: string) => /^[,;:\s]*$/.test(text);

/**
 * The index just past the clause-closing colon in `line`, or null if it has none.
 *
 * Colons inside inline code (`npm run check:counts`) and inside URLs (`https://…`) close
 * nothing, so the candidate must be followed by whitespace and sit outside a code span —
 * counted across the clause so far, since a span may have opened on an earlier line.
 */
function clauseEnd(clause: string, line: string): number | null {
  CLAUSE_END.lastIndex = 0;
  for (let m = CLAUSE_END.exec(line); m; m = CLAUSE_END.exec(line)) {
    const ticks = (clause.match(/`/g)?.length ?? 0) + (line.slice(0, m.index).match(/`/g)?.length ?? 0);
    if (ticks % 2 === 0) return m.index + 1;
  }
  return null;
}

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

  /** `head` is the body's first line — what is left of the label's line after the cut. */
  const starts: { line: number; label: string; trailer: string; head: string; from: number }[] = [];
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

    const rest = m[2].trim();
    const from = i + consumed;

    // ", in `relay-worker/src/dispatcher.rs` and `relay-store/src/queue.rs`:" is not the
    // first sentence of the section — it is the rest of its title, and it rides on the
    // heading where the author put it. A clause with no honest end (see carveTrailer) is
    // not a heading at all: the paragraph keeps its bold lead-in and stays in the prose.
    if (BOUND.test(rest)) {
      const carved = carveTrailer(rest, lines.slice(from));
      if (!carved) continue;
      starts.push({
        line: i,
        label,
        trailer: carved.trailer,
        head: carved.head,
        from: from + carved.skip,
      });
      continue;
    }

    starts.push({ line: i, label, trailer: "", head: rest, from });
  }

  if (starts.length < 2) return { preamble: text, sections: [] };

  const used = new Set<string>();
  const sections = starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1].line : lines.length;

    const body = [start.head, ...lines.slice(start.from, end)]
      .join("\n")
      .replace(/^\n+|\s+$/g, "");
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
      trailer: start.trailer,
      body,
      items,
      evidence: EVIDENCE.test(short),
    };
  });

  return { preamble: lines.slice(0, starts[0].line).join("\n").trim(), sections };
}
