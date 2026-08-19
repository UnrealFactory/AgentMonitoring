/**
 * The app's words — one name per state, one noun per object — in one file, the way the
 * colours live in one file (styles/tokens.css).
 *
 * The defect this closes: relay has two work logs with `status: in_progress`, and the shell
 * used to print that one fact under four names within 200px of itself — "2 active" in the
 * switcher, "2 still open" in the nav tooltip, "2 agents have work open" on the dashboard
 * and "2 in flight" in a chart legend — then "12 records · 2 in progress" on the list and
 * "9 done · 2 in flight" on the Projects screen. Nothing was wrong; it just read like four
 * screens written by four people.
 *
 * The rules, which every string in this file obeys:
 *
 *   * **One word per state.** A work log is `in progress`, `done` or `abandoned`. A bug is
 *     `open`, `in progress`, `resolved` or `closed`. Never active, in flight, still open,
 *     unclaimed, finished or fixed — those are the same states wearing different clothes.
 *   * **One noun per object.** A work log is a **work log**, on every screen. Not a record,
 *     not a log, not an entry.
 *   * **"Open" is a bug word.** It never describes work. Work that is running is
 *     *in progress*, and the duration it has been running is "in progress for 3h".
 *   * **A subset carries its denominator.** "2 in progress" invites the reader to wonder
 *     "out of what"; "2 of 12 in progress" does not. Where the total is already on screen
 *     beside it (a tab count, a group heading) the bare number is the honest one.
 *   * **The union of two states is named for what it is.** Bugs that are open *or* in
 *     progress are `unresolved` — never "open", which is one of the two states inside it.
 */
import { pluralize } from "./format";
import type { BugStatus, Severity, WorkStatus } from "./types";

/* -- objects ---------------------------------------------------------------- */

/** The noun for one unit of recorded work, everywhere in the UI. */
export const WORK_NOUN = "work log";
export const BUG_NOUN = "bug";

/** "1 work log" / "12 work logs" */
export const workLogs = (n: number): string => pluralize(n, WORK_NOUN);
/** "1 bug" / "24 bugs" */
export const bugCount = (n: number): string => pluralize(n, BUG_NOUN);

/* -- states ----------------------------------------------------------------- */

/** Sentence-case, for pills, group headings and menu items. */
export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  in_progress: "In progress",
  done: "Done",
  abandoned: "Abandoned",
};

export const BUG_STATUS_LABEL: Record<BugStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Lower-case, for the middle of a sentence: "2 of 12 in progress". */
export const IN_PROGRESS = "in progress";
export const DONE = "done";
export const ABANDONED = "abandoned";
export const OPEN = "open";
export const RESOLVED = "resolved";
export const CLOSED = "closed";

/**
 * Bugs that still need somebody: `open` or `in progress`.
 *
 * The board's default tab, the sidebar's bug badge and the dashboard's bug panel all count
 * this union. Calling it "open" — as they used to — spends the name of one of the two
 * states inside it, and leaves a claimed bug sitting under a heading that says nobody has
 * it. Wherever the word appears, {@link UNRESOLVED_MEANS} is one tooltip away.
 */
export const UNRESOLVED = "unresolved";
export const UNRESOLVED_LABEL = "Unresolved";
export const UNRESOLVED_MEANS = "open or in progress";

/* -- counts ----------------------------------------------------------------- */

/** "2 of 12 in progress" */
export const inProgressOf = (n: number, total: number): string =>
  `${n} of ${total} ${IN_PROGRESS}`;

/**
 * The same count with its noun in it: "2 of 12 work logs in progress".
 *
 * For the places that carry the whole sentence — the dashboard's hero figure, whose tooltip
 * has to read as the text beside it reads. Appending the noun to {@link inProgressOf}
 * produced "2 of 12 in progress work logs", which is the state word doing duty as an
 * adjective: the vocabulary was right and the grammar was not.
 */
export const workLogsInProgressOf = (n: number, total: number): string =>
  `${n} of ${workLogs(total)} ${IN_PROGRESS}`;

/** "2 of 24 unresolved" */
export const unresolvedOf = (n: number, total: number): string =>
  `${n} of ${total} ${UNRESOLVED}`;

/** "2 unresolved" — for a badge whose denominator is in its tooltip. */
export const unresolvedCount = (n: number): string => `${n} ${UNRESOLVED}`;

/** Tooltip for any work count: "12 work logs in this project, 2 in progress". */
export const workTip = (total: number, inProgress: number, where = "in this project"): string =>
  `${workLogs(total)} ${where}, ${inProgress} ${IN_PROGRESS}`;

/** Tooltip for any bug count: "2 of 24 bugs unresolved — open or in progress". */
export const bugTip = (unresolved: number, total: number, where?: string): string =>
  `${unresolved} of ${bugCount(total)}${where ? ` ${where}` : ""} ${UNRESOLVED} — ${UNRESOLVED_MEANS}`;

/* -- charts ----------------------------------------------------------------- */

/**
 * The burn-up legends, in the same words as the lists they link to.
 *
 * The lower line counts everything that stopped being in progress, so a project with an
 * abandoned work log (or a bug closed without a fix) says so rather than calling it done —
 * otherwise the chart prints a 10 next to a "Done 9" on the work list with nothing
 * explaining the difference.
 */
export const workLower = (anyAbandoned: boolean): string =>
  anyAbandoned ? `${DONE} or ${ABANDONED}` : DONE;
export const bugLower = (anyClosedUnfixed: boolean): string =>
  anyClosedUnfixed ? `${RESOLVED} or ${CLOSED}` : RESOLVED;
