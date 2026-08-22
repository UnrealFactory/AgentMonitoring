/**
 * Everything the dashboard shows, derived from the four things the vault can hand over:
 * the project, its worklogs, its bugs and its event log. Pure functions, no React — the
 * page is then only layout, and the arithmetic behind every number on screen is in one
 * file a reader can check.
 *
 * The words every label here uses are the app's words (lib/words.ts): work is in progress,
 * done or abandoned; a bug is open, in progress, resolved or closed.
 *
 * Two rules the rest of the file obeys:
 *
 *   * **Local time, like the rest of the app.** Every timestamp in the vault is UTC
 *     ISO8601, but the screens print the reader's timezone (lib/format), so buckets and
 *     day groups are cut on **local** boundaries too. A dashboard that cut the day at UTC
 *     midnight would file an evening's work under tomorrow's date in Seoul and disagree
 *     with the times printed two rows below it.
 *   * **No number without its records.** Every bucket and every group keeps the ids that
 *     went into it, so a tooltip can say *which* three work logs finished on the 12th
 *     rather than only that three did.
 */
import { getLocale, t } from "./i18n";
import type { BugSummary, EventType, Severity, VaultEvent, WorklogSummary } from "./types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/* --------------------------------------------------------------------------
   Freshness

   "Something is open" and "something is happening" are two different facts, and a
   dashboard that spells the first one as the second lies to a reader who arrives
   after everybody went home. A green LIVE flag over an event log whose newest line
   is ten hours old is that lie (round 1 critic), so liveness is measured from the
   clock, never from a count of open records — and an open record nobody has touched
   since yesterday is drawn as what it is.
   ----------------------------------------------------------------------- */

/** How recent the newest thing has to be for the project to read as live. */
export const LIVE_WITHIN = 2 * HOUR;
/** After this much silence a record in progress stops looking like it to the eye. */
export const STALE_AFTER = DAY;

export type Freshness = "live" | "quiet" | "stale";

export function freshness(iso: string | null | undefined, now: number): Freshness {
  const t = ms(iso);
  if (t === null) return "stale";
  const age = now - t;
  if (age <= LIVE_WITHIN) return "live";
  return age >= STALE_AFTER ? "stale" : "quiet";
}

/* --------------------------------------------------------------------------
   Time buckets

   The two projects in this vault are different shapes — relay spans three weeks,
   this app's own history about a day — so the axis picks its own bucket instead
   of hard-coding a daily grid that would draw a day-old project as a single bar.
   Smallest step that keeps the chart under MAX columns wins; if that still leaves
   too few, the window is extended backwards so a chart is never three marks wide.

   (This comment used to add "of five agents" and "of six", and the work log that
   shipped it said ten and six: three numbers, none of them counted, and relay's
   roster has been four — nova, patch, quill, sable — since it was generated. The
   roster never entered this calculation; only the span does. See BUG-0017.)
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
  /**
   * What one *bucket* covers — a slice of a day, or a day or more. This describes the
   * bucket only: it is what a tooltip needs to say ("18 Aug, 12:00 – 18:00" against
   * "Tue 12 Aug"), and it is deliberately **not** what the tick labels are chosen from.
   * A seven-day chart bucketed in twelve-hour steps is still a seven-day chart, and
   * labelling it "12:00 · 00:00 · 12:00" tells the reader nothing about which week they
   * are looking at (round 1 critic). Tick labels come from `axisTicks`, which reads the
   * whole span.
   */
  granularity: "hour" | "day";
  from: number;
  to: number;
}

/* Floored in the reader's wall time, not epoch time: a day bucket breaks at the reader's
   midnight — otherwise a KST reader's "day" bar runs 오전 9시 to 오전 9시 and an evening of
   work lands on the wrong date — and a six-hour bucket starts on a local 00/06/12/18 the
   ticks can land on. Shift into wall time, floor, shift back. */
const floorTo = (t: number, step: number) => {
  const offset = new Date(t).getTimezoneOffset() * 60_000;
  return Math.floor((t - offset) / step) * step + offset;
};

