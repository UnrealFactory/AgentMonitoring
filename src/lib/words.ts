/**
 * The app's words — one name per state, one noun per object — in one file, the way the
 * colours live in one file (styles/tokens.css). The words themselves now live in
 * lib/i18n/{en,ko}.ts; this file is still the one place that decides *which* word a screen
 * gets, in either language.
 *
 * The defect this closes: relay has two work logs with `status: in_progress`, and the shell
 * used to print that one fact under four names within 200px of itself — "2 active" in the
 * switcher, "2 still open" in the nav tooltip, "2 agents have work open" on the dashboard
 * and "2 in flight" in a chart legend — then "12 records · 2 in progress" on the list and
 * "9 done · 2 in flight" on the Projects screen. Nothing was wrong; it just read like four
 * screens written by four people.
 *
 * The rules, which every string in this file obeys **in both languages**:
 *
 *   * **One word per state.** A work log is `in progress`, `done` or `abandoned`
 *     (진행 중 / 완료 / 중단). A bug is `open`, `in progress`, `resolved` or `closed`
 *     (열림 / 진행 중 / 해결됨 / 닫힘). Never active, in flight, still open, unclaimed,
 *     finished or fixed — those are the same states wearing different clothes.
 *   * **One word per attribute, too.** A bug nobody holds is `unassigned` / `담당자 없음`,
 *     on the board, in its side panel, in the filter menu, on the dashboard and in its own
 *     status strip. It used to be "unclaimed" in the strip, "unassigned" 700px below it and
 *     "needs an owner" on the dashboard: three names for one empty field (P6 round 2 critic).
 *   * **One noun per object.** A work log is a **work log** / **작업 로그**, on every screen.
 *     Not a record, not a log, not an entry.
 *   * **"Open" is a bug word.** It never describes work. Work that is running is
 *     *in progress*, and the duration it has been running is "in progress for 3h".
 *   * **A subset carries its denominator.** "2 in progress" invites the reader to wonder
 *     "out of what"; "2 of 12 in progress" / "12개 중 2개 진행 중" does not. Where the total
 *     is already on screen beside it (a tab count, a group heading) the bare number is the
 *     honest one.
 *   * **The union of two states is named for what it is.** Bugs that are open *or* in
 *     progress are `unresolved` / `미해결` — never "open" / "열림", which is one of the two
 *     states inside it. (This is why Korean spends 미해결 on the union and 열림 on the
 *     state; see the header of lib/i18n/ko.ts.)
 */
import { t } from "./i18n";
import type { BugStatus, Severity, WorkStatus } from "./types";

/* -- objects ---------------------------------------------------------------- */

/** The noun for one unit of recorded work, everywhere in the UI. */
export const workNoun = (): string => t("word.workNoun");
export const bugNoun = (): string => t("word.bugNoun");

/** "1 work log" / "12 work logs" / "작업 로그 12개" */
export const workLogs = (n: number): string => t("word.workLogs", n);
/** "1 bug" / "24 bugs" / "버그 24개" */
export const bugCount = (n: number): string => t("word.bugs", n);
/** "12 events" / "이벤트 12건" */
export const eventCount = (n: number): string => t("word.events", n);

/* -- states ----------------------------------------------------------------- */

/** Sentence-case, for pills, group headings and menu items. */
export const workStatusLabel = (status: WorkStatus): string =>
  status === "done"
    ? t("word.work.done")
    : status === "abandoned"
      ? t("word.work.abandoned")
      : t("word.work.in_progress");

export const bugStatusLabel = (status: BugStatus): string =>
  status === "open"
    ? t("word.bug.open")
    : status === "in_progress"
      ? t("word.bug.in_progress")
      : status === "resolved"
        ? t("word.bug.resolved")
        : t("word.bug.closed");

export const severityLabel = (severity: Severity): string =>
  severity === "critical"
    ? t("word.sev.critical")
    : severity === "high"
      ? t("word.sev.high")
      : severity === "medium"
        ? t("word.sev.medium")
        : t("word.sev.low");

/** Lower-case, for the middle of a sentence: "2 of 12 in progress". */
export const inProgress = (): string => t("word.inProgress");
export const done = (): string => t("word.done");
export const abandoned = (): string => t("word.abandoned");
export const open = (): string => t("word.open");
export const resolved = (): string => t("word.resolved");
export const closed = (): string => t("word.closed");

