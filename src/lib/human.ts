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
 * bold to a heading, the rest is rendered where the author put it, and a retelling that
 * carries no lead-ins at all (a thin record's, which the contract says gets none) comes back
 * as one plain run of prose. The splitting itself is lib/sections.ts's, called with `min: 1`
 * — the reasoning for that number lives there.
 */
// The `.ts` is deliberate — the same reason as in lib/sections.ts: this module is read by
// plain node in the gates as well as by the bundler.
import { splitLabelledSections } from "./sections.ts";

export interface HumanBeat {
  /** The bold sentence the beat opens on, without its asterisks. */
  lead: string;
  /** The clause the author bound to that sentence, when there is one. */
  trailer: string;
  /** Markdown source of the rest of the beat. */
  body: string;
}

export interface HumanStory {
  /** The opening — everything before the first bold lead-in. Often the whole retelling. */
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
 * this project's own records run 40–90 characters ("A saved number the world can change out
 * from under you is not a saved fact."). 200 is loose enough for a long Korean sentence and
 * far short of an ordinary final paragraph, and a paragraph that misses the ceiling is not
 * lost — it stays the last paragraph of its beat, drawn as prose.
 */
const MAX_TAKEAWAY = 200;

/** A line that starts a block which is not a plain paragraph. */
const NOT_PROSE = /^\s*(?:[-*+]|\d{1,9}[.)]|>|#{1,6}\s|```|~~~|\||!\[)/;

/**
 * Lift the closing line off the end of a run of markdown.
 *
 * Returns the source without it, and the line — or nulls when the last paragraph is not one
 * sentence standing alone (a list, a table, a fence, a wrapped multi-line paragraph, or the
 * only paragraph there is: a one-paragraph beat's single paragraph is its body, not its
 * envoi).
 */
function carveTakeaway(source: string): { body: string; takeaway: string | null } {
  const text = source.replace(/\s+$/, "");
  const cut = text.lastIndexOf("\n\n");
  if (cut < 0) return { body: source, takeaway: null };
  const last = text.slice(cut + 2).trim();
  if (!last || last.includes("\n") || last.length > MAX_TAKEAWAY || NOT_PROSE.test(last)) {
    return { body: source, takeaway: null };
  }
  return { body: text.slice(0, cut).replace(/\s+$/, ""), takeaway: last };
}

export function readHumanStory(source: string): HumanStory {
  const text = (source ?? "").replace(/\r\n/g, "\n").trim();
  const split = splitLabelledSections(text, { min: 1 });
  const beats: HumanBeat[] = split.sections.map((part) => ({
    /* `raw`, not `label`: a lead-in is a sentence and keeps the full stop the author typed.
       `label` is the same run with its punctuation taken off, which is right for a heading
       in a contents rail and wrong here (lib/sections.ts). */
    lead: part.raw,
    trailer: part.trailer,
    body: part.body,
  }));

  /* The closing line belongs to the retelling, not to the beat it happens to sit under, and
     a retelling with no beats has no closing line to lift: its last paragraph is the last
     thing it says, which is a different job. */
  if (!beats.length) return { lede: split.preamble.trim(), beats, takeaway: null };

  const last = beats[beats.length - 1];
  const { body, takeaway } = carveTakeaway(last.body);
  if (takeaway) beats[beats.length - 1] = { ...last, body };
  return { lede: split.preamble.trim(), beats, takeaway };
}

/** Whether a record carries a human area at all — blank is the same as absent. */
export const hasHumanArea = (human: string | null | undefined): boolean =>
  typeof human === "string" && human.trim().length > 0;