/** Buckets covering `[from, to]`, sized so the chart stays readable at any span. */
export function timeAxis(from: number, to: number): TimeAxis {
  const span = Math.max(to - from, 1);
  const step = STEPS.find((s) => Math.ceil(span / s) <= MAX_BUCKETS) ?? STEPS[STEPS.length - 1];
  let start = floorTo(from, step);
  const last = floorTo(to, step);
  let count = Math.round((last - start) / step) + 1;
  /** Whether the window had to be opened backwards to keep the chart from being 3 marks wide. */
  let widened = false;
  if (count < MIN_BUCKETS) {
    start = last - (MIN_BUCKETS - 1) * step;
    count = MIN_BUCKETS;
    widened = true;
  }
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    start: start + i * step,
    end: start + (i + 1) * step,
  }));
  /**
   * The first bucket is clipped back to the window the reader asked for.
   *
   * Buckets are floored to their own step so that ticks land on clock boundaries, and that
   * floor reaches *back* — up to a whole step before "seven days ago". Everything scoped by
   * this axis (both burn-ups, the agent table, the feed) counts from `from`, so an
   * unclipped first bucket quietly pulls in records from before the range: at 7 days relay
   * gained a work log finished ten hours before the window opened, and the legend's "+4
   * finished" disagreed with the vault's 3. The bucket is a little short; the number is
   * exact, and the number is what gets read. (Not when the window was widened above — there
   * the extra room *is* the point, and clipping it back would invert the bucket.)
   */
  if (!widened && from > buckets[0].start) buckets[0] = { start: from, end: buckets[0].end };
  return {
    buckets,
    step,
    granularity: step < DAY ? "hour" : "day",
    from: buckets[0].start,
    to: buckets[buckets.length - 1].end,
  };
}

/* Dates on a chart are read at a glance and compared with the ones two cards away, so they
   are assembled from local-time parts in both languages rather than handed to a locale
   formatter — only the timezone varies by machine, never the shape of the string. Korean
   puts the year first and the unit after each number — "8월 12일" — which is also a little
   wider than "12 Aug", and `axisTicks` is told so through `minTickPx` below. */
const pad2 = (n: number): string => String(n).padStart(2, "0");

/* "오후 2시" / "2 pm" on the round hour that chart ticks land on; minutes only when a
   half-hour timezone offset puts them there ("오후 2:30" / "2:30 pm"). */
const HOUR_FMT = { format: (ts: number) => {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return getLocale() === "ko"
    ? `${h < 12 ? "오전" : "오후"} ${h12}${m ? `:${pad2(m)}` : "시"}`
    : `${h12}${m ? `:${pad2(m)}` : ""} ${h < 12 ? "am" : "pm"}`;
} };

const KO_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

const EN_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});
const EN_DAY_FULL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const EN_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** "12 Aug" / "8월 12일" */
const DAY_FMT = {
  format: (ts: number) => {
    const d = new Date(ts);
    return getLocale() === "ko"
      ? `${d.getMonth() + 1}월 ${d.getDate()}일`
      : EN_DAY.format(d);
  },
};

/** "Tue 12 Aug" / "8월 12일 (화)" */
const DAY_FULL_FMT = {
  format: (ts: number) => {
    const d = new Date(ts);
    return getLocale() === "ko"
      ? `${d.getMonth() + 1}월 ${d.getDate()}일 (${KO_WEEKDAY[d.getDay()]})`
      : EN_DAY_FULL.format(d);
  },
};

/** "18 Aug 2026" / "2026년 8월 18일" */
const DATE_FMT = {
  format: (ts: number) => {
    const d = new Date(ts);
    return getLocale() === "ko"
      ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
      : EN_DATE.format(d);
  },
};

/** "오후 2시" for hour buckets, "12 Aug" for day buckets. */
export const axisLabel = (ts: number, granularity: "hour" | "day"): string =>
  granularity === "hour" ? HOUR_FMT.format(ts) : DAY_FMT.format(ts);

