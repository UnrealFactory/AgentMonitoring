/**
 * The project dashboard: what is true *right now*, for somebody who was not watching.
 *
 * It is read top to bottom as three answers, in the order a person asks them:
 *
 *   1. **Now** — is anything happening, is anything broken, did anything move today. Live
 *      facts only: durations that count up, ages in hours, the last twenty-four hours as a
 *      shape, and for each work log in progress the outline of its newest note. This band
 *      ignores the time range below it, because "now" is not a range.
 *   2. **Trend** — the two burn-ups. Work started against work finished, bugs filed against
 *      bugs resolved; in both the shaded gap between the lines is the thing that matters
 *      (what is in progress, what is unresolved). Cumulative rather than per-day columns
 *      because these projects are small: eight bugs over three weeks drawn as columns is
 *      mostly empty air, while two lines read the same at any density.
 *   3. **Who and what** — the agents, each with the split of what they have been doing, and
 *      the event log itself cut into days with the recent ones open.
 *
 * Two rules the whole screen obeys:
 *
 *   * **Live means recent, not in progress.** A count of unfinished work says nothing about
 *     whether anybody is at the keyboard; the clock does. So the LIVE flag, the dots on the
 *     rows and the words beside them all come from how long ago the last thing happened.
 *   * **One word per state.** Work is in progress, done or abandoned; a bug is open, in
 *     progress, resolved or closed; the two that need somebody are unresolved. The words are
 *     in lib/words.ts, so this screen and the lists it links to cannot drift apart.
 *   * **Every number is somewhere you can go.** A work log, a bug, a filtered board, a
 *     record in the feed. A dashboard a reader cannot click out of is a poster.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp, useProjectSlug, useVaultNonce } from "../AppContext";
import { api, failureTitle, nothingToRetry } from "../lib/api";
import { agentColumnWidth } from "../lib/columns";
import { useAsync } from "../lib/useAsync";
import { useUrlFilters } from "../lib/useUrlFilters";
import { BurnUp, HourBars, Legend, SplitBar, useNow } from "../components/charts";
import { useContextMenu } from "../components/ContextMenu";
import { useRecordMenu, type RecordRef } from "../lib/menus";
import { EventIcon } from "../components/EventIcon";
import {
  AgentChip,
  BugStatusDot,
  EmptyState,
  ErrorState,
  RichText,
  SeverityBadge,
  Skeleton,
} from "../components/ui";
import {
  formatDate,
  formatDateTimeUtc,
  formatDuration,
  formatRelative,
} from "../lib/format";
import { t } from "../lib/i18n";
import {
  bugLower,
  inProgress,
  severityLabel,
  unassigned,
  unassignedFor,
  unresolved,
  unresolvedMeans,
  workLogs,
  workLogsInProgressOf,
  workLower,
  workStatusLabel,
} from "../lib/words";
import {
  agentRows,
  bugSeries,
  DAY,
  DAY_PREVIEW,
  eventSummary,
  eventVerb,
  freshness,
  dayDate,
  dayLabel,
  groupByDay,
  HOUR,
  initialOpenDays,
  last24h,
  noteOutline,
  refHref,
  severityCounts,
  summarise,
  timeAxis,
  tone,
  toneLabel,
  TONE_COLOR,
  TONE_ORDER,
  triageOrder,
  verbAfterRef,
  workSeries,
  type EventTone,
  type Freshness,
} from "../lib/dashboard";
import type {
  BugSummary,
  Project,
  VaultEvent,
  WorklogSummary,
  WorkUpdate,
} from "../lib/types";
import type { CSSProperties, ReactNode } from "react";

type Snapshot = [Project, WorklogSummary[], BugSummary[], VaultEvent[]];

const NO_WORK: WorklogSummary[] = [];
const NO_BUGS: BugSummary[] = [];
const NO_EVENTS: VaultEvent[] = [];
const NO_NOTES: Record<string, WorkUpdate | undefined> = {};

/** How many rows the two lists in the NOW strip print before they hand over to a board. */
const IN_PROGRESS_ROWS = 3;
const UNRESOLVED_BUG_ROWS = 3;

/**
 * A row's record, in the shape the shared right-button menu wants (lib/menus.ts).
 *
 * Every row on this screen that links to a work log or a bug opens the same Open / Copy id /
 * Copy title / Copy link menu the work list and the bug board open, because it is the same
 * record — and this is the screen a reader lands on first.
 */
const workRef = (w: WorklogSummary, slug: string): RecordRef => ({
  kind: "work",
  id: w.id,
  title: w.title,
  slug,
});
const bugRef = (b: BugSummary, slug: string): RecordRef => ({
  kind: "bug",
  id: b.id,
  title: b.title,
  slug,
});

/** The one filter on this screen, kept in the URL like every other view state. */
const DEFAULTS = { range: "all" };
const ALLOWED = { range: ["7d", "30d", "all"] } as const;
/** The label is read at render, not at module load: the language can change under it. */
const RANGES: { value: string; label: () => string; days: number | null }[] = [
  { value: "7d", label: () => t("dash.range7"), days: 7 },
  { value: "30d", label: () => t("dash.range30"), days: 30 },
  { value: "all", label: () => t("dash.rangeAll"), days: null },
];

