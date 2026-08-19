/**
 * One thing a note can be that the rest of the record cannot show on its own: a correction.
 *
 * The vault is append-only. A record that turns out to state something false is never
 * rewritten — the repair is a later note inside the same record, which is honest but lands
 * at the bottom of a long page, thousands of pixels under the sentence it corrects. A reader
 * who stops at the prose therefore leaves with the wrong fact, and a reader who reaches the
 * note meets a contradiction with nothing saying which side is current (the P6 comprehension
 * critic, three rounds running, on WORK-0011's "relay is three weeks of ten agents").
 *
 * So the page gives a correction weight — a marker on the note and a line at the top of the
 * record — and it does that on ONE signal, written by the author: their note opens with the
 * word `Correction:`. Nothing here reads the prose for facts, pairs a correction with the
 * sentence it corrects, or decides on the reader's behalf which of two claims is true. It
 * only carries the author's own flag up the page to where it can be seen in time.
 */

/**
 * The attribution line `agentmon work update` writes when the note's author is not the
 * record's own agent. It is the CLI's sentence, not the author's, so the author's text
 * starts after it.
 */
const ATTRIBUTION = /^_Update by ([^_\n]+)\._\s*/;

/**
 * Who wrote this note, when it was not the agent whose record it is.
 *
 * A work log's notes are the record agent's by default and carry no byline. When somebody
 * else appends one — a reviewer, or a curator correcting a finished record — the CLI writes
 * `_Update by <name>._` at the top of the note. That is a byline, so the page shows it as
 * one, in the head where every other note's author is shown, instead of leaving it as the
 * first italic line of the prose where it reads like part of what was written.
 */
export function updateAuthor(body: string): string | null {
  return ATTRIBUTION.exec(body)?.[1]?.trim() || null;
}

/** Emphasis around the flag is still the flag: `**Correction:**` is how many authors bold it. */
const FLAG = /^[*_\s]*correction[*_\s]*:/i;

/** The author's own words, with the CLI's attribution line taken off the front. */
export function authorText(body: string): string {
  return body.replace(ATTRIBUTION, "");
}

/**
 * Did the author open this note with `Correction:`?
 *
 * Deliberately the whole rule. A note that says the same thing in other words is a note;
 * the marker exists because the author asked for it.
 */
export function isCorrection(body: string): boolean {
  return FLAG.test(authorText(body));
}

/** How many of these notes their authors flagged as corrections. */
export function countCorrections(notes: { body: string }[]): number {
  return notes.reduce((n, note) => n + (isCorrection(note.body) ? 1 : 0), 0);
}
