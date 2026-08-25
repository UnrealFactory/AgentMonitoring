/**
 * The shape a human area already has, made visible.
 *
 * `docs/HUMAN_STYLE.md` asks for one shape and every retelling in this project's records is
 * written in it: an opening paragraph on what somebody could have witnessed, then the chase
 * **in beats**, each beat opening on one short bold sentence that states something ("**We
 * threw away the name that knows the rule.**"), and a closing line the reader could repeat
 * tomorrow. `##` headings are refused outright, so those bold lead-ins are the only
 * structure the text carries.
 *
 * Rendered as ordinary markdown that structure is invisible: eight paragraphs of even
 * colour, the lead-ins the same weight as any other bolded phrase — the very failure
 * lib/sections.ts was written for one record-part further in, where "Verified." disappeared
 * into two thousand words. So this reads the beats back out, and the screen draws each one
 * as a beat.
 *
 * **Nothing is summarised, reordered, counted or invented.** The lead-in is promoted from
 * bold to a heading, a picture the author opened a beat with is handed over as that beat's
 * scene — named, never moved: it is drawn in the place it already occupies, between the
 * lead-in above it and the paragraph below ({@link HumanBeat.figure}) — the rest is
 * rendered where the author put it, and a retelling that
 * carries no lead-ins at all (a thin record's, which the contract says gets none) comes back
 * as an opening run and the line it closed on — the two things every retelling has, beats or
 * no beats. The splitting itself is lib/sections.ts's, called with `min: 1` — the reasoning
 * for that number lives there.
 */
// The `.ts` is deliberate — the same reason as in lib/sections.ts: this module is read by
// plain node in the gates as well as by the bundler.
import { LEAD_IN_END, splitLabelledSections } from "./sections.ts";

export interface HumanBeat {
  /** The bold sentence the beat opens on, without its asterisks. */
  lead: string;
  /** The clause the author bound to that sentence, when there is one. */
  trailer: string;
  /**
   * The scene this beat opens on, exactly as the author wrote the line —
   * `![what it shows](assets/bug-0025-2-one-line-of-settings.svg)` — or `null`, which is
   * most beats.
   *
   * The style contract asks for the picture *inside* the beat, above its words: "after the
   * bold lead-in, before the paragraph — so the reader takes the beat once as a picture and
   * once in words" (docs/HUMAN_STYLE.md). The screen can only draw it there if it knows
   * which image that is, so the one that stands **first** in the body is handed over
   * separately and the rest of the body follows it.
   *
   * First, and given the whole line: the body's opening line has to be the image and
   * nothing else — the same shape lib/markdown-parse.ts draws as a figure wherever it
   * stands, blank-line-separated or welded straight under the lead-in ({@link liftFigure}
   * says why the weld lifts). An image further down a beat, one between two beats, one in
   * the opening run, one sharing its line with a sentence: every one of those is left
   * exactly where it was and rendered by the same renderer as before. Nothing is moved,
   * and no beat gains a picture it did not have.
   */
  figure: string | null;
  /** Markdown source of the rest of the beat. */
  body: string;
}

export interface HumanStory {
  /**
   * The opening — everything before the first bold lead-in, and on a beat-less retelling
   * everything before the closing line as well. Often the whole retelling.
   *
   * It is a *run* of markdown, not one paragraph: 15 of this project's 110 open on more than
   * one. Only the first of them is the standfirst the screen sets large (app.css, "the
   * opening"); the rest are body, at the reading size, where a 230-word opening belongs.
   */
  lede: string;
  beats: HumanBeat[];
  /**
   * The closing line: one short sentence, alone in its paragraph, at the very end.
   * `null` when the author did not write one, and never manufactured from a longer one.
   */
  takeaway: string | null;
}

