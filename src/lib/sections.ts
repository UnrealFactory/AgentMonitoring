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
  /**
   * The same run of bold, exactly as it was written — full stop and all.
   *
   * A resolution's label is a heading, and a heading does not end in a full stop; a human
   * area's lead-in is a **sentence** ("**We saved a number, not a place.**", see
   * docs/HUMAN_STYLE.md) and stops being one the moment its stop is taken off. Both readings
   * are of the same bytes, so both are handed back and the caller says which it is drawing.
   */
  raw: string;
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
/**
 * …and how long it may be when the caller says the bold run **is** a sentence.
 *
 * A resolution's label is a heading word — "Root cause", "Fix", "Verified" — and 80 is
 * generous for one. A human area's lead-in is a whole statement by contract
 * (docs/HUMAN_STYLE.md: "**The stored number is wrong twice a year.**"), and a statement
 * carrying a path or an id in it runs past 80 without being any less of a lead-in. On this
 * repo's own 106 retellings the 80 ceiling silently dropped 29 of them — sentences the
 * author had bolded exactly as asked, left as inline body text beside siblings drawn as
 * numbered headings, the longest at 114 characters. This is the same number `MAX_TRAILER`
 * uses for a heading line, for the same reason: it is one sentence's worth, and a bolded
 * *paragraph* is still far past it.
 */
const MAX_SENTENCE_LABEL = 140;
/** How much may ride along on the heading line before it is prose in its own right. */
const MAX_TRAILER = 140;
/** Punctuation that glues the rest of the line to the label instead of opening a sentence. */
const BOUND = /^[,;:]/;
/** A colon that closes a clause: followed by a space or the end of the line, not by a `/`. */
const CLAUSE_END = /:(?=\s|$)/g;
/**
 * …and, where the lead-in is a sentence, the stop the author ended it with.
 *
 * Same job as the colon above — the only place a bound clause may be lifted onto the heading
 * line is a boundary the author wrote — and for "**I measured that page again at six
 * widths**, 1600 down to 960. The tool was …" the boundary is the full stop, not a colon
 * the sentence never had. Without it that paragraph kept its bold run inline while the
 * paragraphs around it were drawn as numbered beats. A stop only counts followed by
 * whitespace or the end of the line, so `0.9.4` and `e.g` close nothing.
 */
const SENTENCE_OR_CLAUSE_END = /[.!?:](?=\s|$)/g;
/**
 * How a lead-in ends when its author finished it.
 *
 * The stop may have a closing quote or bracket after it and still be the end of the
 * sentence: WORK-0067 opens its first beat on `**Three separate pieces of code were each
 * answering "is this line a heading?"**`, a whole statement whose last character is a quote
 * mark. Anything that ends on one of these is a landmark the author drew; anything that does
 * not is the front half of a sentence, and {@link continuesSentence} decides whether the
 * back half is sitting underneath it.
 *
 * Exported because lib/human.ts asks the same question one step later, of the same bytes: a
 * beat that is a lead-in and one line only closes the retelling on that line if the lead-in
 * above it was a statement rather than the front half of one.
 */
