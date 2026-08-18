/**
 * Everything the dashboard shows, derived from the four things the vault can hand over:
 * the project, its worklogs, its bugs and its event log. Pure functions, no React — the
 * page is then only layout, and the arithmetic behind every number on screen is in one
 * file a reader can check.
 *
 * Two rules the rest of the file obeys:
 *
 *   * **UTC, like the records.** Every timestamp in the vault is UTC ISO8601 and the app
 *     prints UTC everywhere else (lib/format), so buckets and day groups are cut on UTC
 *     boundaries. A dashboard that silently re-cut the day in the reader's timezone would
 *     disagree with the dates printed two rows below it.
 *   * **No number without its records.** Every bucket and every group keeps the ids that
 *     went into it, so a tooltip can say *which* three work logs finished on the 12th
 *     rather than only that three did.
 */
import type {
  BugSummary,
  EventType,
  Severity,
  VaultEvent,
  WorklogSummary,
} from "./types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/* --------------------------------------------------------------------------
   Time buckets

   The two projects in this vault are different shapes — relay is three weeks of
   five agents, this app's own history is one working day of six — so the axis
   picks its own bucket instead of hard-coding a daily grid that would draw a
   day-old project as a single bar. Smallest step that keeps the chart under
   MAX columns wins; if that still leaves too few, the window is extended
   backwards so a chart is never three marks wide.
   ----------------------------------------------------------------------- */

const STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
const MAX_BUCKETS = 26;
const MIN_BUCKETS = 10;

export interface Bucket {
  /** Inclusive start, exclusive end, in epoch ms. */
  start: number;
  end: number;
}

export interface TimeAxis {
  buckets: Bucket[];
  /** Bucket width in ms. */
  step: number;
  /** Whether a label should name a clock time or a date. */
  granularity: "hour" | "day";
  from: number;
  to: number;
}

const floorTo = (t: number, step: number) => Math.floor(t / step) * step;

/** Buckets covering `[from, to]`, sized so the chart stays readable at any span. */
export function timeAxis(from: number, to: number): TimeAxis {
  const span = Math.max(to - from, 1);
  const step = STEPS.find((s) => Math.ceil(span / s) <= MAX_BUCKETS) ?? STEPS[STEPS.length - 1];
  let start = floorTo(from, step);
  const last = floorTo(to, step);
  let count = Math.round((last - start) / step) + 1;
  if (count < MIN_BUCKETS) {
    start = last - (MIN_BUCKETS - 1) * step;
    count = MIN_BUCKETS;
  }
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    start: start + i * step,
    end: start + (i + 1) * step,
  }));
  return {
    buckets,
    step,
    granularity: step < DAY ? "hour" : "day",
    from: buckets[0].start,
    to: buckets[buckets.length - 1].end,
  };
}

const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const DAY_FULL_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** "14:00" for hour buckets, "12 Aug" for day buckets. */
export const axisLabel = (t: number, granularity: "hour" | "day"): string =>
  granularity === "hour" ? HOUR_FMT.format(t) : DAY_FMT.format(t);

/** What a bucket covers, spelled out for a tooltip: "12 Aug, 14:00 – 15:00". */
export function bucketLabel(bucket: Bucket, axis: TimeAxis): string {
  if (axis.granularity === "day") {
    return axis.step === DAY
      ? DAY_FULL_FMT.format(bucket.start)
      : `${DAY_FMT.format(bucket.start)} – ${DAY_FMT.format(bucket.end - 1)}`;
  }
  return `${DAY_FMT.format(bucket.start)}, ${HOUR_FMT.format(bucket.start)} – ${HOUR_FMT.format(bucket.end)}`;
}

/* --------------------------------------------------------------------------
   Cumulative series (the two burn-ups)

   Sparse counts drawn as columns are a bad chart on a small project: eight bugs
   over three weeks is twenty-two columns of which fourteen are empty and the
   rest are one unit tall. Cumulative lines read the same at any density — the
   slope is the rate, and the gap between the two lines is the quantity the
   reader came for (work still in flight, bugs still open).
   ----------------------------------------------------------------------- */

export interface CumulativePoint {
  bucket: Bucket;
  /** Running total at the end of this bucket. */
  upper: number;
  lower: number;
  /** What arrived in this bucket alone, with the records that did it. */
  addedUpper: string[];
  addedLower: string[];
}

export interface CumulativeSeries {
  axis: TimeAxis;
  points: CumulativePoint[];
  /** Totals at the right edge. */
  totalUpper: number;
  totalLower: number;
  /** Running totals from before the window opened, so a range never lies about the level. */
  baseUpper: number;
  baseLower: number;
  max: number;
}

interface Stamped {
  id: string;
  upper: number | null;
  lower: number | null;
}