/**
 * How long a last paragraph may be and still be read as the closing line.
 *
 * The contract asks for "one sentence the reader could repeat tomorrow", and the ones in
 * this project's own records run 40–133 characters ("Never trim the output of a failing
 * test."). 200 is loose enough for a long Korean sentence and far short of an ordinary final
 * paragraph, and a paragraph that misses the ceiling is not lost — it stays the last
 * paragraph of its beat, drawn as prose.
 *
 * On the 110 live retellings today it costs none of them: 108 end in the accent block, and
 * the two that do not (BUG-0019, BUG-0024) are held one rule earlier, by the one that asks
 * the closing line to be a paragraph of its own — both authors wrote theirs on the beat's
 * lead-in line (`readHumanStory`). A ceiling nothing here hits is still what the block is
 * worth: it is the one accent-painted area on the page, and this design system carries colour
 * in dots and pills rather than by painting (tokens.css). At the reading size a 200-character
 * line already fills three of them; a 240-character closing paragraph promoted into that
 * block is a paint swatch, and it is usually two sentences, which is not what the block is
 * for. BUG-0024's would be both — 215 characters and two sentences — and this would refuse it
 * even written as its own paragraph.
 *
 * Census claims here have been wrong twice, both times by counting records the ceiling never
 * saw: "about six in a hundred" when three of the six were beat-less retellings, refused
 * before either rule was consulted, and then "five in all are drawn as prose … the other four
 * … which the floor below holds back" when three of those four were a rule of thumb the floor
 * should never have held (BUG-0020, BUG-0021, WORK-0022). Count with the module, not by eye.
 */
const MAX_TAKEAWAY = 200;

/** A line that starts a block which is not a plain paragraph. */
const NOT_PROSE = /^\s*(?:[-*+]|\d{1,9}[.)]|>|#{1,6}\s|```|~~~|\||!\[)/;

/**
 * A line that is nothing but `![alt](src)`.
 *
 * The same test lib/markdown-parse.ts applies (`FIGURE_LINE`) to decide that a line is a
 * *figure* rather than part of a sentence, and the same one agentmon-core's
 * `figure_count` applies to count a page's scenes, so the three cannot disagree about
 * what one line is: an image with a word beside it stays inline prose everywhere.
 */
const FIGURE_BLOCK = /^!\[[^\]]*\]\([^)\s]+\)$/;

/**
 * Lift the scene off the front of a beat, when the author opened the beat with one.
 *
 * The line has to be the *first* of the body and wholly the image. It used to have to be
 * a paragraph of its own as well — the blank line under it read as the author saying
 * "this is a picture" — but the style contract's own words, "cited as the first line of
 * that beat's body", led authors to weld the citation straight under the lead-in, and
 * that shape shipped a scene drawn inline at text height. A line an author gave wholly to
 * an image is a picture whatever touches it (lib/markdown-parse.ts now reads it the same
 * way), so the welded spelling lifts too. Everything else about the beat is untouched,
 * including a body that is nothing but the picture; an image further down, or one sharing
 * its line with words, is left exactly where it was.
 *
 * Called after the closing line has been lifted, deliberately: that reading is of the bytes
 * as the author left them ({@link readHumanStory}), and a beat carved here first would hand
 * it a different last paragraph than the retelling actually ends on.
 */
function liftFigure(beat: HumanBeat): HumanBeat {
  const lines = beat.body.split("\n");
  const first = (lines[0] ?? "").trim();
  if (!FIGURE_BLOCK.test(first)) return beat;
  return { ...beat, figure: first, body: lines.slice(1).join("\n").replace(/^\s+/, "") };
}

/**
 * Lift the closing line off the end of a run of markdown.
 *
 * Returns the source without it, and the line — or nulls when the last paragraph is not one
 * sentence standing alone: a list, a table, a fence, or a paragraph past the ceiling above.
 *
 * `whole` is for the run that has no *last* paragraph because it has only one. Whether that
 * single paragraph is a closing line or the substance of what it ends is not a question the
 * bytes here can answer — it depends on whose paragraph it is — so the caller answers it and
 * {@link readHumanStory} is where the reasoning lives. Called without it, a run of one
 * paragraph keeps its paragraph.
 *
 * A paragraph is what markdown says it is, which is why a newline inside it is not a
 * disqualification. It was for a round — the rule read "no `\n`" — and that made the closing
 * line depend on how the author's editor happened to wrap: the records in this repo store
 * one paragraph per line, so nothing showed it, and a retelling written with a hard wrap at
 * 80 columns lost its accent block outright while the identical text on one line kept it.
 * The lines are joined the way the renderer joins them (a soft break is a space) and the
 * result is measured; a *blank* line still ends the paragraph, because that is the one break
 * markdown treats as one.
 */