/** How much room one tick label needs. Korean dates are wider than "12 Aug". */
export const minTickPx = (): number => (getLocale() === "ko" ? 84 : 64);

/* --------------------------------------------------------------------------
   Ticks

   Two things were wrong with labelling one bucket in every N: the labels were
   clock times whenever the bucket was smaller than a day, so a week of data read
   "12:00 · 00:00 · 12:00 · 00:00" and named no date at all; and the stride was
   anchored on the *last* bucket, so a chart whose last bucket sat at 18:00 printed
   "06:00 · 00:00 · 18:00 · 12:00" — a descending sequence that reads as a broken
   axis (round 1 critic). play.grafana.org at Last 7 days prints "08/13 00:00".

   So ticks are chosen the way a clock is read, not the way an array is indexed:

     * the interval is a *natural* one (1/2/3/6/12 hours, 1/2/7/14/28 days) that is a
       whole number of buckets and leaves at least `minPx` between labels;
     * a tick lands only on a boundary of that interval, so sub-daily ticks fall on
       00:00, 06:00, 12:00 … and never on 06:00, 00:00, 18:00;
     * whenever the ticks are closer together than a day, each one that opens a new
       day carries that date under it, so the chart always says which days it
       covers. All of it in the reader's timezone, like every timestamp on screen.
   ----------------------------------------------------------------------- */

const TICK_INTERVALS = [
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  3 * DAY,
  7 * DAY,
  14 * DAY,
  28 * DAY,
];

export interface AxisTick {
  /** Which bucket the tick sits on. */
  index: number;
  /** The tick's own label: a clock time, or a date once the ticks are a day apart. */
  label: string;
  /** The day this tick opens, printed under it — null when the day has not changed. */
  date: string | null;
}

/**
 * Which buckets get a label, and what it says. `innerWidth` is the plot's width in px:
 * ticks are only useful if they fit, so the chart's real geometry picks the interval.
 */
export function axisTicks(axis: TimeAxis, innerWidth: number, minPx = minTickPx()): AxisTick[] {
  const n = axis.buckets.length;
  if (n === 0) return [];
  const perBucket = n > 1 ? innerWidth / (n - 1) : innerWidth;
  const needed = Math.max(1, Math.ceil(minPx / Math.max(perBucket, 1))) * axis.step;
  const interval =
    TICK_INTERVALS.find((t) => t >= needed && t % axis.step === 0) ??
    Math.ceil(needed / axis.step) * axis.step;
  const clock = interval < DAY;

  const ticks: AxisTick[] = [];
  let lastDate: string | null = null;
  for (let i = 0; i < n; i += 1) {
    const at = axis.buckets[i].start;
    /* Aligned in the reader's wall time, like the buckets themselves: 오전 12시 · 오전 6시
       · 오후 12시, and day ticks on local midnights — an epoch modulo would put every
       tick 9 hours off in Seoul and match no day bucket at all. */
    const wall = at - new Date(at).getTimezoneOffset() * 60_000;
    if (wall % interval !== 0) continue;
    const date = DAY_FMT.format(at);
    ticks.push({
      index: i,
      label: clock ? HOUR_FMT.format(at) : date,
      date: clock && date !== lastDate ? date : null,
    });
    lastDate = date;
  }

  // A window shorter than one natural interval (a two-hour project, say) has nothing
  // aligned in it. It still gets its ends labelled rather than an axis with no ticks.
  if (ticks.length === 0) {
    const ends = n === 1 ? [0] : [0, n - 1];
    return ends.map((i) => ({
      index: i,
      label: axisLabel(axis.buckets[i].start, axis.granularity),
      date: axis.granularity === "hour" ? DAY_FMT.format(axis.buckets[i].start) : null,
    }));
  }
  return ticks;
}

/** What a bucket covers, spelled out for a tooltip: "12 Aug, 2 pm – 3 pm". */
export function bucketLabel(bucket: Bucket, axis: TimeAxis): string {
  if (axis.granularity === "day") {
    return axis.step === DAY
      ? DAY_FULL_FMT.format(bucket.start)
      : `${DAY_FMT.format(bucket.start)} – ${DAY_FMT.format(bucket.end - 1)}`;
  }
  return t(
    "chart.bucketHours",
    DAY_FMT.format(bucket.start),
    HOUR_FMT.format(bucket.start),
    HOUR_FMT.format(bucket.end)
  );
}