export function DashboardPage() {
  const slug = useProjectSlug()!;
  /** Set while the vault is unreadable — the shell says so, and this screen stops
      advertising itself as live (AppContext). */
  const { trouble } = useApp();
  /* Every loader on this screen takes the vault nonce, so a record an agent writes lands
     here without a navigation and without a skeleton — the flag says live, the clock ticks
     every thirty seconds, and now the numbers under them are as new as the sidebar's. */
  const nonce = useVaultNonce();
  const { data, error, status, loading, reload } = useAsync<Snapshot>(
    () =>
      Promise.all([
        api.getProject(slug),
        api.listWorklogs(slug),
        api.listBugs(slug),
        api.listEvents(slug),
      ]),
    [slug],
    nonce
  );

  const now = useNow();
  const { values, set } = useUrlFilters(DEFAULTS, ALLOWED);
  const range = values.range;

  const project = data?.[0];
  const works = data?.[1] ?? NO_WORK;
  const bugs = data?.[2] ?? NO_BUGS;
  const events = data?.[3] ?? NO_EVENTS;

  /* -- now: live facts, never scoped by the range ------------------------- */

  const activeWork = useMemo(
    () =>
      works
        .filter((w) => w.status === "in_progress")
        .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)),
    [works]
  );
  const openBugs = useMemo(
    () => triageOrder(bugs.filter((b) => b.status === "open" || b.status === "in_progress")),
    [bugs]
  );
  const lastDone = useMemo(
    () =>
      works
        .filter((w) => w.status === "done" && w.finished)
        .sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""))[0],
    [works]
  );
  const recent = useMemo(() => last24h(events, now), [events, now]);

  /** Every name this project's own records carry — the only names a note may be read for. */
  const knownAgents = useMemo(
    () =>
      [
        ...new Set([
          ...works.map((w) => w.agent),
          ...bugs.map((b) => b.reporter),
          ...bugs.map((b) => b.assignee ?? ""),
          ...events.map((e) => e.actor),
        ]),
      ].filter(Boolean),
    [works, bugs, events]
  );

  /**
   * The newest note on each work log that is still in progress.
   *
   * `events.jsonl` carries a *summary* of an update, cut to its first clause — enough for a
   * feed line, and not enough to know that the newest note on relay's WORK-0012 reports a
   * data-loss path and two questions put to another agent. The record itself has the whole
   * note, so the strip reads it for the handful of logs that are actually open (never more
   * than the three rows it prints).
   */
  const activeIds = activeWork
    .slice(0, IN_PROGRESS_ROWS)
    .map((w) => w.id)
    .join(",");
  const { data: notes } = useAsync<Record<string, WorkUpdate | undefined>>(async () => {
    const ids = activeIds ? activeIds.split(",") : [];
    const pairs = await Promise.all(
      ids.map(async (id) => {
        try {
          const detail = await api.getWorklog(slug, id);
          return [id, detail.updates[detail.updates.length - 1]] as const;
        } catch {
          // A note is a bonus on top of the row; a record that will not load must never
          // take the strip down with it.
          return [id, undefined] as const;
        }
      })
    );
    return Object.fromEntries(pairs);
  }, [slug, activeIds], nonce);

  /* -- the range, and everything it scopes -------------------------------- */

  const firstActivity = useMemo(() => {
    const stamps = [
      ...events.map((e) => e.ts),
      ...works.map((w) => w.started),
      ...bugs.map((b) => b.created),
    ].filter(Boolean);
    return stamps.length ? Math.min(...stamps.map((s) => Date.parse(s))) : now - 7 * DAY;
  }, [events, works, bugs, now]);

  const days = RANGES.find((r) => r.value === range)?.days ?? null;
  const from = days === null ? firstActivity : Math.max(firstActivity, now - days * DAY);
  const axis = useMemo(() => timeAxis(from, now), [from, now]);

  const work = useMemo(() => workSeries(works, axis), [works, axis]);
  const bug = useMemo(() => bugSeries(bugs, axis), [bugs, axis]);

  /**
   * What the lower line of each burn-up is honestly called.
   *
   * The line has to count everything that stopped being open, or the gap above it stops
   * being "what is still running" — so an abandoned work log counts, and so does a bug
   * closed without a fix. Calling that line "finished" in a project that abandoned one
   * record puts a 10 on this screen next to a "Done 9" on the work list, with nothing
   * saying why. When there is such a record, the label says so; when there is not, the
   * shorter word is the true one.
   */
  const anyAbandoned = works.some((w) => w.status === "abandoned" && w.finished);
  const anyClosedUnfixed = bugs.some((b) => b.status === "closed" && !b.resolved);

  /**
   * Every record in this project, by id.
   *
   * A feed line carries a `ref` — "WORK-0012" — and a summary, not a title, so this is what
   * lets a right-click on a feed row offer the same Copy title the identical row on the work
   * list offers. Built from lists the screen has already read; nothing extra is fetched.
   */
  const recordsById = useMemo(() => {
    const byId = new Map<string, RecordRef>();
    for (const w of works) byId.set(w.id, workRef(w, slug));
    for (const b of bugs) byId.set(b.id, bugRef(b, slug));
    return byId;
  }, [works, bugs, slug]);

  const scoped = useMemo(
    () => events.filter((e) => Date.parse(e.ts) >= axis.from),
    [events, axis.from]
  );
  const agents = useMemo(() => agentRows(scoped, works), [scoped, works]);
  const dayGroups = useMemo(() => groupByDay(scoped), [scoped]);

  if (error) {
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, status)}
          message={error}
          onRetry={nothingToRetry(error, status) ? undefined : reload}
          action={
            <Link className="button" to="/projects">
              {t("nav.allProjects")}
            </Link>
          }
        />
      </div>
    );
  }
  if (loading || !project) {
    return (
      <div className="page">
        <Skeleton rows={6} />
      </div>
    );
  }

  const rangeNote =
    days !== null
      ? t("dash.rangeDays", days)
      : events.length === 1
        ? // "all 1 recorded event" is not a sentence anybody writes.
          t("dash.rangeOneEvent", formatDate(new Date(firstActivity).toISOString()))
        : t(
            "dash.rangeAllEvents",
            events.length,
            formatDate(new Date(firstActivity).toISOString())
          );
  /** Named once, so the charts, their deltas and the sentence above them agree. */
  const scopeLabel = days === null ? null : t("dash.rangeDays", days);
  const changeNote = scopeLabel ? t("dash.changeOver", scopeLabel) : "";
  const archived = project.status === "archived";
  /* An archived project is history, not a live board: a green LIVE flag over one is the
     screen contradicting the Projects page that just filed it away (round 1 critic). And a
     window that has just said it cannot read the vault may not also claim to be live. */
  const live =
    !archived && !trouble && freshness(project.counts.lastActivity, now) === "live";

  return (
    <div className="page dashboard">
      <header className="page-head">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-sub">{project.description}</p>
        </div>
        {/* Live is a statement about the clock, not about how much is unfinished: a
            project with two work logs in progress nobody has touched since yesterday is not live,
            and saying so beside "Last activity 19h ago" was the flag contradicting the
            sentence next to it (round 1 critic). */}
        <div className="page-head-meta tabular">
          {archived ? (
            <Link className="pill pill-archived" to="/projects" title={t("dash.archivedTip")}>
              {t("dash.archivedPill")}
            </Link>
          ) : live ? (
            <span className="live-flag" title={t("dash.liveTip")}>
              <span className="live-dot" aria-hidden="true" />
              {t("dash.live")}
            </span>
          ) : null}
          {t("dash.lastActivity", formatRelative(project.counts.lastActivity, new Date(now)))}
        </div>
      </header>

      <section className="now-strip" aria-label={t("dash.currentState")}>
        <InProgress
          slug={slug}
          active={activeWork}
          total={works.length}
          lastDone={lastDone}
          notes={notes ?? NO_NOTES}
          agents={knownAgents}
          now={now}
        />
        <UnresolvedBugs slug={slug} bugs={openBugs} total={bugs.length} now={now} />
        <LastDay recent={recent} events={events} now={now} />
      </section>

      <div className="dash-toolbar">
        <div className="segmented" role="tablist" aria-label={t("dash.timeRange")}>
          {RANGES.map((r) => (
            <button
              key={r.value}
              role="tab"
              data-value={r.value}
              aria-selected={range === r.value}
              className={`segment${range === r.value ? " is-active" : ""}`}
              onClick={() => set("range", r.value)}
            >
              {r.label()}
            </button>
          ))}
        </div>
        <p className="dash-scope">{t("dash.scope", rangeNote)}</p>
      </div>

      {/* The legends are the list screens' words: a chart that says "in flight" over a
          list that says "In progress" is two names for one fact (lib/words.ts). */}
      <div className="grid-2">
        <ChartCard
          title={t("dash.chartWork")}
          sub={t("dash.chartWorkSub", changeNote)}
          action={
            <Link className="card-action" to={`/p/${slug}/work`}>
              {t("dash.allWork")}
            </Link>
          }
        >
          <BurnUp
            series={work}
            upper={{ label: t("dash.seriesStarted"), color: "var(--series-work)" }}
            lower={{ label: workLower(anyAbandoned), color: "var(--series-done)" }}
            gap={{ label: inProgress(), wash: "var(--series-work-wash)" }}
            noun={t("dash.nounWorkLogs")}
            scope={scopeLabel}
            empty={{
              title: t("dash.chartWorkEmpty"),
              hint: t("dash.chartWorkEmptyHint", slug),
            }}
          />
        </ChartCard>

        <ChartCard
          title={t("dash.chartBugs")}
          sub={t("dash.chartBugsSub", changeNote)}
          action={
            <Link className="card-action" to={`/p/${slug}/bugs?tab=all`}>
              {t("dash.bugBoard")}
            </Link>
          }
        >
          <BurnUp
            series={bug}
            upper={{ label: t("dash.seriesFiled"), color: "var(--series-bug)" }}
            lower={{ label: bugLower(anyClosedUnfixed), color: "var(--series-fix)" }}
            gap={{ label: unresolved(), wash: "var(--series-bug-wash)" }}
            noun={t("dash.nounBugs")}
            scope={scopeLabel}
            empty={{
              title: t("dash.chartBugsEmpty"),
              hint: t("dash.chartBugsEmptyHint"),
            }}
          />
        </ChartCard>
      </div>

      <AgentsCard slug={slug} rows={agents} total={scoped.length} now={now} />

      <ActivityCard
        slug={slug}
        groups={dayGroups}
        total={scoped.length}
        now={now}
        records={recordsById}
      />
    </div>
  );
}