/**
 * Bugs that still need somebody: `open` or `in progress`.
 *
 * The board's default tab, the sidebar's bug badge and the dashboard's bug panel all count
 * this union. Calling it "open" — as they used to — spends the name of one of the two
 * states inside it, and leaves a claimed bug sitting under a heading that says nobody has
 * it. Wherever the word appears, {@link unresolvedMeans} is one tooltip away.
 */
export const unresolved = (): string => t("word.unresolved");
export const unresolvedLabel = (): string => t("word.unresolvedLabel");
export const unresolvedMeans = (): string => t("word.unresolvedMeans");

/**
 * A bug with an empty `assignee`: nobody is holding it.
 *
 * Not a state — the states are open / in progress / resolved / closed — but the same
 * discipline applies, because a reader who meets "Unclaimed" in the status strip and
 * "unassigned" in the side panel of the same bug has to work out whether they are the same
 * fact. They are. The verb an agent runs is still `agentmon bug claim`: claiming is the
 * action, unassigned is the condition it ends.
 */
export const unassigned = (): string => t("word.unassigned");
export const unassignedLabel = (): string => t("word.unassignedLabel");

/** "unassigned for 6h" / "6시간째 담당자 없음" — the same word, carrying how long. */
export const unassignedFor = (duration: string): string => t("word.unassignedFor", duration);

/**
 * How long a bug took to reach `resolved`, said the way every other surface says it.
 *
 * "Fixed in 11m" in the byline, "Time to fix" in the panel and "fixed 05:02" on the
 * resolution banner were three more names for `resolved`, all on one screen, while the
 * pill, the strip, the tab, the chart legend and the CLI verb said resolved (P6 round 2
 * critic). A resolution may or may not contain a fix — a bug can be resolved by finding
 * the report wrong — so the state word is also the more truthful one.
 */
export const timeToResolve = (): string => t("word.timeToResolve");

/* -- counts ----------------------------------------------------------------- */

/** "2 of 12 in progress" / "12개 중 2개 진행 중" */
export const inProgressOf = (n: number, total: number): string =>
  t("word.inProgressOf", n, total);

/**
 * The same count with its noun in it: "2 of 12 work logs in progress".
 *
 * For the places that carry the whole sentence — the dashboard's hero figure, whose tooltip
 * has to read as the text beside it reads. Appending the noun to {@link inProgressOf}
 * produced "2 of 12 in progress work logs", which is the state word doing duty as an
 * adjective: the vocabulary was right and the grammar was not.
 */
export const workLogsInProgressOf = (n: number, total: number): string =>
  t("word.workLogsInProgressOf", n, total);

/** "2 of 24 unresolved" / "24개 중 2개 미해결" */
export const unresolvedOf = (n: number, total: number): string =>
  t("word.unresolvedOf", n, total);

/** "2 unresolved" / "미해결 2개" — for a badge whose denominator is in its tooltip. */
export const unresolvedCount = (n: number): string => t("word.unresolvedCount", n);

/**
 * Tooltip for any work count: "12 work logs in this project, 2 in progress".
 *
 * `where` is a **place**, not a phrase — a project's name, or null for the project the
 * reader is standing in — because the two languages put it in different halves of the
 * sentence and neither should be assembled from fragments at the call site.
 */
export const workTip = (total: number, inProgressCount: number, where: string | null = null): string =>
  t("word.workTip", total, inProgressCount, where);

/** The same, for a row that is already inside the place it counts: "12 work logs here". */
export const workTipHere = (total: number, inProgressCount: number): string =>
  t("word.workTipHere", total, inProgressCount);

/** Tooltip for any bug count: "2 of 24 bugs unresolved — open or in progress". */
export const bugTip = (unresolvedNow: number, total: number, where: string | null = null): string =>
  t("word.bugTip", unresolvedNow, total, where);

/** …filed in the place the reader is already looking at. */
export const bugTipHere = (unresolvedNow: number, total: number): string =>
  t("word.bugTipHere", unresolvedNow, total);

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
  anyAbandoned ? t("word.doneOrAbandoned") : t("word.done");
export const bugLower = (anyClosedUnfixed: boolean): string =>
  anyClosedUnfixed ? t("word.resolvedOrClosed") : t("word.resolved");