/* --------------------------------------------------------------------------
   Cumulative series (the two burn-ups)

   Sparse counts drawn as columns are a bad chart on a small project: eight bugs
   over three weeks is twenty-two columns of which fourteen are empty and the
   rest are one unit tall. Cumulative lines read the same at any density — the
   slope is the rate, and the gap between the two lines is the quantity the
   reader came for (work in progress, bugs unresolved).
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

/** Work started vs work done, cumulative. The gap is what is in progress. */
export const workSeries = (works: WorklogSummary[], axis: TimeAxis): CumulativeSeries =>
  cumulative(
    works.map((w) => ({ id: w.id, upper: ms(w.started), lower: ms(w.finished) })),
    axis
  );

/** Bugs filed vs bugs resolved, cumulative. The gap is what is unresolved. */
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
  /** Note events (left / revised / removed) recorded by this agent. */
  notes: number;
  /**
   * Project events (created / updated). Counted like the rest, because the table used to
   * drop them: relay's four agents added up to 83 under an Activity card that said 85, and
   * quill's "Last seen" was an hour behind the feed two cards below it — both because the
   * two events that moved the project metadata belonged to nobody (round 2 critic).
   */
  project: number;
  total: number;
  /**
   * The counts the row also prints as text, so the bar is never the only place a number
   * lives. All four are counted from the same events the bar is drawn from, so the row
   * cannot disagree with itself — and all four move with the time range.
   */
  done: number;
  filed: number;
  fixed: number;
  /** Work logs in progress this agent is holding *now*: a live fact, never scoped. */
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
        notes: 0,
        project: 0,
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
    if (!e.actor) continue;
    const r = row(e.actor);
    if (e.type.startsWith("project_")) r.project += 1;
    else if (e.type.startsWith("bug_")) r.bugs += 1;
    else if (e.type.startsWith("note_")) r.notes += 1;
    else r.work += 1;
    r.total += 1;
    if (e.type === "work_done") r.done += 1;
    if (e.type === "bug_created") r.filed += 1;
    if (e.type === "bug_resolved") r.fixed += 1;
    if (!r.lastActivity || e.ts > r.lastActivity) r.lastActivity = e.ts;
  }

  for (const w of works) {
    // Not `row()`: an agent whose only work log predates the window keeps their row out
    // of the table, but if that work log is still in progress they are working right now and the
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

export type EventTone = "work" | "done" | "bug" | "resolved" | "note" | "neutral";

export interface DayGroup {
  /** Local midnight of the day, epoch ms — also the group's key, and all its words need. */
  day: number;
  events: VaultEvent[];
  /** How the day breaks down, for the collapsed summary. */
  mix: { tone: EventTone; count: number }[];
  actors: string[];
}

/** Midnight in the reader's timezone — the day as the reader lived it, not as UTC cut it. */
const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);

export function tone(type: string): EventTone {
  if (type === "work_done") return "done";
  if (type.startsWith("work_")) return "work";
  if (type === "bug_resolved" || type === "bug_closed") return "resolved";
  if (type.startsWith("bug_")) return "bug";
  if (type.startsWith("note_")) return "note";
  return "neutral";
}

/* Note sits between done and bug on purpose: those neighbours clear the palette
   validator, and its risky pairs (fix, the neutral grey) never touch it — see the
   --series-note comment in styles/tokens.css. */
export const TONE_ORDER: EventTone[] = ["work", "done", "note", "bug", "resolved", "neutral"];

/**
 * What each tone means in words, and the token it is drawn in. The day strip in the feed
 * is a chart like any other: five tones with no key is decoration, so the words and the
 * colours live together here and the Activity card prints a legend from them.
 */