function carveTakeaway(source: string, whole = false): { body: string; takeaway: string | null } {
  const text = source.replace(/\s+$/, "");
  const cut = text.lastIndexOf("\n\n");
  if (cut < 0 && !whole) return { body: source, takeaway: null };
  const lines = text
    .slice(cut < 0 ? 0 : cut + 2)
    .split("\n")
    .map((line) => line.trim());
  const last = lines.join(" ").trim();
  /* Every line of it has to be prose: a paragraph whose second line opens a list is two
     blocks, and only the first of them is a sentence. */
  if (!last || last.length > MAX_TAKEAWAY || lines.some((line) => NOT_PROSE.test(line))) {
    return { body: source, takeaway: null };
  }
  return { body: cut < 0 ? "" : text.slice(0, cut).replace(/\s+$/, ""), takeaway: last };
}

/**
 * The last paragraph of a run of markdown, joined the way the renderer joins it.
 *
 * The whole run when it holds only one — which is the reading {@link readHumanStory} needs:
 * "is this the paragraph the retelling ends on?", asked of a retelling that may be one
 * paragraph long.
 */
function lastParagraph(source: string): string {
  const text = source.replace(/\s+$/, "");
  const cut = text.lastIndexOf("\n\n");
  return text.slice(cut < 0 ? 0 : cut + 2).trim();
}

export function readHumanStory(source: string): HumanStory {
  const text = (source ?? "").replace(/\r\n/g, "\n").trim();
  /* `sentence`: what the contract asks an author to bold here is a statement, not a heading
     word, so the ceiling on its length and the boundary its bound clause may close on are
     both a sentence's rather than a label's (lib/sections.ts). Without it this repo's own
     retellings lost 41 of 583 lead-ins to inline body text — 29 of them for being longer
     than a resolution's heading, which is not a fault an author can see or fix. */
  const split = splitLabelledSections(text, { min: 1, sentence: true });
  const beats: HumanBeat[] = split.sections.map((part) => ({
    /* `raw`, not `label`: a lead-in is a sentence and keeps the full stop the author typed.
       `label` is the same run with its punctuation taken off, which is right for a heading
       in a contents rail and wrong here (lib/sections.ts). */
    lead: part.raw,
    trailer: part.trailer,
    figure: null,
    body: part.body,
  }));

  /* The closing line belongs to the *retelling*, not to the beat it happens to sit under, so
     it is lifted off whatever run of markdown the retelling ends on — the last beat's body
     when there are beats, and the opening run itself when there are none.

     That second case was withheld for a round, on the reading that "a retelling with no beats
     has no closing line to lift: its last paragraph is the last thing it says, which is a
     different job." It is not a different job. The contract puts the beat-less shape in
     writing — "A thin record gets no lead-ins at all" (docs/HUMAN_STYLE.md) — one bullet above
     the one that asks every retelling to "close on a rule of thumb, not a summary", so the two
     are orthogonal, and this project's own records say so: all three beat-less retellings
     among the 110 live ones end on exactly that rule of thumb, at 65, 77 and 133 characters
     ("A colour is only as legible as the colours you checked it beside."). All three were
     drawn as one more grey paragraph, on the one page shape that had nothing else to carry it.

     Nothing new is needed to be safe about it: `carveTakeaway`'s own floor is the whole
     guard, and this is the branch that still leans on it. With no blank line in the source
     there is no last *paragraph* to lift, so a retelling that is one paragraph keeps it —
     that paragraph is the retelling, not a line the retelling closes on. A one-paragraph
     *beat* is a different question, and it is answered below. */
  const last = beats[beats.length - 1];
  if (!last) {
    /* A retelling with no beats has nowhere to put a scene — a picture belongs *inside* a
       beat, above its words, and there is no beat here. Whatever images it holds stay in
       the opening run and are drawn where the author put them. */
    const { body, takeaway } = carveTakeaway(split.preamble);
    return { lede: body.trim(), beats, takeaway };
  }

  /* …and the last beat's *whole* body is the closing line when the beat is a lead-in and one
     line, which is how a retelling that lands its rule of thumb hardest tends to end.

     Withheld for two rounds, on the reading that "a one-paragraph beat's single paragraph is
     its body, not its envoi". The records that reading governs refute it: BUG-0020 ends on
     "A key nobody presses in the check is a key nobody has tested." (61 characters),
     BUG-0021 on 108 and WORK-0022 on 76 — three rules of thumb, each alone under its beat's
     lead-in, each drawn as one more grey paragraph while the 105 retellings beside them got
     the accent block for saying the same kind of thing.

     Two halves decide it, and each is a live record's shape:

       * the paragraph has to be the *retelling's* last paragraph, so the line stands on its
         own in the source rather than sharing one with the lead-in above it. BUG-0019 writes
         its closing line on the lead-in's own line ("**Everywhere except a box you type in,
         the right button is now the app's.** Whatever you never answer, something else
         answers for you.") and BUG-0024 the same — one paragraph each, so there is no last
         paragraph to lift, the beat keeps every word where its author put it, and BUG-0024's
         paragraph taken whole is 215 characters, past the ceiling in any case;
       * and the lead-in has to be a statement the author finished ({@link LEAD_IN_END}, the
         same test lib/sections.ts applies to the same bytes one step earlier), read on the
         heading line as the screen draws it — the lead-in plus the clause bound to it, which
         is where BUG-0021 and WORK-0022 put their full stop. An unfinished lead-in is
         completed by the paragraph under it ("**We saved a number**" over "Not a place,
         which is the whole bug."), and lifting that leaves a beat that is half a sentence
         with nothing beneath it. */
  const closes =
    LEAD_IN_END.test(`${last.lead} ${last.trailer}`.trim()) &&
    lastParagraph(text) === last.body.trim();

  const { body, takeaway } = carveTakeaway(last.body, closes);
  if (takeaway) beats[beats.length - 1] = { ...last, body };
  return { lede: split.preamble.trim(), beats: beats.map(liftFigure), takeaway };
}