function cumulative(items: Stamped[], axis: TimeAxis): CumulativeSeries {
  const before = (pick: (i: Stamped) => number | null) =>
    items.filter((i) => {
      const t = pick(i);
      return t !== null && t < axis.from;
    }).length;
  const baseUpper = before((i) => i.upper);
  const baseLower = before((i) => i.lower);

  let upper = baseUpper;
  let lower = baseLower;
  const points = axis.buckets.map((bucket) => {
    const inBucket = (pick: (i: Stamped) => number | null) =>
      items
        .filter((i) => {
          const t = pick(i);
          return t !== null && t >= bucket.start && t < bucket.end;
        })
        .map((i) => i.id);
    const addedUpper = inBucket((i) => i.upper);
    const addedLower = inBucket((i) => i.lower);
    upper += addedUpper.length;
    lower += addedLower.length;
    return { bucket, upper, lower, addedUpper, addedLower };
  });

  return {
    axis,
    points,
    totalUpper: upper,
    totalLower: lower,
    baseUpper,
    baseLower,
    max: Math.max(1, upper),
  };
}

/** Work started vs work finished, cumulative. The gap is what is in flight. */
export const workSeries = (works: WorklogSummary[], axis: TimeAxis): CumulativeSeries =>
  cumulative(
    works.map((w) => ({ id: w.id, upper: ms(w.started), lower: ms(w.finished) })),
    axis
  );

/** Bugs filed vs bugs fixed, cumulative. The gap is the open backlog. */
export const bugSeries = (bugs: BugSummary[], axis: TimeAxis): CumulativeSeries =>
  cumulative(
    bugs.map((b) => ({
      id: b.id,
      upper: ms(b.created),
      // A bug closed without a fix still leaves the backlog; it just leaves it unrecorded.
      lower: ms(b.resolved) ?? (b.status === "closed" ? ms(b.lastActivity) : null),
    })),
    axis
  );

/* --------------------------------------------------------------------------
   Per-agent activity
   ----------------------------------------------------------------------- */

export interface AgentRow {
  agent: string;
  /** Work events (started / updated / finished / abandoned) recorded by this agent. */
  work: number;
  /** Bug events (filed / claimed / commented / resolved / closed) recorded by this agent. */
  bugs: number;
  total: number;
  /**
   * The counts the row also prints as text, so the bar is never the only place a number
   * lives. All four are counted from the same events the bar is drawn from, so the row
   * cannot disagree with itself — and all four move with the time range.
   */
  done: number;
  filed: number;
  fixed: number;
  /** Unfinished work logs this agent is holding *now*: a live fact, never scoped. */
  activeNow: number;
  /** Whether the work list has anything to show for this agent, so a row links somewhere. */
  hasWorklogs: boolean;
  lastActivity: string | null;
}

/**
 * One row per agent who did something in the window. Everything countable comes from the
 * event log — the same lines the feed below is drawn from — so the bar, the numbers and
 * the timeline are three views of one set of facts rather than three tallies that can
 * drift apart.
 */
export function agentRows(events: VaultEvent[], works: WorklogSummary[]): AgentRow[] {
  const rows = new Map<string, AgentRow>();
  const row = (agent: string): AgentRow => {
    let r = rows.get(agent);
    if (!r) {
      r = {
        agent,
        work: 0,
        bugs: 0,
        total: 0,
        done: 0,
        filed: 0,
        fixed: 0,
        activeNow: 0,
        hasWorklogs: false,
        lastActivity: null,
      };
      rows.set(agent, r);
    }
    return r;
  };

  for (const e of events) {
    if (!e.actor || e.type.startsWith("project_")) continue;
    const r = row(e.actor);
    if (e.type.startsWith("bug_")) r.bugs += 1;
    else r.work += 1;
    r.total += 1;
    if (e.type === "work_done") r.done += 1;
    if (e.type === "bug_created") r.filed += 1;
    if (e.type === "bug_resolved") r.fixed += 1;
    if (!r.lastActivity || e.ts > r.lastActivity) r.lastActivity = e.ts;
  }

  for (const w of works) {
    // Not `row()`: an agent whose only work log predates the window keeps their row out
    // of the table, but if that log is still open they are working right now and the
    // strip above has already said so.
    const r = rows.get(w.agent);
    if (!r) continue;
    r.hasWorklogs = true;
    if (w.status === "in_progress") r.activeNow += 1;
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.activeNow - a.activeNow ||
      b.total - a.total ||
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") ||
      a.agent.localeCompare(b.agent)
  );
}

/* --------------------------------------------------------------------------
   The activity feed, cut into days
   ----------------------------------------------------------------------- */

export type EventTone = "work" | "done" | "bug" | "resolved" | "neutral";