export const toneLabel = (tone: EventTone): string =>
  tone === "work"
    ? t("tone.work")
    : tone === "done"
      ? t("tone.done")
      : tone === "bug"
        ? t("tone.bug")
        : tone === "resolved"
          ? t("tone.resolved")
          : tone === "note"
            ? t("tone.note")
            : t("tone.neutral");

export const TONE_COLOR: Record<EventTone, string> = {
  work: "var(--series-work)",
  done: "var(--series-done)",
  bug: "var(--series-bug)",
  resolved: "var(--series-fix)",
  note: "var(--series-note)",
  neutral: "var(--grey)",
};

/**
 * Newest day first, events newest first inside each day.
 *
 * Takes no clock: it used to, only to decide whether a day was called "Today" — and that
 * word is now said at render (see {@link dayLabel}), which is what keeps a language change
 * from leaving yesterday's language in the feed.
 */
export function groupByDay(events: VaultEvent[]): DayGroup[] {
  const byDay = new Map<number, VaultEvent[]>();
  for (const e of events) {
    const t = ms(e.ts);
    if (t === null) continue;
    const day = startOfDay(t);
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
        const tn = tone(e.type);
        counts.set(tn, (counts.get(tn) ?? 0) + 1);
        if (e.actor && !actors.includes(e.actor)) actors.push(e.actor);
      }
      return {
        day,
        events: list.slice().sort((a, b) => b.ts.localeCompare(a.ts)),
        mix: TONE_ORDER.filter((tn) => counts.has(tn)).map((tn) => ({
          tone: tn,
          count: counts.get(tn) as number,
        })),
        actors,
      };
    });
}

/**
 * What a day is called: "Today" / "Yesterday" / "Tue 12 Aug" — 오늘 / 어제 / 8월 12일 (화).
 *
 * A function rather than a field on {@link DayGroup}, for the reason spelled out on
 * {@link RecentWindow.breakdown}: the groups are memoized on the events and the clock, and
 * a word memoized on anything but the language is a word that survives a language change.
 * The day is the only input it needs, and the page has it at the moment it draws the row.
 */
export function dayLabel(day: number, now: number): string {
  const days = Math.round((startOfDay(now) - day) / DAY);
  return days === 0
    ? t("dash.today")
    : days === 1
      ? t("dash.yesterday")
      : DAY_FULL_FMT.format(day);
}

/** "18 Aug 2026" / "2026년 8월 18일" — the date beside it, for a reader counting back. */
export const dayDate = (day: number): string => DATE_FMT.format(day);

/**
 * How much of one day a reader is shown before being asked whether they want the rest.
 * A day this project spent entirely in the vault can hold seventy events; printing all of
 * them turns a dashboard into a log file.
 */
export const DAY_PREVIEW = 12;

/**
 * Which day groups are open on arrival.
 *
 * The old rule counted events — stop once six are showing — which meant a busy day closed
 * every drawer behind it. A manager coming back to ten hours of silence then got one open
 * day and twenty-one closed ones (round 1 critic), because the events they had missed were
 * *yesterday's*. So the rule is time, not volume: keep opening days until the feed reaches
 * back past `cover` (a day) **and** has enough rows to be worth reading, capped at
 * `maxDays` so a project that went quiet for a month does not unroll its entire history.
 */