/** Whether a record carries a human area at all — blank is the same as absent. */
export const hasHumanArea = (human: string | null | undefined): boolean =>
  typeof human === "string" && human.trim().length > 0;

/* --------------------------------------------------------------------------
   Tellings — the dated nodes an update appends
   ----------------------------------------------------------------------- */

/**
 * One telling on the page: the run of retelling under one `### <timestamp>` node — or the
 * page's opening, which has no node and reports `ts: null`.
 *
 * On work logs and bugs the human area grows the way `## Updates` grows (SPEC.md, "The
 * human area", owner decision 2026-08-25): `work start` / `bug create` write the opening,
 * and every `--human` beside a `--message` is appended as a `### <ts>` node stamped like
 * the note it retells, the ending last. Records written before that rule — and every
 * note's human area — are one undated run, which comes back as a single telling.
 */
export interface HumanTelling {
  /** ISO timestamp of the node this telling arrived under; `null` on the opening. */
  ts: string | null;
  story: HumanStory;
}

/**
 * A `### <timestamp>` node line — the only `###` that separates tellings.
 *
 * Date-gated exactly as the agent side's entries are (`starts_with_date` in
 * crates/agentmon-core/src/body.rs): an author's own `### Background` subheading stays
 * inside its telling, and only the dated nodes agentmon writes are edges.
 */
const TELLING_NODE = /^\s*###[ \t]+(\d{4}-\d{2}-\d{2}\S*(?:[ \t].*)?)[ \t]*$/;

/**
 * The page, split at its dated nodes, each part read as its own story.
 *
 * Fence-aware the way every heading rule in this app is (src/lib/markdown-parse.ts): a
 * dated `###` inside a ``` block is code somebody quoted, not an edge. Empty parts are
 * dropped — a page that opens straight on a node has no opening to show — and a page
 * with no nodes at all comes back as one telling, so every record drawn before this
 * shape existed draws exactly as it did.
 */
export function readHumanTellings(source: string): HumanTelling[] {
  const text = (source ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const parts: { ts: string | null; lines: string[] }[] = [{ ts: null, lines: [] }];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    if (fence) {
      parts[parts.length - 1].lines.push(line);
      if (new RegExp(`^\\s*${fence}{3,}\\s*$`).test(line)) fence = null;
      continue;
    }
    const node = line.match(TELLING_NODE);
    if (node) {
      parts.push({ ts: node[1].trim(), lines: [] });
      continue;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) fence = open[1][0];
    parts[parts.length - 1].lines.push(line);
  }
  const kept = parts
    .map((p) => ({ ts: p.ts, source: p.lines.join("\n").trim() }))
    .filter((p) => p.source !== "");
  if (kept.length === 0) return [{ ts: null, story: readHumanStory(text) }];
  return kept.map((p) => ({ ts: p.ts, story: readHumanStory(p.source) }));
}
