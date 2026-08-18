/**
 * How wide the agent column of a list has to be.
 *
 * Agent names are slugs the agents chose for themselves, and their length is a property of
 * the project, not of the app: `nova` and `sable` in one vault, `p0-foundation-builder` in
 * another. One hard-coded width cannot serve both — too narrow truncates every row of the
 * second project, too wide leaves a hand's width of dead air in the first. So the column is
 * sized from the names the project actually contains.
 *
 * The estimate below is deliberately allowed to be wrong. It decides *air*, never
 * correctness: the name element ellipsises when it does not fit (`.agent-name`), and the
 * full name is always on the element's title. An underestimate therefore costs a couple of
 * characters and a tooltip — never a glyph sliced down the middle, which is what a fixed box
 * with `overflow: hidden` and no room to ellipsise produced before.
 */

/**
 * Pixels per character at `--text-sm` in Inter, measured in the browser against the real
 * vault slugs: `p0-foundation-builder` 125.8px/21, `scenario-generator` 109.5px/18,
 * `p3-bugs-builder` 93.1px/15, `unassigned` 65.3px/10. Slightly generous for long names,
 * which is the side to err on.
 */
const PER_CHAR = 6.4;

export interface ColumnBounds {
  /** Width of everything in the cell that is not the name: avatars, arrow, gaps. */
  chrome: number;
  min?: number;
  max?: number;
}

/** A CSS length for the column, e.g. `"196px"`. */
export function agentColumnWidth(names: Iterable<string>, { chrome, min = 96, max = 200 }: ColumnBounds): string {
  let longest = 0;
  for (const name of names) longest = Math.max(longest, name.length);
  const want = chrome + longest * PER_CHAR;
  return `${Math.round(Math.min(max, Math.max(min, want)))}px`;
}