export function initialOpenDays(
  groups: DayGroup[],
  now: number,
  { minRows = 10, cover = DAY, maxDays = 3 } = {}
): number[] {
  const open: number[] = [];
  let rows = 0;
  for (const g of groups) {
    open.push(g.day);
    rows += Math.min(g.events.length, DAY_PREVIEW);
    if (open.length >= maxDays) break;
    const oldest = ms(g.events[g.events.length - 1]?.ts) ?? now;
    if (rows >= minRows && now - oldest >= cover) break;
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
  /**
   * Every event in the window, grouped and counted, biggest first — and it adds up to
   * `total`. The old subtitle counted starts, finishes, filings and fixes only, so a day
   * of nine events was described as three: the six notes, claims and comments that were
   * most of the day's actual traffic went unmentioned (round 2 critic).
   *
   * **The key, not the word.** This used to hold `label: t(key)`, and the page holds the
   * result in a `useMemo` keyed on the events and the clock — so a reader who changed the
   * language got a repainted dashboard with one line of the old one still in it:
   * "started 16 · done 16 · notes 30 · 에이전트 8명" (P9 round 1 critic). A value that is
   * cached across renders may not carry words, because words have an input the cache does
   * not list. The page says them at the moment it draws them.
   */
  breakdown: { key: RecentKey; count: number }[];
  actors: string[];
}

/** What each event type is called when the day is summarised in a sentence. */
const RECENT_KEY: Record<string, RecentKey> = {
  work_started: "recent.started",
  work_updated: "recent.notes",
  // A comment on a bug and an update on a work log are the same act — somebody wrote
  // something down — and counting them apart only lengthens the sentence.
  bug_commented: "recent.notes",
  // The state words, not synonyms for them: a work log that reached the end is "done" here,
  // on the work list, in the chart legend and in the pill on its own page (lib/words.ts).
  work_done: "recent.done",
  work_abandoned: "recent.abandoned",
  bug_created: "recent.filed",
  bug_claimed: "recent.claimed",
  bug_resolved: "recent.resolved",
  bug_closed: "recent.closed",
  // The shared notes (memory / handoff / decision / reference) are one act in a day's
  // summary — somebody put knowledge where the next agent will find it — whether the
  // file was created, rewritten or taken away.
  note_created: "recent.sharedNotes",
  note_updated: "recent.sharedNotes",
  note_removed: "recent.sharedNotes",
  project_created: "recent.project",
  project_updated: "recent.project",
};

type RecentKey =
  | "recent.started"
  | "recent.notes"
  | "recent.done"
  | "recent.abandoned"
  | "recent.filed"
  | "recent.claimed"
  | "recent.resolved"
  | "recent.closed"
  | "recent.sharedNotes"
  | "recent.project"
  | "recent.other";

/** The order the parts are printed in: what a reader looks for first. */
const RECENT_ORDER: RecentKey[] = [
  "recent.started",
  "recent.done",
  "recent.notes",
  "recent.filed",
  "recent.resolved",
  "recent.claimed",
  "recent.abandoned",
  "recent.closed",
  "recent.sharedNotes",
  "recent.project",
  "recent.other",
];

export function last24h(events: VaultEvent[], now: number): RecentWindow {
  const from = floorTo(now, HOUR) - 23 * HOUR;
  const hours = Array.from({ length: 24 }, (_, i) => ({ start: from + i * HOUR, count: 0 }));
  const counts = new Map<string, number>();
  const window: RecentWindow = { hours, total: 0, breakdown: [], actors: [] };

  for (const e of events) {
    const at = ms(e.ts);
    if (at === null || at < from || at > now + HOUR) continue;
    const i = Math.min(23, Math.max(0, Math.floor((at - from) / HOUR)));
    hours[i].count += 1;
    window.total += 1;
    const key = RECENT_KEY[e.type] ?? "recent.other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (e.actor && !window.actors.includes(e.actor)) window.actors.push(e.actor);
  }

  window.breakdown = RECENT_ORDER.filter((k) => counts.has(k)).map((key) => ({
    key,
    count: counts.get(key) as number,
  }));
  return window;
}

/**
 * The breakdown as a sentence of at most `max` parts, with the tail merged rather than
 * dropped — the sum of what is printed is always the day's total.
 */
export function summarise(
  breakdown: { key: RecentKey; count: number }[],
  max = 6
): { key: RecentKey; count: number }[] {
  if (breakdown.length <= max) return breakdown;
  const head = breakdown.slice(0, max - 1);
  const rest = breakdown.slice(max - 1).reduce((n, p) => n + p.count, 0);
  return [...head, { key: "recent.other", count: rest }];
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Unresolved bugs by severity, in triage order, including the empty ones. */
export function severityCounts(openBugs: BugSummary[]): { severity: Severity; count: number }[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    count: openBugs.filter((b) => b.severity === severity).length,
  }));
}