/* ==========================================================================
   The NOW strip
   ======================================================================= */

/** The dot and the words that go with a record nobody has touched for a while. */
const FRESH_DOT: Record<Freshness, string> = {
  live: "sdot-live",
  quiet: "sdot-quiet",
  stale: "sdot-stale",
};

function InProgress({
  slug,
  active,
  total,
  lastDone,
  notes,
  agents,
  now,
}: {
  slug: string;
  active: WorklogSummary[];
  /** Every work log this project has ever had — the denominator of the hero figure. */
  total: number;
  lastDone: WorklogSummary | undefined;
  notes: Record<string, WorkUpdate | undefined>;
  agents: string[];
  now: number;
}) {
  const working = new Set(active.map((w) => w.agent));
  const iso = new Date(now).toISOString();
  /* These rows are work logs, so they carry the work log menu — the same four items the
     identical row on /work has offered since P8. The dashboard is the default landing
     route, which made it the one screen where a reader met the right button and got
     nothing (P8 round 2 critic). */
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  return (
    <section className="now-panel now-panel-wide">
      <h2 className="now-label">{t("dash.workingNow")}</h2>
      {/* The same fact the switcher, the nav tooltip and the Work chart print — counted the
          same way and named with the same word, out of the same denominator. The agents
          holding it are the sentence underneath, because "2 work logs" and "2 agents" are
          not the same number in a project where one agent holds two. */}
      <p
        className="now-hero"
        title={total === 0 ? undefined : workLogsInProgressOf(active.length, total)}
      >
        <span className={`now-hero-value${active.length === 0 ? " is-quiet" : ""}`}>
          {active.length}
        </span>
        <span className="now-hero-unit">
          {/* "0 of 0 in progress" is arithmetic, not a sentence: a project with no work
              logs at all says that instead. */}
          {total === 0 ? (
            t("dash.workLogsHere")
          ) : (
            <>
              {/* The noun belongs to the number it follows — the denominator. Keyed off the
                  numerator it printed "1 of 17 work log in progress" the moment one work log
                  was in progress out of seventeen. */}
              {t("dash.heroUnit", total)}
              {working.size > 0 && (
                <span className="now-hero-aside"> · {t("dash.agents", working.size)}</span>
              )}
            </>
          )}
        </span>
      </p>

      {active.length === 0 ? (
        /* Nobody is working. The panel still has one useful thing to say — what stopped
           last — and saying it here keeps the answer to "is anything happening" and the
           answer to "what happened most recently" in the same place. */
        <>
          {lastDone && (
            <ul className="now-list">
              <li>
                <Link
                  className="now-row"
                  to={`/p/${slug}/work/${lastDone.id}`}
                  {...contextMenu(() => recordMenu(workRef(lastDone, slug)))}
                >
                  <span className="sdot sdot-done" aria-hidden="true" />
                  <span className="now-row-main">
                    <span className="now-row-title" title={lastDone.title}>
                      {lastDone.title}
                    </span>
                    <span className="now-row-sub">
                      <AgentChip name={lastDone.agent} />
                      <span className="now-row-id mono">{lastDone.id}</span>
                    </span>
                  </span>
                  <span className="now-row-time">
                    <span className="now-row-dur is-done tabular">
                      <span className="now-row-durlabel">{t("dash.took")}</span>{" "}
                      {formatDuration(lastDone.started, lastDone.finished)}
                    </span>
                    <span className="now-row-since tabular">
                      {t("dash.finishedWhen", formatRelative(lastDone.finished, new Date(now)))}
                    </span>
                  </span>
                </Link>
              </li>
            </ul>
          )}
          <p className="now-note">
            <RichText text={lastDone ? t("dash.nothingInProgress") : t("dash.noWorkYet")} />
          </p>
        </>
      ) : (
        <ul className="now-list">
          {active.slice(0, IN_PROGRESS_ROWS).map((w) => (
            <InProgressRow
              key={w.id}
              slug={slug}
              work={w}
              note={notes[w.id]}
              agents={agents}
              now={now}
              iso={iso}
            />
          ))}
          {active.length > IN_PROGRESS_ROWS && (
            <li>
              <Link className="now-more" to={`/p/${slug}/work?status=in_progress`}>
                {t("dash.moreInProgress", active.length - IN_PROGRESS_ROWS)}
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function InProgressRow({
  slug,
  work,
  note,
  agents,
  now,
  iso,
}: {
  slug: string;
  work: WorklogSummary;
  note: WorkUpdate | undefined;
  /** Every agent name this project's records carry, for reading an ask in the note. */
  agents: string[];
  now: number;
  iso: string;
}) {
  const state = freshness(work.lastActivity, now);
  const outline = noteOutline(note?.body, 3, agents);
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  /* Two facts, two different clocks, and the row says which is which: how long this has
     been open (the hero number, which used to sit there with no label at all), and how
     long since anybody touched it. A log with no updates yet says that instead of dressing
     its own start time up as an update. */
  const since =
    work.updateCount === 0
      ? t("dash.noUpdates")
      : state === "live"
        ? t("dash.updatedWhen", formatRelative(work.lastActivity, new Date(now)))
        : t("dash.noUpdateIn", formatDuration(work.lastActivity, iso));

  /* The quote is a sibling of the row, not a child of it: it carries its own link (the
     agent an ask names), and a link inside a link is neither valid nor clickable. The two
     of them share one hover surface, so the pair still reads as a single row. */
  return (
    /* The menu is on the <li>, not on the <a> inside it: the row and the note quoted under
       it share one hover surface and read as a single row about one work log, so the right
       button answers the same way over either half. Events from the link bubble here, which
       is also how Shift+F10 on the focused link reaches this handler. */
    <li className="now-item" {...contextMenu(() => recordMenu(workRef(work, slug)))}>
      <Link className="now-row" to={`/p/${slug}/work/${work.id}`}>
        <span
          className={`sdot ${FRESH_DOT[state]}`}
          title={t("dash.rowStateTip", workStatusLabel("in_progress"), since)}
          aria-hidden="true"
        />
        <span className="now-row-main">
          <span className="now-row-title" title={work.title}>
            {work.title}
          </span>
          <span className="now-row-sub">
            <AgentChip name={work.agent} />
            <span className="now-row-id mono">{work.id}</span>
          </span>
        </span>
        <span className="now-row-time">
          {/* "open for 3h" is what the bug panel says about a bug. Work is never open;
              it is in progress (lib/words.ts). */}
          <span
            className={`now-row-dur is-${state} tabular`}
            title={t("dash.rowStartedTip", formatDateTimeUtc(work.started))}
          >
            <span className="now-row-durlabel">{t("dash.rowInProgress")}</span>{" "}
            {formatDuration(work.started, iso)}
          </span>
          <span className="now-row-since tabular" title={formatDateTimeUtc(work.lastActivity)}>
            {since}
          </span>
        </span>
      </Link>

      {outline.lines.length > 0 && note && (
        <div className="now-quote">
          <p className="now-quote-head">
            <span
              className="now-quote-lead"
              title={t("dash.latestNoteTip", formatDateTimeUtc(note.ts))}
            >
              {t("dash.latestNote")}
            </span>
            {/* Only ever a name that appears in the quoted sentence, and the sentence is in
                the tooltip: the chip is a pointer to what the agent wrote, not the app's
                own conclusion about who is blocking whom. */}
            {outline.waitingOn && outline.waitingOn !== work.agent && (
              <Link
                className="now-ask"
                to={`/p/${slug}/work?agent=${encodeURIComponent(outline.waitingOn)}`}
                title={t(
                  "dash.waitingOnTip",
                  work.agent,
                  outline.lines.find((l) => l.ask)?.text ?? ""
                )}
              >
                {t("dash.waitingOn", outline.waitingOn)}
              </Link>
            )}
          </p>
          {outline.lines.map((line, i) => (
            /* Each line carries its own sentence in the tooltip, so a sentence too long
               for the column is still readable without leaving the page — and the record
               itself, one click away, still has the note in full. */
            <p
              className={`now-quote-line${line.ask ? " is-ask" : ""}`}
              key={i}
              title={line.text}
            >
              {line.gap ? `… ${line.text}` : line.text}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Unresolved bugs — open or in progress — as counts and then as the bugs themselves.
 *
 * Counting by severity says two need somebody and one of them is high; it does not say
 * *which*, or whether anybody has it. The one bug this panel used to name was the oldest —
 * which in relay is the medium one an agent had already claimed and planned a fix for,
 * while the high-severity GA blocker nobody had touched went unnamed (round 1 critic). So
 * the panel lists them in the order somebody triaging would take them, and prints ownership
 * as a state rather than leaving it to be inferred from an event that is missing.
 *
 * It is titled "Unresolved", not "Open": one of the bugs under it is claimed and *in
 * progress*, and a heading that calls it open contradicts the pill on its own row.
 */
function UnresolvedBugs({
  slug,
  bugs: unresolvedBugs,
  total,
  now,
}: {
  slug: string;
  /** The unresolved ones, in triage order. Named for what they are, not for the panel. */
  bugs: BugSummary[];
  total: number;
  now: number;
}) {
  const counts = severityCounts(unresolvedBugs);
  const shown = unresolvedBugs.slice(0, UNRESOLVED_BUG_ROWS);
  const iso = new Date(now).toISOString();
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  return (
    <section className="now-panel">
      <h2 className="now-label">
        <Link
          className="now-label-link"
          to={`/p/${slug}/bugs`}
          title={t("bugs.tabUnresolvedTip", unresolvedMeans())}
        >
          {t("dash.unresolvedBugs")}
        </Link>
      </h2>
      <p className="now-figure">
        <span className={`now-figure-value${unresolvedBugs.length === 0 ? " is-quiet" : ""}`}>
          {unresolvedBugs.length}
        </span>
        <span className="now-figure-unit">
          {total === 0
            ? t("dash.bugsFiledHere")
            : t("dash.unresolvedOfFiled", unresolved(), total)}
        </span>
      </p>

      <ul className="now-sev">
        {counts.map(({ severity, count }) => (
          <li key={severity}>
            <Link
              className={`sev-chip sev-chip-${severity}${count === 0 ? " is-zero" : ""}`}
              to={`/p/${slug}/bugs?severity=${severity}`}
              title={t("dash.sevChipTip", count, unresolved(), severityLabel(severity))}
            >
              <span className="sev-chip-dot" aria-hidden="true" />
              <span className="sev-chip-label">{severityLabel(severity)}</span>
              <span className="sev-chip-count tabular">{count}</span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length > 0 && (
        <ul className="now-list">
          {shown.map((b) => (
            <li key={b.id}>
              <Link
                className="now-row"
                to={`/p/${slug}/bugs/${b.id}`}
                {...contextMenu(() => recordMenu(bugRef(b, slug)))}
              >
                <BugStatusDot status={b.status} />
                <span className="now-row-main">
                  {/* Three lines, not one line cut mid-word: the highest-priority item on
                      the screen used to read "…rate-limited endp…" with a third of the card
                      standing empty below it (round 2 critic), and two lines still clamped
                      this vault's longest titles into that same empty space. */}
                  <span className="now-row-title is-wrap" title={b.title}>
                    {b.title}
                  </span>
                  <span className="now-row-sub">
                    <SeverityBadge severity={b.severity} />
                    <span className="now-row-id mono">{b.id}</span>
                    {b.assignee ? (
                      <AgentChip name={b.assignee} />
                    ) : (
                      /* One word for one empty field: `unassigned`, the same word the board
                         row, the filter menu, the status strip and the side panel use
                         (lib/words.ts). It used to read "unclaimed" here and "needs an
                         owner" when the wait got long — three names for the fact that
                         nobody is holding this bug (P6 round 2 critic). The wait is a
                         number, not a third name, so the flag carries the duration and
                         turns amber once a bug this severe has waited longer than half a
                         working day — a rule the tooltip states, so the colour is not the
                         claim (P4 round 2 critic). */
                      <span
                        className={`now-flag${needsOwner(b, now) ? " is-urgent" : ""}`}
                        title={
                          needsOwner(b, now)
                            ? t(
                                "dash.noOwnerTip",
                                severityLabel(b.severity),
                                formatDuration(b.created, iso)
                              )
                            : t("dash.hasOwnerTip")
                        }
                      >
                        {needsOwner(b, now)
                          ? unassignedFor(formatDuration(b.created, iso))
                          : unassigned()}
                      </span>
                    )}
                  </span>
                </span>
                <span className="now-row-time">
                  <span
                    className="now-row-dur is-bug tabular"
                    title={t("dash.filedTip", formatDateTimeUtc(b.created))}
                  >
                    <span className="now-row-durlabel">{t("dash.openFor")}</span>{" "}
                    {formatDuration(b.created, iso)}
                  </span>
                  <span
                    className="now-row-since tabular"
                    title={
                      b.lastActivity > b.created
                        ? t("dash.lastActivityTip", formatDateTimeUtc(b.lastActivity))
                        : t("dash.untouchedTip")
                    }
                  >
                    {b.lastActivity > b.created
                      ? t("dash.updatedWhen", formatRelative(b.lastActivity, new Date(now)))
                      : t("dash.untouched")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {unresolvedBugs.length > shown.length && (
            <li>
              <Link className="now-more" to={`/p/${slug}/bugs`}>
                {t("dash.moreUnresolved", unresolvedBugs.length - shown.length, unresolved())}
              </Link>
            </li>
          )}
        </ul>
      )}

      <p className="now-note">
        {unresolvedBugs.length > 0
          ? t("dash.triageNote", unassigned())
          : total === 0
            ? t("dash.noBugsFiled")
            : t("dash.allResolved")}
      </p>
    </section>
  );
}

/**
 * A bug nobody owns, at a severity that will not wait. The threshold is stated wherever it
 * is used, so nothing here is a silent policy: half a working day, critical and high only.
 */
const NEEDS_OWNER_AFTER = 4 * HOUR;

const needsOwner = (bug: BugSummary, now: number): boolean =>
  !bug.assignee &&
  (bug.severity === "critical" || bug.severity === "high") &&
  now - Date.parse(bug.created) >= NEEDS_OWNER_AFTER;

function LastDay({
  recent,
  events,
  now,
}: {
  recent: ReturnType<typeof last24h>;
  events: VaultEvent[];
  now: number;
}) {
  /* Every event in the window is accounted for, and the parts add up to the figure above
     them: a day of nine described as "1 started · 1 finished · 1 filed" left six events —
     the notes, claims and comments that were most of the traffic — unmentioned (round 2
     critic). Beyond four kinds the tail merges into "other" rather than being dropped. */
  const parts = summarise(recent.breakdown).map((p) => t("dash.countPart", p.count, t(p.key)));
  /* And silence is stated, not left as an absence of bars. */
  const quiet =
    events[0] && now - Date.parse(events[0].ts) >= 2 * HOUR
      ? t("dash.quietFor", formatDuration(events[0].ts, new Date(now).toISOString()))
      : null;

  return (
    <section className="now-panel now-panel-day">
      {/* A figure and its chart, side by side: the count of the last day, and the shape of
          it hour by hour across the full width of the screen. */}
      <div className="day-figure">
        <h2 className="now-label">
          <a className="now-label-link" href="#activity">
            {t("dash.last24h")}
          </a>
        </h2>
        <p className="now-figure">
          <span className={`now-figure-value${recent.total === 0 ? " is-quiet" : ""}`}>
            {recent.total}
          </span>
          <span className="now-figure-unit">{t("dash.eventsRecorded", recent.total)}</span>
        </p>
        <p className="now-note">
          {recent.total === 0 ? (
            <>
              {t("dash.quiet")}{" "}
              {events[0]
                ? t("dash.lastThing", formatRelative(events[0].ts, new Date(now)))
                : t("dash.neverAnything")}
            </>
          ) : (
            <>
              {parts.length ? `${parts.join(" · ")} · ` : ""}
              {t("dash.agents", recent.actors.length)}
              {quiet ? ` · ${quiet}` : ""}
            </>
          )}
        </p>
      </div>

      <HourBars
        hours={recent.hours}
        label={t("dash.hoursLabel", recent.hours.map((h) => h.count).join(", "))}
      />
    </section>
  );
}

/* ==========================================================================
   Chart card: title, one line saying what is plotted, legend, link out
   ======================================================================= */

function ChartCard({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card chart-card">
      <header className="card-head chart-head">
        <div className="chart-heading">
          <h2 className="card-title">{title}</h2>
          <p className="chart-sub">{sub}</p>
        </div>
        {action}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

/* ==========================================================================
   Agents
   ======================================================================= */

function AgentsCard({
  slug,
  rows,
  total,
  now,
}: {
  slug: string;
  rows: ReturnType<typeof agentRows>;
  /** Events in the range — the number the Activity card below prints. */
  total: number;
  now: number;
}) {
  /* The name column is sized from this project's own agent names — `nova` and
     `p0-foundation-builder` cannot share one width — and the name is the one thing in the
     row allowed to give ground, because it is the one thing that ellipsises and carries a
     tooltip. Everything else in the row is a number that would be a lie if it were cut
     (vault BUG-0006). */
  /* `chrome` is everything in the cell that is not the name, measured: the status dot
     (8px), the avatar (18px) and the two gaps (8 + 6). */
  const nameWidth = agentColumnWidth(
    rows.map((r) => r.agent),
    { chrome: 40, min: 118, max: 210 }
  );
  const max = Math.max(1, ...rows.map((r) => r.total));
  const anyProject = rows.some((r) => r.project > 0);

  return (
    <section className="card">
      <header className="card-head">
        <h2 className="card-title">{t("dash.agentsCard")}</h2>
        <Legend
          items={[
            { color: "var(--series-work)", label: t("dash.legendWork") },
            { color: "var(--series-bug)", label: t("dash.legendBugs") },
            ...(anyProject ? [{ color: "var(--grey)", label: t("dash.legendProject") }] : []),
          ]}
        />
        <Link className="card-action" to={`/p/${slug}/work`}>
          {t("dash.allWork")}
        </Link>
      </header>
      <div className="card-body">
        {rows.length === 0 ? (
          <EmptyState title={t("dash.agentsEmpty")} hint={t("dash.agentsEmptyHint")} />
        ) : (
          <div className="agent-table" style={{ "--agent-col": nameWidth } as CSSProperties}>
            <div className="agent-head" role="row">
              <span className="agent-cell-name">{t("dash.colAgent")}</span>
              <span className="agent-cell-bar">{t("dash.colActivity")}</span>
              <span className="agent-cell-num" title={t("wd.doneCount")}>
                {t("dash.colDone")}
              </span>
              <span className="agent-cell-num" title={t("dash.colFiledTip")}>
                {t("dash.colFiled")}
              </span>
              <span className="agent-cell-num" title={t("dash.colResolvedTip")}>
                {t("dash.colResolved")}
              </span>
              <span className="agent-cell-seen">{t("dash.colLastSeen")}</span>
            </div>
            <ul className="agent-rows">
              {rows.map((r) => {
                /* The dot means "has a work log in progress"; how bright it is means "and
                   was here recently". An agent holding one who has not been seen since
                   yesterday gets the same hollow dot their idle colleagues get, because
                   that is what is true. */
                const state = freshness(r.lastActivity, now);
                return (
                  <li key={r.agent}>
                    <Link
                      className="agent-row"
                      to={
                        r.hasWorklogs
                          ? `/p/${slug}/work?agent=${encodeURIComponent(r.agent)}`
                          : `/p/${slug}/bugs?tab=all&reporter=${encodeURIComponent(r.agent)}`
                      }
                    >
                      <span className="agent-cell-name">
                        {r.activeNow > 0 ? (
                          <span
                            className={`sdot ${FRESH_DOT[state]}`}
                            role="img"
                            aria-label={`${workLogs(r.activeNow)} ${inProgress()}`}
                            title={t(
                              "dash.agentDotTip",
                              workLogs(r.activeNow),
                              inProgress(),
                              formatRelative(r.lastActivity, new Date(now))
                            )}
                          />
                        ) : (
                          /* "Who is free right now" was inferable only from a hollow circle
                             with no title on it (round 2 critic). */
                          <span
                            className="sdot sdot-idle"
                            role="img"
                            aria-label={t("dash.agentIdleLabel")}
                            title={t(
                              "dash.agentIdleTip",
                              inProgress(),
                              formatRelative(r.lastActivity, new Date(now))
                            )}
                          />
                        )}
                        <AgentChip name={r.agent} />
                      </span>
                      <span className="agent-cell-bar">
                        <SplitBar
                          max={max}
                          total={r.total}
                          title={t("dash.agentBarTip", r.total, r.work, r.bugs, r.project)}
                          parts={[
                            { value: r.work, color: "var(--series-work)", label: "work" },
                            { value: r.bugs, color: "var(--series-bug)", label: "bugs" },
                            { value: r.project, color: "var(--grey)", label: "project" },
                          ]}
                        />
                        <span className="agent-total tabular">{r.total}</span>
                      </span>
                      <span className="agent-cell-num tabular">{r.done}</span>
                      <span className="agent-cell-num tabular">{r.filed}</span>
                      <span className="agent-cell-num tabular">{r.fixed}</span>
                      <span
                        className="agent-cell-seen tabular"
                        title={formatDateTimeUtc(r.lastActivity)}
                      >
                        {formatRelative(r.lastActivity, new Date(now))}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {/* The sum of this column is the number on the card below it, and saying so is
                cheaper than leaving a reader to add four rows up and find 83 under an
                "85 events" heading (round 2 critic). */}
            <p className="table-note">{t("dash.agentTableNote", total)}</p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ==========================================================================
   Activity: the event log, cut into days
   ======================================================================= */

function ActivityCard({
  slug,
  groups,
  total,
  now,
  records,
}: {
  slug: string;
  groups: ReturnType<typeof groupByDay>;
  total: number;
  now: number;
  /** Every record in this project by id, so a feed row can name what it points at. */
  records: Map<string, RecordRef>;
}) {
  const [override, setOverride] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const initial = useMemo(() => new Set(initialOpenDays(groups, now)), [groups, now]);
  const isOpen = useCallback(
    (day: number) => override[day] ?? initial.has(day),
    [override, initial]
  );
  const toggle = useCallback(
    (day: number) => setOverride((o) => ({ ...o, [day]: !(o[day] ?? initial.has(day)) })),
    [initial]
  );

  /* Reading the last week meant eight separate clicks, one drawer at a time (round 2
     critic). One control opens the lot, and turns into the one that puts them back. */
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.day));
  const setAll = useCallback(
    (open: boolean) =>
      setOverride(Object.fromEntries(groups.map((g) => [g.day, open])) as Record<number, boolean>),
    [groups]
  );

  /* The collapsed day rows draw a bar per day, which makes them a chart — so they get a
     legend, in the tones this project's own days actually contain, and the bar is as long
     as the day was busy rather than every day drawing the same stripe (round 1 critic). */
  const tones = useMemo(() => {
    const seen = new Set<EventTone>();
    for (const g of groups) for (const m of g.mix) seen.add(m.tone);
    // Always in the same order, whatever order this project's days happen to be in, so the
    // legend does not reshuffle itself between two projects or two ranges.
    return TONE_ORDER.filter((t) => seen.has(t));
  }, [groups]);
  const busiest = Math.max(1, ...groups.map((g) => g.events.length));

  return (
    <section className="card" id="activity">
      <header className="card-head">
        <h2 className="card-title">{t("dash.activity")}</h2>
        {tones.length > 0 && (
          <Legend
            items={tones.map((tn) => ({
              color: TONE_COLOR[tn],
              label: toneLabel(tn),
              band: true,
            }))}
          />
        )}
        <span className="card-note tabular">{t("dash.activityNote", total, groups.length)}</span>
        {groups.length > 1 && (
          <button className="card-action" onClick={() => setAll(!allOpen)}>
            {allOpen ? t("dash.collapseAll") : t("dash.expandAll")}
          </button>
        )}
      </header>
      <div className="card-body">
        {groups.length === 0 ? (
          <EmptyState title={t("dash.activityEmpty")} hint={t("dash.activityEmptyHint")} />
        ) : (
          <ol className="day-list">
            {groups.map((g) => {
              const open = isOpen(g.day);
              const mixLabel = t(
                "dash.dayMix",
                g.events.length,
                g.mix.map((m) => t("dash.countPart", m.count, toneLabel(m.tone))).join(", ")
              );
              return (
                <li className={`day${open ? " is-open" : ""}`} key={g.day}>
                  <button
                    className="day-head"
                    aria-expanded={open}
                    onClick={() => toggle(g.day)}
                    title={`${dayDate(g.day)} UTC · ${mixLabel}`}
                  >
                    <svg className="day-caret" viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M4.5 2.5 L8 6 L4.5 9.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="day-label">{dayLabel(g.day, now)}</span>
                    <span className="day-date tabular">{dayDate(g.day)}</span>
                    <span className="day-mix-track">
                      <span
                        className="day-mix"
                        role="img"
                        aria-label={mixLabel}
                        style={{ width: `${Math.max(8, (g.events.length / busiest) * 100)}%` }}
                      >
                        {g.mix.map((m) => (
                          <span
                            key={m.tone}
                            className={`mix-seg tone-${m.tone}`}
                            style={{ flexGrow: m.count }}
                          />
                        ))}
                      </span>
                    </span>
                    <span className="day-count tabular">{g.events.length}</span>
                    <span className="day-actors" title={g.actors.join(", ")}>
                      {g.actors.slice(0, 4).map((a) => (
                        <AgentChip key={a} name={a} hideName />
                      ))}
                      {g.actors.length > 4 && (
                        <span className="day-actors-more tabular">+{g.actors.length - 4}</span>
                      )}
                    </span>
                  </button>

                  {open && (
                    <ol className="feed">
                      {(expanded[g.day] ? g.events : g.events.slice(0, DAY_PREVIEW)).map((e, i) => (
                        <FeedRow
                          slug={slug}
                          event={e}
                          now={now}
                          records={records}
                          key={`${e.ts}-${i}`}
                        />
                      ))}
                      {!expanded[g.day] && g.events.length > DAY_PREVIEW && (
                        <li className="feed-more-row">
                          <button
                            className="feed-more"
                            onClick={() => setExpanded((x) => ({ ...x, [g.day]: true }))}
                          >
                            {t("dash.showOther", g.events.length - DAY_PREVIEW, dayLabel(g.day, now))}
                          </button>
                        </li>
                      )}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function FeedRow({
  slug,
  event,
  now,
  records,
}: {
  slug: string;
  event: VaultEvent;
  now: number;
  records: Map<string, RecordRef>;
}) {
  const href = refHref(slug, event.ref);
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  /* A feed line about a record is a row about that record, and gets its menu. The lines
     about the project itself — created, renamed — link nowhere and offer nothing, which is
     the same rule the rest of the app keeps: a menu only where there is something to do. */
  const record = event.ref ? records.get(event.ref) : undefined;
  const body = (
    <>
      <span className="feed-icon" aria-hidden="true">
        <EventIcon type={event.type} />
      </span>
      <span className="feed-body">
        {/* "nova started WORK-0012" — and in Korean, where the verb closes the clause,
            "nova WORK-0012 시작". Same three spans, same classes, one swap of order. */}
        <span className="feed-head">
          <span className="feed-actor">{event.actor}</span>
          {verbAfterRef() ? (
            <>
              {event.ref && <span className="feed-ref mono">{event.ref}</span>}
              <span className="feed-verb">{eventVerb(event.type)}</span>
            </>
          ) : (
            <>
              <span className="feed-verb">{eventVerb(event.type)}</span>
              {event.ref && <span className="feed-ref mono">{event.ref}</span>}
            </>
          )}
        </span>
        {event.summary && (
          <span className="feed-summary">{eventSummary(event.summary)}</span>
        )}
      </span>
      <time className="feed-time tabular" dateTime={event.ts} title={formatDateTimeUtc(event.ts)}>
        {formatRelative(event.ts, new Date(now))}
      </time>
    </>
  );

  const cls = `feed-row tone-${tone(event.type)}`;
  return (
    <li>
      {href ? (
        <Link className={cls} to={href} {...contextMenu(() => (record ? recordMenu(record) : null))}>
          {body}
        </Link>
      ) : (
        <span className={`${cls} is-flat`}>{body}</span>
      )}
    </li>
  );
}