export const LEAD_IN_END = /[.!?:]["'’”»)\]]*$/;
/**
 * Marks a continuation may open on without any of them being its first *word* — the author's
 * dash or ellipsis, an opening quote or bracket, and the emphasis and code marks the
 * renderer eats before the reader sees a letter.
 */
const CONTINUATION_OPENERS = /^[\s—–\-…"'“”‘’«»(\[`*_~]+/;

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
 * @param rest     the text after `**Label**` on the label's own line, starting with `,;:`
 * @param follow   every line after it, in source order
 * @param ending   which boundaries count as one the author wrote — a clause-closing colon
 *                 always, and a sentence's own full stop where the lead-in is a sentence
 * @param sentence whether the bold run is a statement rather than a heading word; it decides
 *                 what happens to a clause that is nothing but the binder ({@link punctuationOnly})
 */
function carveTrailer(
  rest: string,
  follow: string[],
  ending: RegExp,
  sentence: boolean,
): { trailer: string; head: string; skip: number } | null {
  let clause = "";
  let line = rest;

  // j is the index in `follow` of the line under consideration; -1 is the label's own line,
  // which is why the bound is inclusive — a label on the last line of a record has no
  // `follow` at all, and its clause still ends its paragraph.
  for (let j = -1; j <= follow.length; j += 1) {
    const cut = clauseEnd(clause, line, ending);
    if (cut !== null) {
      const trailer = join(clause, line.slice(0, cut));
      const head = line.slice(cut).trim();
      // "::" — the next clause is bound too; there is no clean cut here.
      if (trailer.length > MAX_TRAILER || BOUND.test(head)) return null;
      return { trailer: punctuationOnly(trailer) && !sentence ? "" : trailer, head, skip: j + 1 };
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

/**
 * A clause that is nothing but the binder itself — the author's bare colon, carrying no
 * words of its own.
 *
 * Where the label is a heading word it is dropped: `**Screenshots**: the shots go under
 * progress/` means "Screenshots" over that prose, and this app does not draw a heading that
 * ends in a dangling colon (scripts/markdown-smoke.mjs pins it).
 *
 * Where the label is a *sentence* it is kept, because there it is not a binder — it is the
 * author's own punctuation in the middle of one statement. `**Lifting it any later would
 * have been a race**: the browser's own box arrives at about 500 milliseconds, and ours at
 * 400.` is a single sentence (WORK-0031). Dropping the colon out of it left a 19px heading
 * with no terminal stop above a paragraph opening "the browser's own box" — the seam deleted
 * and the sentence severed at it, in six of this repo's records (WORK-0031, WORK-0035,
 * BUG-0004, BUG-0011, BUG-0012, BUG-0016). Kept, the colon rides the heading line where the
 * author put it and the two halves still read as the one thing they are.
 *
 * Both readings drop it in the other branch, where the clause *ends* the paragraph and a
 * list follows: a heading above a list needs no colon and no sentence is cut in half by
 * leaving it off.
 */
const punctuationOnly = (text: string) => /^[,;:\s]*$/.test(text);

/**
 * Whether the text under a bold run is the rest of that run's own sentence.
 *
 * {@link carveTrailer} guards one half of this and says why: a lead-in whose line runs on
 * with `,;:` either takes its whole clause onto the heading or keeps its paragraph, because
 * "a weaker landmark is a smaller loss than a severed sentence". The commoner shape had no
 * guard at all — the author simply carries on after the closing asterisks:
 *
 *     **The row is one line taller** below 1260 pixels, and a name past about 180 pixels …
 *
 * One sentence (BUG-0007's sixth beat). Split there, the screen drew "The row is one line
 * taller" as a heading over a paragraph beginning "below 1260 pixels", which makes the record
 * assert flatly what its author conditioned on a window width. Twelve beats in eleven of this
 * repo's records read that way, the essential handoff note among them — on the one screen
 * whose whole promise is that nothing is reordered, invented or rewritten. Six of the twelve
 * are this shape; the other six are the colon {@link punctuationOnly} used to throw away.
 *
 * So the lead-in has to have been finished. Ended on a stop the author typed
 * ({@link LEAD_IN_END}) the words below begin something new and the beat stands; not ended,
 * with a lowercase word underneath, the sentence is still running and the paragraph stays
 * whole with its bold run inline. Same trade as the guard next door, one clause long.
 *
 * The test is for a lowercase *letter*, so it says nothing at all about Korean or any other
 * caseless script: a retelling in one keeps every beat it had. Telling a severed Korean
 * sentence from a finished one needs grammar, and this module reads punctuation.
 *
 * @param label  the bold run, as the author wrote it
 * @param rest   what follows it on the same line
 * @param next   the line after that, for a lead-in whose paragraph wraps instead
 */
function continuesSentence(label: string, rest: string, next: string): boolean {
  if (LEAD_IN_END.test(label.trim())) return false;
  let cont = rest.trim();
  if (!cont) {
    // Nothing after the asterisks: the paragraph either ended here (a blank line, a list, a
    // fence — nothing to sever) or wrapped onto the next line, which is then the continuation.
    if (!next.trim() || LIST_LINE.test(next) || FENCE.test(next)) return false;
    cont = next.trim();
  }
  // A dash the author wrote binds what follows it to what came before, whatever case the
  // next word happens to be in: `**The Menu key opened the menu and killed it a millisecond
  // later** — \`BUG-0020\`.` is one sentence whose second half opens on an id (WORK-0022).
  // Two paragraphs in this repo's 109 retellings open on one and both are that sentence.
  if (/^[—–]/.test(cont)) return true;
  return /^\p{Ll}/u.test(cont.replace(CONTINUATION_OPENERS, ""));
}

/**
 * The index just past the clause-closing colon in `line`, or null if it has none.
 *
 * Colons inside inline code (`npm run check:counts`) and inside URLs (`https://…`) close
 * nothing, so the candidate must be followed by whitespace and sit outside a code span —
 * counted across the clause so far, since a span may have opened on an earlier line.
 */
function clauseEnd(clause: string, line: string, ending: RegExp): number | null {
  ending.lastIndex = 0;
  for (let m = ending.exec(line); m; m = ending.exec(line)) {
    const ticks = (clause.match(/`/g)?.length ?? 0) + (line.slice(0, m.index).match(/`/g)?.length ?? 0);
    if (ticks % 2 === 0) return m.index + 1;
  }
  return null;
}

/**
 * Split a record body into the sub-sections its author labelled.
 *
 * A section starts at a line that begins a paragraph (column 0, after a blank line, outside
 * a fence) with a short `**bold**` run. Fewer than `min` such labels means the body is not
 * written in sections, and it is returned untouched as the preamble — a resolution written
 * as three plain paragraphs must not sprout headings it never had.
 *
 * `min` is 2 for a closing section, and the human area passes 1 (see lib/human.ts): there
 * the bold lead-in is not a label somebody happened to write but the shape the style
 * contract asks for — one bold sentence opening each beat of the retelling
 * (docs/HUMAN_STYLE.md) — so a single one is already the author saying "a beat starts
 * here", and promoting it costs the reader nothing.
 *
 * `sentence` is the other half of that difference and travels with it: a lead-in is read as
 * a whole statement rather than a heading word, so it may run to {@link MAX_SENTENCE_LABEL}
 * and its bound clause may close on the author's own full stop as well as on a colon. A
 * resolution passes neither and splits exactly as it always did.
 */
export function splitLabelledSections(
  source: string,
  { min = 2, sentence = false }: { min?: number; sentence?: boolean } = {},
): SplitResult {
  const maxLabel = sentence ? MAX_SENTENCE_LABEL : MAX_LABEL;
  const ending = sentence ? SENTENCE_OR_CLAUSE_END : CLAUSE_END;
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
    if (!label || label.length > maxLabel) continue;

    const rest = m[2].trim();
    const from = i + consumed;

    // ", in `relay-worker/src/dispatcher.rs` and `relay-store/src/queue.rs`:" is not the
    // first sentence of the section — it is the rest of its title, and it rides on the
    // heading where the author put it. A clause with no honest end (see carveTrailer) is
    // not a heading at all: the paragraph keeps its bold lead-in and stays in the prose.
    if (BOUND.test(rest)) {
      const carved = carveTrailer(rest, lines.slice(from), ending, sentence);
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

    // …and the same trade where the author bound the rest of the sentence to the bold run
    // with no punctuation at all ("**The row is one line taller** below 1260 pixels"): the
    // paragraph keeps its lead-in inline rather than having a heading cut out of its middle.
    if (sentence && continuesSentence(label, rest, lines[from] ?? "")) continue;

    starts.push({ line: i, label, trailer: "", head: rest, from });
  }

  if (starts.length < min) return { preamble: text, sections: [] };

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
      raw: start.label.trim(),
      short,
      trailer: start.trailer,
      body,
      items,
      evidence: EVIDENCE.test(short),
    };
  });

  return { preamble: lines.slice(0, starts[0].line).join("\n").trim(), sections };
}
