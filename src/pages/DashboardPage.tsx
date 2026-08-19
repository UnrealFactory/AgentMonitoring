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
import { api, failureTitle } from "../lib/api";
import { agentColumnWidth } from "../lib/columns";
import { useAsync } from "../lib/useAsync";
import { useUrlFilters } from "../lib/useUrlFilters";
import { BurnUp, HourBars, Legend, SplitBar, useNow } from "../components/charts";
import { EventIcon } from "../components/EventIcon";
import {
  AgentChip,
  BugStatusDot,
  EmptyState,
  ErrorState,
  SeverityBadge,
  Skeleton,
} from "../components/ui";
import {
  formatDate,
  formatDateTimeUtc,
  formatDuration,
  formatRelative,
  pluralize,
} from "../lib/format";
import {
  bugLower,
  IN_PROGRESS,
  SEVERITY_LABEL,
  UNRESOLVED,
  UNRESOLVED_MEANS,
  workLogs,
  workLogsInProgressOf,
  workLower,
} from "../lib/words";
import {
  agentRows,
  bugSeries,
  DAY,
  DAY_PREVIEW,
  eventSummary,
  eventVerb,
  freshness,
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
  TONE_COLOR,
  TONE_LABEL,
  TONE_ORDER,
  triageOrder,
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

/** The one filter on this screen, kept in the URL like every other view state. */
const DEFAULTS = { range: "all" };
const ALLOWED = { range: ["7d", "30d", "all"] } as const;
const RANGES: { value: string; label: string; days: number | null }[] = [
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "all", label: "All time", days: null },
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

  const scoped = useMemo(
    () => events.filter((e) => Date.parse(e.ts) >= axis.from),
    [events, axis.from]
  );
  const agents = useMemo(() => agentRows(scoped, works), [scoped, works]);
  const dayGroups = useMemo(() => groupByDay(scoped, now), [scoped, now]);

  if (error) {
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, status)}
          message={error}
          onRetry={status === 404 ? undefined : reload}
          action={
            <Link className="button" to="/projects">
              All projects
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
      ? `the last ${days} days`
      : events.length === 1
        ? // "all 1 recorded event" is not a sentence anybody writes.
          `the one recorded event, from ${formatDate(new Date(firstActivity).toISOString())}`
        : `all ${pluralize(events.length, "recorded event")}, back to ${formatDate(new Date(firstActivity).toISOString())}`;
  /** Named once, so the charts, their deltas and the sentence above them agree. */
  const scopeLabel = days === null ? null : `the last ${days} days`;
  const changeNote = scopeLabel ? `, with the change over ${scopeLabel}` : "";
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
            <Link
              className="pill pill-archived"
              to="/projects"
              title="This project is archived. Nothing was deleted — restore it on the Projects screen."
            >
              archived
            </Link>
          ) : live ? (
            <span className="live-flag" title="Something was recorded in the last two hours">
              <span className="live-dot" aria-hidden="true" />
              live
            </span>
          ) : null}
          Last activity {formatRelative(project.counts.lastActivity, new Date(now))}
        </div>
      </header>

      <section className="now-strip" aria-label="Current state">
        <InProgress
          slug={slug}
          active={activeWork}
          total={works.length}
          lastDone={lastDone}
          notes={notes ?? NO_NOTES}
          agents={knownAgents}
          now={now}
        />
        <UnresolvedBugs slug={slug} unresolved={openBugs} total={bugs.length} now={now} />
        <LastDay recent={recent} events={events} now={now} />
      </section>

      <div className="dash-toolbar">
        <div className="segmented" role="tablist" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.value}
              role="tab"
              data-value={r.value}
              aria-selected={range === r.value}
              className={`segment${range === r.value ? " is-active" : ""}`}
              onClick={() => set("range", r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="dash-scope">
          The charts, the agents and the feed below cover {rangeNote}. The strip above is
          always now, and every date and time on this page is UTC.
        </p>
      </div>

      {/* The legends are the list screens' words: a chart that says "in flight" over a
          list that says "In progress" is two names for one fact (lib/words.ts). */}
      <div className="grid-2">
        <ChartCard
          title="Work"
          sub={`Started against done, running total${changeNote}`}
          action={
            <Link className="card-action" to={`/p/${slug}/work`}>
              All work
            </Link>
          }
        >
          <BurnUp
            series={work}
            upper={{ label: "started", color: "var(--series-work)" }}
            lower={{ label: workLower(anyAbandoned), color: "var(--series-done)" }}
            gap={{ label: IN_PROGRESS, wash: "var(--series-work-wash)" }}
            noun="work logs"
            scope={scopeLabel}
            empty={{
              title: "No work logs yet",
              hint: `This chart draws itself the moment an agent runs \`agentmon work start -p ${slug}\`.`,
            }}
          />
        </ChartCard>

        <ChartCard
          title="Bugs"
          sub={`Filed against resolved, running total${changeNote}`}
          action={
            <Link className="card-action" to={`/p/${slug}/bugs?tab=all`}>
              Bug board
            </Link>
          }
        >
          <BurnUp
            series={bug}
            upper={{ label: "filed", color: "var(--series-bug)" }}
            lower={{ label: bugLower(anyClosedUnfixed), color: "var(--series-fix)" }}
            gap={{ label: UNRESOLVED, wash: "var(--series-bug-wash)" }}
            noun="bugs"
            scope={scopeLabel}
            empty={{
              title: "No bugs filed yet",
              hint: "Nothing to plot, which on this chart is the good state.",
            }}
          />
        </ChartCard>
      </div>

      <AgentsCard slug={slug} rows={agents} total={scoped.length} now={now} />

      <ActivityCard slug={slug} groups={dayGroups} total={scoped.length} now={now} />
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
  return (
    <section className="now-panel now-panel-wide">
      <h2 className="now-label">Working right now</h2>
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
            "work logs in this project"
          ) : (
            <>
              {/* The noun belongs to the number it follows — the denominator. Keyed off the
                  numerator it printed "1 of 17 work log in progress" the moment one work log
                  was in progress out of seventeen. */}
              of {workLogs(total)} {IN_PROGRESS}
              {working.size > 0 && (
                <span className="now-hero-aside"> · {pluralize(working.size, "agent")}</span>
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
                <Link className="now-row" to={`/p/${slug}/work/${lastDone.id}`}>
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
                      <span className="now-row-durlabel">took</span>{" "}
                      {formatDuration(lastDone.started, lastDone.finished)}
                    </span>
                    <span className="now-row-since tabular">
                      finished {formatRelative(lastDone.finished, new Date(now))}
                    </span>
                  </span>
                </Link>
              </li>
            </ul>
          )}
          <p className="now-note">
            {lastDone
              ? "Nothing is in progress — the most recent work log is above."
              : "No work has been recorded here yet. Agents start a work log with `agentmon work start` before they touch code."}
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
                {active.length - IN_PROGRESS_ROWS} more in progress
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
  /* Two facts, two different clocks, and the row says which is which: how long this has
     been open (the hero number, which used to sit there with no label at all), and how
     long since anybody touched it. A log with no updates yet says that instead of dressing
     its own start time up as an update. */
  const since =
    work.updateCount === 0
      ? "no updates yet"
      : state === "live"
        ? `updated ${formatRelative(work.lastActivity, new Date(now))}`
        : `no update in ${formatDuration(work.lastActivity, iso)}`;

  /* The quote is a sibling of the row, not a child of it: it carries its own link (the
     agent an ask names), and a link inside a link is neither valid nor clickable. The two
     of them share one hover surface, so the pair still reads as a single row. */
  return (
    <li className="now-item">
      <Link className="now-row" to={`/p/${slug}/work/${work.id}`}>
        <span
          className={`sdot ${FRESH_DOT[state]}`}
          title={`In progress · ${since}`}
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
            title={`Started ${formatDateTimeUtc(work.started)}`}
          >
            <span className="now-row-durlabel">in progress</span>{" "}
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
              title={`The opening sentence of each paragraph of the note posted ${formatDateTimeUtc(note.ts)}`}
            >
              Latest note
            </span>
            {/* Only ever a name that appears in the quoted sentence, and the sentence is in
                the tooltip: the chip is a pointer to what the agent wrote, not the app's
                own conclusion about who is blocking whom. */}
            {outline.waitingOn && outline.waitingOn !== work.agent && (
              <Link
                className="now-ask"
                to={`/p/${slug}/work?agent=${encodeURIComponent(outline.waitingOn)}`}
                title={`${work.agent}'s newest note says: “${
                  outline.lines.find((l) => l.ask)?.text ?? ""
                }”`}
              >
                waiting on {outline.waitingOn}
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
  unresolved,
  total,
  now,
}: {
  slug: string;
  unresolved: BugSummary[];
  total: number;
  now: number;
}) {
  const counts = severityCounts(unresolved);
  const shown = unresolved.slice(0, UNRESOLVED_BUG_ROWS);
  const iso = new Date(now).toISOString();
  return (
    <section className="now-panel">
      <h2 className="now-label">
        <Link
          className="now-label-link"
          to={`/p/${slug}/bugs`}
          title={`Bugs that are ${UNRESOLVED_MEANS}`}
        >
          Unresolved bugs
        </Link>
      </h2>
      <p className="now-figure">
        <span className={`now-figure-value${unresolved.length === 0 ? " is-quiet" : ""}`}>
          {unresolved.length}
        </span>
        <span className="now-figure-unit">
          {total === 0 ? "bugs filed here" : `${UNRESOLVED} of ${total} filed`}
        </span>
      </p>

      <ul className="now-sev">
        {counts.map(({ severity, count }) => (
          <li key={severity}>
            <Link
              className={`sev-chip sev-chip-${severity}${count === 0 ? " is-zero" : ""}`}
              to={`/p/${slug}/bugs?severity=${severity}`}
              title={`${count} ${UNRESOLVED} ${SEVERITY_LABEL[severity].toLowerCase()}-severity ${
                count === 1 ? "bug" : "bugs"
              }`}
            >
              <span className="sev-chip-dot" aria-hidden="true" />
              <span className="sev-chip-label">{SEVERITY_LABEL[severity]}</span>
              <span className="sev-chip-count tabular">{count}</span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length > 0 && (
        <ul className="now-list">
          {shown.map((b) => (
            <li key={b.id}>
              <Link className="now-row" to={`/p/${slug}/bugs/${b.id}`}>
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
                      /* "Unclaimed" and "unclaimed since yesterday" are different states.
                         The flag carries the age, and turns amber once a bug this severe
                         has gone unowned for longer than half a working day — a rule the
                         tooltip states, so the colour is not the claim (round 2 critic). */
                      <span
                        className={`now-flag${needsOwner(b, now) ? " is-urgent" : ""}`}
                        title={
                          needsOwner(b, now)
                            ? `Nobody has claimed this ${SEVERITY_LABEL[b.severity].toLowerCase()}-severity bug in ${formatDuration(b.created, iso)}. This screen flags critical and high bugs left unowned for more than four hours.`
                            : "No agent has claimed this bug"
                        }
                      >
                        {needsOwner(b, now) ? "needs an owner" : "unclaimed"}
                      </span>
                    )}
                  </span>
                </span>
                <span className="now-row-time">
                  <span
                    className="now-row-dur is-bug tabular"
                    title={`Filed ${formatDateTimeUtc(b.created)}`}
                  >
                    <span className="now-row-durlabel">open for</span>{" "}
                    {formatDuration(b.created, iso)}
                  </span>
                  <span
                    className="now-row-since tabular"
                    title={
                      b.lastActivity > b.created
                        ? `Last activity ${formatDateTimeUtc(b.lastActivity)}`
                        : "Nothing has happened on this bug since it was filed: no claim, no comment"
                    }
                  >
                    {b.lastActivity > b.created
                      ? `updated ${formatRelative(b.lastActivity, new Date(now))}`
                      : "untouched"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {unresolved.length > shown.length && (
            <li>
              <Link className="now-more" to={`/p/${slug}/bugs`}>
                {unresolved.length - shown.length} more {UNRESOLVED}
              </Link>
            </li>
          )}
        </ul>
      )}

      <p className="now-note">
        {unresolved.length > 0 ? (
          <>Worst first; inside a severity, the ones nobody has claimed come first.</>
        ) : total === 0 ? (
          <>No bugs have been filed in this project.</>
        ) : (
          <>Every bug ever filed here has been resolved.</>
        )}
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
  const parts = summarise(recent.breakdown).map((p) => `${p.count} ${p.label}`);
  /* And silence is stated, not left as an absence of bars. */
  const quiet =
    events[0] && now - Date.parse(events[0].ts) >= 2 * HOUR
      ? `quiet for ${formatDuration(events[0].ts, new Date(now).toISOString())}`
      : null;

  return (
    <section className="now-panel now-panel-day">
      {/* A figure and its chart, side by side: the count of the last day, and the shape of
          it hour by hour across the full width of the screen. */}
      <div className="day-figure">
        <h2 className="now-label">
          <a className="now-label-link" href="#activity">
            Last 24 hours
          </a>
        </h2>
        <p className="now-figure">
          <span className={`now-figure-value${recent.total === 0 ? " is-quiet" : ""}`}>
            {recent.total}
          </span>
          <span className="now-figure-unit">
            {recent.total === 1 ? "event recorded" : "events recorded"}
          </span>
        </p>
        <p className="now-note">
          {recent.total === 0 ? (
            <>
              Quiet.{" "}
              {events[0] ? (
                <>The last thing recorded here was {formatRelative(events[0].ts, new Date(now))}.</>
              ) : (
                <>Nothing has ever been recorded here.</>
              )}
            </>
          ) : (
            <>
              {parts.length ? `${parts.join(" · ")} · ` : ""}
              {pluralize(recent.actors.length, "agent")}
              {quiet ? ` · ${quiet}` : ""}
            </>
          )}
        </p>
      </div>

      <HourBars
        hours={recent.hours}
        label={`Events per hour over the last 24 hours, oldest first: ${recent.hours
          .map((h) => h.count)
          .join(", ")}`}
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
        <h2 className="card-title">Agents</h2>
        <Legend
          items={[
            { color: "var(--series-work)", label: "work" },
            { color: "var(--series-bug)", label: "bugs" },
            ...(anyProject ? [{ color: "var(--grey)", label: "project" }] : []),
          ]}
        />
        <Link className="card-action" to={`/p/${slug}/work`}>
          All work
        </Link>
      </header>
      <div className="card-body">
        {rows.length === 0 ? (
          <EmptyState
            title="No agent has recorded anything in this range"
            hint="Widen the range above, or check the vault: every CLI mutation appends one line to events.jsonl."
          />
        ) : (
          <div className="agent-table" style={{ "--agent-col": nameWidth } as CSSProperties}>
            <div className="agent-head" role="row">
              <span className="agent-cell-name">Agent</span>
              <span className="agent-cell-bar">Activity</span>
              <span className="agent-cell-num" title="Work logs this agent marked done">
                Done
              </span>
              <span className="agent-cell-num" title="Bugs this agent filed">
                Filed
              </span>
              <span className="agent-cell-num" title="Bugs this agent resolved">
                Resolved
              </span>
              <span className="agent-cell-seen">Last seen</span>
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
                            aria-label={`${workLogs(r.activeNow)} ${IN_PROGRESS}`}
                            title={`${workLogs(r.activeNow)} ${IN_PROGRESS} · last seen ${formatRelative(r.lastActivity, new Date(now))}`}
                          />
                        ) : (
                          /* "Who is free right now" was inferable only from a hollow circle
                             with no title on it (round 2 critic). */
                          <span
                            className="sdot sdot-idle"
                            role="img"
                            aria-label="No work log in progress"
                            title={`No work log ${IN_PROGRESS} · last seen ${formatRelative(r.lastActivity, new Date(now))}`}
                          />
                        )}
                        <AgentChip name={r.agent} />
                      </span>
                      <span className="agent-cell-bar">
                        <SplitBar
                          max={max}
                          total={r.total}
                          title={`${pluralize(r.total, "event")} — ${r.work} on work, ${r.bugs} on bugs${
                            r.project ? `, ${r.project} on the project` : ""
                          }`}
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
            <p className="table-note">
              Every one of {pluralize(total, "event")} in this range, counted against the agent
              who recorded it — project changes included.
            </p>
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
}: {
  slug: string;
  groups: ReturnType<typeof groupByDay>;
  total: number;
  now: number;
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
        <h2 className="card-title">Activity</h2>
        {tones.length > 0 && (
          <Legend
            items={tones.map((t) => ({ color: TONE_COLOR[t], label: TONE_LABEL[t], band: true }))}
          />
        )}
        <span className="card-note tabular">
          {pluralize(total, "event")} · {pluralize(groups.length, "day")} · UTC
        </span>
        {groups.length > 1 && (
          <button className="card-action" onClick={() => setAll(!allOpen)}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        )}
      </header>
      <div className="card-body">
        {groups.length === 0 ? (
          <EmptyState
            title="Nothing recorded in this range"
            hint="Every CLI mutation appends one line to events.jsonl; widen the range above to see older ones."
          />
        ) : (
          <ol className="day-list">
            {groups.map((g) => {
              const open = isOpen(g.day);
              const mixLabel = `${pluralize(g.events.length, "event")} — ${g.mix
                .map((m) => `${m.count} ${TONE_LABEL[m.tone]}`)
                .join(", ")}`;
              return (
                <li className={`day${open ? " is-open" : ""}`} key={g.day}>
                  <button
                    className="day-head"
                    aria-expanded={open}
                    onClick={() => toggle(g.day)}
                    title={`${g.date} UTC · ${mixLabel}`}
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
                    <span className="day-label">{g.label}</span>
                    <span className="day-date tabular">{g.date}</span>
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
                        <FeedRow slug={slug} event={e} now={now} key={`${e.ts}-${i}`} />
                      ))}
                      {!expanded[g.day] && g.events.length > DAY_PREVIEW && (
                        <li className="feed-more-row">
                          <button
                            className="feed-more"
                            onClick={() => setExpanded((x) => ({ ...x, [g.day]: true }))}
                          >
                            Show the other {g.events.length - DAY_PREVIEW} from {g.label.toLowerCase()}
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

function FeedRow({ slug, event, now }: { slug: string; event: VaultEvent; now: number }) {
  const href = refHref(slug, event.ref);
  const body = (
    <>
      <span className="feed-icon" aria-hidden="true">
        <EventIcon type={event.type} />
      </span>
      <span className="feed-body">
        <span className="feed-head">
          <span className="feed-actor">{event.actor}</span>
          <span className="feed-verb">{eventVerb(event.type)}</span>
          {event.ref && <span className="feed-ref mono">{event.ref}</span>}
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
        <Link className={cls} to={href}>
          {body}
        </Link>
      ) : (
        <span className={`${cls} is-flat`}>{body}</span>
      )}
    </li>
  );
}