export interface DayGroup {
  /** UTC midnight of the day, epoch ms — also the group's key. */
  day: number;
  /** "Today" / "Yesterday" / "Tue 12 Aug". */
  label: string;
  /** "18 Aug 2026", for the reader who wants the date rather than the distance. */
  date: string;
  events: VaultEvent[];
  /** How the day breaks down, for the collapsed summary. */
  mix: { tone: EventTone; count: number }[];
  actors: string[];
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const startOfUtcDay = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

export function tone(type: string): EventTone {
  if (type === "work_done") return "done";
  if (type.startsWith("work_")) return "work";
  if (type === "bug_resolved" || type === "bug_closed") return "resolved";
  if (type.startsWith("bug_")) return "bug";
  return "neutral";
}

const TONE_ORDER: EventTone[] = ["work", "done", "bug", "resolved", "neutral"];

/** Newest day first, events newest first inside each day. */
export function groupByDay(events: VaultEvent[], now: number): DayGroup[] {
  const today = startOfUtcDay(now);
  const byDay = new Map<number, VaultEvent[]>();
  for (const e of events) {
    const t = ms(e.ts);
    if (t === null) continue;
    const day = startOfUtcDay(t);
    const list = byDay.get(day);
    if (list) list.push(e);
    else byDay.set(day, [e]);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => {
      const counts = new Map<EventTone, number>();
      const actors: string[] = [];
      for (const e of list) {
        const t = tone(e.type);
        counts.set(t, (counts.get(t) ?? 0) + 1);
        if (e.actor && !actors.includes(e.actor)) actors.push(e.actor);
      }
      const days = Math.round((today - day) / DAY);
      return {
        day,
        label: days === 0 ? "Today" : days === 1 ? "Yesterday" : DAY_FULL_FMT.format(day),
        date: DATE_FMT.format(day),
        events: list.slice().sort((a, b) => b.ts.localeCompare(a.ts)),
        mix: TONE_ORDER.filter((t) => counts.has(t)).map((t) => ({
          tone: t,
          count: counts.get(t) as number,
        })),
        actors,
      };
    });
}

/**
 * Which day groups open on arrival. Today, always — it is the reason somebody opened
 * this screen. Then, only while today is too thin to be worth the trip, the day before
 * it, so the feed never greets a reader with one line and a stack of closed drawers.
 */
export function initialOpenDays(groups: DayGroup[], want = 6): number[] {
  const open: number[] = [];
  let shown = 0;
  for (const g of groups) {
    open.push(g.day);
    shown += g.events.length;
    if (shown >= want || open.length >= 2) break;
  }
  return open;
}

/* --------------------------------------------------------------------------
   The NOW strip
   ----------------------------------------------------------------------- */

export interface RecentWindow {
  /** One count per hour over the last 24, oldest first — the strip's sparkline. */
  hours: { start: number; count: number }[];
  total: number;
  workStarted: number;
  workDone: number;
  bugsFiled: number;
  bugsResolved: number;
  actors: string[];
}

export function last24h(events: VaultEvent[], now: number): RecentWindow {
  const from = floorTo(now, HOUR) - 23 * HOUR;
  const hours = Array.from({ length: 24 }, (_, i) => ({ start: from + i * HOUR, count: 0 }));
  const window: RecentWindow = {
    hours,
    total: 0,
    workStarted: 0,
    workDone: 0,
    bugsFiled: 0,
    bugsResolved: 0,
    actors: [],
  };
  for (const e of events) {
    const t = ms(e.ts);
    if (t === null || t < from || t > now + HOUR) continue;
    const i = Math.min(23, Math.max(0, Math.floor((t - from) / HOUR)));
    hours[i].count += 1;
    window.total += 1;
    if (e.type === "work_started") window.workStarted += 1;
    if (e.type === "work_done") window.workDone += 1;
    if (e.type === "bug_created") window.bugsFiled += 1;
    if (e.type === "bug_resolved") window.bugsResolved += 1;
    if (e.actor && !window.actors.includes(e.actor)) window.actors.push(e.actor);
  }
  return window;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** Open bugs by severity, in triage order, including the empty ones. */
export function severityCounts(openBugs: BugSummary[]): { severity: Severity; count: number }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    count: openBugs.filter((b) => b.severity === severity).length,
  }));
}

/** Which record a feed entry points at, if any. */
export function refHref(slug: string, ref: string | null): string | null {
  if (!ref) return null;
  if (/^WORK-\d+$/.test(ref)) return `/p/${slug}/work/${ref}`;
  if (/^BUG-\d+$/.test(ref)) return `/p/${slug}/bugs/${ref}`;
  return null;
}

/** The verbs the feed prints. Kept here so the icon set and the wording stay in step. */
export const EVENT_VERB: Record<EventType, string> = {
  work_started: "started",
  work_updated: "posted an update on",
  work_done: "finished",
  work_abandoned: "abandoned",
  bug_created: "filed",
  bug_claimed: "claimed",
  bug_commented: "commented on",
  bug_resolved: "resolved",
  bug_closed: "closed",
  project_created: "created this project",
  project_updated: "updated the project",
};

export const eventVerb = (type: string): string =>
  EVENT_VERB[type as EventType] ?? type.replace(/_/g, " ");