/**
 * Open bugs in the order somebody triaging them would work: worst first, and inside one
 * severity the ones nobody has picked up before the ones somebody is already holding.
 *
 * The dashboard used to name exactly one open bug — the oldest — which in relay is the
 * *medium* one that an agent had already claimed and written a fix plan into, while the
 * high-severity GA blocker nobody had touched went unnamed (round 1 critic). Oldest-first
 * is the wrong question on a screen a reader opens to find out what needs them.
 */
export function triageOrder(openBugs: BugSummary[]): BugSummary[] {
  return openBugs
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        Number(Boolean(a.assignee)) - Number(Boolean(b.assignee)) ||
        a.created.localeCompare(b.created)
    );
}

/* --------------------------------------------------------------------------
   The outline of a note
   ----------------------------------------------------------------------- */

const FENCED = /```[\s\S]*?(?:```|$)/g;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;
/** Twin of strip_inline() in agentmon-core/src/body.rs. */
const stripInline = (text: string): string =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");

const firstSentence = (text: string): string => {
  const m = /^(.*?[.!?])(?:\s|$)/.exec(text);
  return (m ? m[1] : text).trim();
};

/**
 * Sentences that carry a decision or a dependency rather than progress.
 *
 * Used for two different jobs, and for nothing else: choosing which lines survive when a
 * note is longer than the room for it, and marking the ones a reader must not skim past.
 * Neither job invents a fact — the sentence is printed verbatim either way; the pattern
 * only decides *which* verbatim sentence gets the space and the emphasis.
 */
