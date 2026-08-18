/**
 * The project dashboard: what is true *right now*, for somebody who was not watching.
 *
 * It is read top to bottom as three answers, in the order a person asks them:
 *
 *   1. **Now** — is anything happening, is anything broken, did anything move today. Live
 *      facts only: durations that count up, ages in hours, the last twenty-four hours as a
 *      shape, and for each thing still in flight the outline of its newest note. This band
 *      ignores the time range below it, because "now" is not a range.
 *   2. **Trend** — the two burn-ups. Work started against work finished, bugs filed against
 *      bugs fixed; in both the shaded gap between the lines is the thing that matters
 *      (what is in flight, what is still open). Cumulative rather than per-day columns
 *      because these projects are small: eight bugs over three weeks drawn as columns is
 *      mostly empty air, while two lines read the same at any density.
 *   3. **Who and what** — the agents, each with the split of what they have been doing, and
 *      the event log itself cut into days with the recent ones open.
 *
 * Two rules the whole screen obeys:
 *
 *   * **Live means recent, not open.** A count of open records says nothing about whether
 *     anybody is at the keyboard; the clock does. So the LIVE flag, the dots on the rows
 *     and the words beside them all come from how long ago the last thing happened.
 *   * **Every number is somewhere you can go.** A work log, a bug, a filtered board, a
 *     record in the feed. A dashboard a reader cannot click out of is a poster.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api, failureTitle } from "../lib/api";
import { agentColumnWidth } from "../lib/columns";
import { useAsync } from "../lib/useAsync";
import { useUrlFilters } from "../lib/useUrlFilters";
import { BurnUp, HourBars, Legend, SplitBar, useNow } from "../components/charts";
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
  SEVERITY_LABEL,
} from "../lib/format";
import {
  agentRows,
  bugSeries,
  DAY,
  DAY_PREVIEW,
  eventVerb,
  freshness,
  groupByDay,
  initialOpenDays,
  last24h,
  noteOutline,
  refHref,
  severityCounts,
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
const IN_FLIGHT_ROWS = 3;
const OPEN_BUG_ROWS = 3;

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
  const { data, error, status, loading, reload } = useAsync<Snapshot>(
    () =>
      Promise.all([
        api.getProject(slug),
        api.listWorklogs(slug),
        api.listBugs(slug),
        api.listEvents(slug),
      ]),
    [slug]
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

  /**
   * The newest note on each work log that is still open.
   *
   * `events.jsonl` carries a *summary* of an update, cut to its first clause — enough for a
   * feed line, and not enough to know that the newest note on relay's WORK-0012 reports a
   * data-loss path and two questions put to another agent. The record itself has the whole
   * note, so the strip reads it for the handful of logs that are actually open (never more
   * than the three rows it prints).
   */
  const activeIds = activeWork
    .slice(0, IN_FLIGHT_ROWS)
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
  }, [slug, activeIds]);

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
    days === null
      ? `all ${pluralize(events.length, "recorded event")}, back to ${formatDate(new Date(firstActivity).toISOString())}`
      : `the last ${days} days`;
  /** Named once, so the charts, their deltas and the sentence above them agree. */
  const scopeLabel = days === null ? null : `the last ${days} days`;
  const changeNote = scopeLabel ? `, with the change over ${scopeLabel}` : "";
  const live = freshness(project.counts.lastActivity, now) === "live";

  return (
    <div className="page dashboard">
      <header className="page-head">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-sub">{project.description}</p>
        </div>
        {/* Live is a statement about the clock, not about how many records are open: a
            project with two open work logs nobody has touched since yesterday is not live,
            and saying so beside "Last activity 19h ago" was the flag contradicting the
            sentence next to it (round 1 critic). */}
        <div className="page-head-meta tabular">
          {live ? (
            <span className="live-flag" title="Something was recorded in the last two hours">
              <span className="live-dot" aria-hidden="true" />
              live
            </span>
          ) : null}
          Last activity {formatRelative(project.counts.lastActivity, new Date(now))}
        </div>
      </header>

      <section className="now-strip" aria-label="Current state">
        <InFlight
          slug={slug}
          active={activeWork}
          lastDone={lastDone}
          notes={notes ?? NO_NOTES}
          now={now}
        />
        <OpenBugs slug={slug} open={openBugs} total={bugs.length} now={now} />
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

      <div className="grid-2">
        <ChartCard
          title="Work"
          sub={`Started against finished, running total${changeNote}`}
          action={
            <Link className="card-action" to={`/p/${slug}/work`}>
              All work
            </Link>
          }
        >
          <BurnUp
            series={work}
            upper={{ label: "started", color: "var(--series-work)" }}
            lower={{
              label: anyAbandoned ? "finished or abandoned" : "finished",
              color: "var(--series-done)",
            }}
            gap={{ label: "in flight", wash: "var(--series-work-wash)" }}
            noun="work logs"
            scope={scopeLabel}
          />
        </ChartCard>

        <ChartCard
          title="Bugs"
          sub={`Filed against fixed, running total${changeNote}`}
          action={
            <Link className="card-action" to={`/p/${slug}/bugs?tab=all`}>
              Bug board
            </Link>
          }
        >
          <BurnUp
            series={bug}
            upper={{ label: "filed", color: "var(--series-bug)" }}
            lower={{
              label: anyClosedUnfixed ? "fixed or closed" : "fixed",
              color: "var(--series-fix)",
            }}
            gap={{ label: "still open", wash: "var(--series-bug-wash)" }}
            noun="bugs"
            scope={scopeLabel}
          />
        </ChartCard>
      </div>

      <AgentsCard slug={slug} rows={agents} now={now} />

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

function InFlight({
  slug,
  active,
  lastDone,
  notes,
  now,
}: {
  slug: string;
  active: WorklogSummary[];
  lastDone: WorklogSummary | undefined;
  notes: Record<string, WorkUpdate | undefined>;
  now: number;
}) {
  const agents = new Set(active.map((w) => w.agent));
  const iso = new Date(now).toISOString();
  return (
    <section className="now-panel now-panel-wide">
      <h2 className="now-label">Working right now</h2>
      <p className="now-hero">
        <span className={`now-hero-value${agents.size === 0 ? " is-quiet" : ""}`}>{agents.size}</span>
        <span className="now-hero-unit">
          {agents.size === 1 ? "agent has work open" : "agents have work open"}
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
              : "No work has been recorded here yet. Agents open a log with `agentmon work start` before they touch code."}
          </p>
        </>
      ) : (
        <ul className="now-list">
          {active.slice(0, IN_FLIGHT_ROWS).map((w) => (
            <InFlightRow key={w.id} slug={slug} work={w} note={notes[w.id]} now={now} iso={iso} />
          ))}
          {active.length > IN_FLIGHT_ROWS && (
            <li>
              <Link className="now-more" to={`/p/${slug}/work?status=in_progress`}>
                {active.length - IN_FLIGHT_ROWS} more in progress
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function InFlightRow({
  slug,
  work,
  note,
  now,
  iso,
}: {
  slug: string;
  work: WorklogSummary;
  note: WorkUpdate | undefined;
  now: number;
  iso: string;
}) {
  const state = freshness(work.lastActivity, now);
  const outline = noteOutline(note?.body, 3);
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

  return (
    <li>
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
          <span
            className={`now-row-dur is-${state} tabular`}
            title={`Started ${formatDateTimeUtc(work.started)}`}
          >
            <span className="now-row-durlabel">open for</span> {formatDuration(work.started, iso)}
          </span>
          <span className="now-row-since tabular" title={formatDateTimeUtc(work.lastActivity)}>
            {since}
          </span>
        </span>
        {outline.lines.length > 0 && note && (
          <span className="now-quote">
            {outline.lines.map((line, i) => (
              /* Each line carries its own sentence in the tooltip, so a sentence too long
                 for the column is still readable without leaving the page — and the record
                 itself, one click away, still has the note in full. */
              <span className="now-quote-line" key={i} title={line}>
                {i === 0 && (
                  <span
                    className="now-quote-lead"
                    title={`The opening sentence of each paragraph of the note posted ${formatDateTimeUtc(note.ts)}`}
                  >
                    Latest note
                  </span>
                )}
                {i === outline.lines.length - 1 && outline.skipped > 0 ? `… ${line}` : line}
              </span>
            ))}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Open bugs: the counts, and then the bugs themselves.
 *
 * Counting by severity says two are open and one of them is high; it does not say *which*,
 * or whether anybody has it. The one bug this panel used to name was the oldest — which in
 * relay is the medium one an agent had already claimed and planned a fix for, while the
 * high-severity GA blocker nobody had touched went unnamed (round 1 critic). So the panel
 * lists them in the order somebody triaging would take them, and prints ownership as a
 * state rather than leaving it to be inferred from an event that is missing.
 */
function OpenBugs({
  slug,
  open,
  total,
  now,
}: {
  slug: string;
  open: BugSummary[];
  total: number;
  now: number;
}) {
  const counts = severityCounts(open);
  const shown = open.slice(0, OPEN_BUG_ROWS);
  const iso = new Date(now).toISOString();
  return (
    <section className="now-panel">
      <h2 className="now-label">
        <Link className="now-label-link" to={`/p/${slug}/bugs`}>
          Open bugs
        </Link>
      </h2>
      <p className="now-figure">
        <span className={`now-figure-value${open.length === 0 ? " is-quiet" : ""}`}>{open.length}</span>
        <span className="now-figure-unit">still open of {total} filed</span>
      </p>

      <ul className="now-sev">
        {counts.map(({ severity, count }) => (
          <li key={severity}>
            <Link
              className={`sev-chip sev-chip-${severity}${count === 0 ? " is-zero" : ""}`}
              to={`/p/${slug}/bugs?severity=${severity}`}
              title={`${count} open ${SEVERITY_LABEL[severity].toLowerCase()}`}
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
                  <span className="now-row-title" title={b.title}>
                    {b.title}
                  </span>
                  <span className="now-row-sub">
                    <SeverityBadge severity={b.severity} />
                    <span className="now-row-id mono">{b.id}</span>
                    {b.assignee ? (
                      <AgentChip name={b.assignee} />
                    ) : (
                      <span className="now-flag" title="No agent has claimed this bug">
                        unclaimed
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
          {open.length > shown.length && (
            <li>
              <Link className="now-more" to={`/p/${slug}/bugs`}>
                {open.length - shown.length} more open
              </Link>
            </li>
          )}
        </ul>
      )}

      <p className="now-note">
        {open.length > 0 ? (
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

function LastDay({
  recent,
  events,
  now,
}: {
  recent: ReturnType<typeof last24h>;
  events: VaultEvent[];
  now: number;
}) {
  const parts = [
    recent.workStarted && `${recent.workStarted} started`,
    recent.workDone && `${recent.workDone} finished`,
    recent.bugsFiled && `${recent.bugsFiled} filed`,
    recent.bugsResolved && `${recent.bugsResolved} fixed`,
  ].filter(Boolean) as string[];

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
  now,
}: {
  slug: string;
  rows: ReturnType<typeof agentRows>;
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

  return (
    <section className="card">
      <header className="card-head">
        <h2 className="card-title">Agents</h2>
        <Legend
          items={[
            { color: "var(--series-work)", label: "work" },
            { color: "var(--series-bug)", label: "bugs" },
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
              <span className="agent-cell-num" title="Work logs finished">
                Done
              </span>
              <span className="agent-cell-num" title="Bugs filed">
                Filed
              </span>
              <span className="agent-cell-num" title="Bugs resolved">
                Fixed
              </span>
              <span className="agent-cell-seen">Last seen</span>
            </div>
            <ul className="agent-rows">
              {rows.map((r) => {
                /* The dot means "has work open"; how bright it is means "and was here
                   recently". An agent holding an open log who has not been seen since
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
                            title={`${pluralize(r.activeNow, "work log")} open · last seen ${formatRelative(r.lastActivity, new Date(now))}`}
                          />
                        ) : (
                          <span className="sdot sdot-idle" aria-hidden="true" />
                        )}
                        <AgentChip name={r.agent} />
                      </span>
                      <span className="agent-cell-bar">
                        <SplitBar
                          max={max}
                          total={r.total}
                          title={`${r.total} events — ${r.work} on work, ${r.bugs} on bugs`}
                          parts={[
                            { value: r.work, color: "var(--series-work)", label: "work" },
                            { value: r.bugs, color: "var(--series-bug)", label: "bugs" },
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
        {event.summary && <span className="feed-summary">{event.summary}</span>}
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

/**
 * One glyph per kind of event, in the tone the rest of the app already uses for that kind:
 * blue for work in flight, green for finished, orange for a bug, purple for a fix. The
 * icon is never the only thing carrying the meaning — the verb beside it says it in words.
 */
function EventIcon({ type }: { type: string }) {
  const t: EventTone = tone(type);
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let path: ReactNode;
  if (type === "work_started") path = <path d="M5 3.5 L11 7 L5 10.5 Z" {...stroke} />;
  else if (type === "work_updated") path = <path d="M3.5 4.5 H10.5 M3.5 7 H10.5 M3.5 9.5 H7.5" {...stroke} />;
  else if (type === "work_done" || type === "bug_resolved")
    path = <path d="M3.5 7.2 L6 9.7 L10.5 4.3" {...stroke} strokeWidth={1.8} />;
  else if (type === "work_abandoned") path = <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" {...stroke} />;
  else if (type === "bug_created")
    path = (
      <path
        d="M7 3.4a1.9 1.9 0 0 1 1.9 1.9v2.6A1.9 1.9 0 0 1 7 9.8a1.9 1.9 0 0 1-1.9-1.9V5.3A1.9 1.9 0 0 1 7 3.4Z M2.6 5.6h2.5 M8.9 5.6h2.5 M2.6 8.2h2.5 M8.9 8.2h2.5"
        {...stroke}
        strokeWidth={1.3}
      />
    );
  else if (type === "bug_claimed") path = <path d="M4 10.5V3.5h6l-1.6 2 1.6 2H4" {...stroke} />;
  else if (type === "bug_commented")
    path = <path d="M2.6 3.6h8.8v5.2H6.2l-2.4 2V8.8H2.6z" {...stroke} strokeWidth={1.3} />;
  else if (type === "bug_closed") path = <path d="M7 2.8v8.4 M3.6 4.4l6.8 5.2" {...stroke} />;
  else path = <path d="M2.6 4.4h3.4l1 1.4h4.4v5.2H2.6z" {...stroke} strokeWidth={1.3} />;

  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className={`event-icon tone-${t}`}>
      {path}
    </svg>
  );
}