const ASK_CUE =
  /\b(asked|asking|waiting on|waiting for|blocked|blocker|cannot|can not|can't|unblock|depends on|still outstanding|needs? (a |an |the )?(answer|decision|call|input|reply|review))\b/i;
const DECISION_CUE =
  /\b(deliberately|on purpose|decided|decision|instead of|not doing|will not|won't|chose|holding off|parked|risk|data.loss)\b/i;

export interface NoteLine {
  text: string;
  /** This sentence asks somebody for something, or says something is in the way. */
  ask: boolean;
  /** Sentences were skipped immediately before this one. */
  gap: boolean;
}

export interface NoteOutline {
  lines: NoteLine[];
  skipped: number;
  /**
   * An agent named *in an ask sentence* and known to this project. The chip the dashboard
   * draws from it says only what the quote already says, and carries the quote in its
   * tooltip — the reader can check it against the sentence in one glance.
   */
  waitingOn: string | null;
}

/**
 * The opening sentence of each paragraph of a note — its outline.
 *
 * The event log's `summary` is a first clause and stops mid-thought, so the feed could not
 * show that the newest note on relay's WORK-0012 reports a data-loss path and two questions
 * put to another agent: a reader of the dashboard read "clean progress" (round 1 critic).
 * The record itself has the whole note, and an agent's note is written the way this rule
 * reads it — each paragraph opens with what it is about.
 *
 * When a note has more paragraphs than there is room for, first-two-plus-last was the wrong
 * rule: it dropped nova's "Deliberately not doing the production swap this week", so a
 * paced migration read as a possibly-stalled one (round 2 critic). The opener and the
 * closer still hold their places — a note opens with what happened and closes with what is
 * outstanding — and the space between them goes to the sentences that carry a decision or a
 * blocker, in the order they were written. Skips are marked, so nothing pretends to be
 * contiguous.
 */
export function noteOutline(
  body: string | null | undefined,
  maxLines = 3,
  agents: string[] = []
): NoteOutline {
  const paragraphs = (body ?? "").replace(FENCED, "\n\n").split(/\n{2,}/);
  const sentences: string[] = [];
  for (const para of paragraphs) {
    const raw = para.split("\n");
    if (/^(?: {4,}|\t)/.test(raw[0] ?? "")) continue; // an indented code block, not prose
    const lines = raw.map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^#{1,6}\s/.test(lines[0])) continue; // a heading inside the note
    const listy = LIST_MARKER.test(lines[0]);
    const flat = stripInline((listy ? lines[0].replace(LIST_MARKER, "") : lines.join(" ")))
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
    const sentence = firstSentence(flat);
    if (sentence) sentences.push(sentence);
  }

  let keep: number[];
  if (sentences.length <= maxLines) {
    keep = sentences.map((_, i) => i);
  } else {
    const chosen = new Set<number>([0, sentences.length - 1]);
    const middle = sentences.map((_, i) => i).slice(1, -1);
    for (const i of middle) {
      if (chosen.size >= maxLines) break;
      if (ASK_CUE.test(sentences[i]) || DECISION_CUE.test(sentences[i])) chosen.add(i);
    }
    for (const i of middle) {
      if (chosen.size >= maxLines) break;
      chosen.add(i);
    }
    keep = [...chosen].sort((a, b) => a - b);
  }

  const lines: NoteLine[] = keep.map((idx, n) => ({
    text: sentences[idx],
    ask: ASK_CUE.test(sentences[idx]),
    gap: n > 0 && idx > keep[n - 1] + 1,
  }));

  /* Who is named in an ask. Longest name first so "nova-2" is not read as "nova", and only
     names this project's own records carry — a chip that named a word from the prose would
     be the app inventing a dependency. */
  let waitingOn: string | null = null;
  const known = [...new Set(agents)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const line of lines) {
    if (!line.ask) continue;
    const found = known.find((agent) =>
      new RegExp(`(^|[^\\w-])${escapeRe(agent)}([^\\w-]|$)`, "i").test(line.text)
    );
    if (found) {
      waitingOn = found;
      break;
    }
  }

  return { lines, skipped: sentences.length - keep.length, waitingOn };
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Which record a feed entry points at, if any. */
export function refHref(slug: string, ref: string | null): string | null {
  if (!ref) return null;
  if (/^WORK-\d+$/.test(ref)) return `/p/${slug}/work/${ref}`;
  if (/^BUG-\d+$/.test(ref)) return `/p/${slug}/bugs/${ref}`;
  // A note's ref is its kebab name. A removed note's line still links — the notes screen
  // answers a name that is gone with the same stale-link card every dead ref gets.
  if (/^[a-z0-9][a-z0-9-]{0,63}$/.test(ref)) return `/p/${slug}/notes/${ref}`;
  return null;
}

/**
 * The verbs the feed prints. Kept here so the icon set and the wording stay in step.
 *
 * Korean is verb-final, so the row that reads "nova started WORK-0012" in English reads
 * "nova WORK-0012 시작" in Korean: the *word* is this map's business and the *order* is the
 * feed row's (see `verbAfterRef`), because no dictionary entry can move a sibling element.
 */
const VERB_KEY: Record<EventType, `verb.${EventType}`> = {
  work_started: "verb.work_started",
  work_updated: "verb.work_updated",
  work_done: "verb.work_done",
  work_abandoned: "verb.work_abandoned",
  bug_created: "verb.bug_created",
  bug_claimed: "verb.bug_claimed",
  bug_commented: "verb.bug_commented",
  bug_resolved: "verb.bug_resolved",
  bug_closed: "verb.bug_closed",
  note_created: "verb.note_created",
  note_updated: "verb.note_updated",
  note_removed: "verb.note_removed",
  human_updated: "verb.human_updated",
  project_created: "verb.project_created",
  project_updated: "verb.project_updated",
};

export const eventVerb = (type: string): string => {
  const key = VERB_KEY[type as EventType];
  return key ? t(key) : type.replace(/_/g, " ");
};

/** Does this language put the verb after the record it is about? Korean does. */
export const verbAfterRef = (): boolean => getLocale() === "ko";

/**
 * An event's summary as a feed line.
 *
 * The CLI cuts the summary from the first line the agent wrote, and an agent whose
 * resolution opens with `## Root cause` puts the hashes in the event log. They are markup,
 * not words: a feed row reading "## Root cause" looks like the app failed to render
 * something. Nothing else is touched — the sentence is still the agent's.
 */
export const eventSummary = (text: string): string => text.replace(/^\s*#{1,6}\s+/, "");
