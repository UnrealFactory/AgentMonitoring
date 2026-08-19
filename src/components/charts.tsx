/**
 * The dashboard's charts. Hand-written SVG — no charting dependency, so every mark is
 * one this app decided to draw.
 *
 * The rules they all follow, once, here rather than per chart:
 *
 *   * **Marks are thin and the chrome recedes.** 2px lines, 8px dots with a 2px ring in
 *     the surface colour, gridlines and axis rules one step off the surface, solid and
 *     hairline — never dashed, because a dashed grid reads as a threshold.
 *   * **Text never wears the series colour.** Values, labels and axis ticks are in the
 *     app's text tokens; identity comes from the coloured line-key beside the text. A
 *     legend is always present when there are two series.
 *   * **The tooltip enhances, it never gates.** Every number a tooltip shows is also on
 *     the axis, in the legend, or spelled out in the card — hovering is never the only
 *     way to read a value, and keyboard focus shows exactly what hover does.
 *   * **The container includes the axis.** The height is the plot *plus* the label band,
 *     so nothing gets a nested scrollbar or a clipped tick.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { axisLabel, axisTicks, bucketLabel, type CumulativeSeries } from "../lib/dashboard";
import { getLocale, t } from "../lib/i18n";

/* --------------------------------------------------------------------------
   Measuring

   A chart cannot be laid out in percentages: text does not scale, and a viewBox
   stretched to fit would smear every label. So the SVG is drawn at the real pixel
   width of its container and redrawn when that changes.
   ----------------------------------------------------------------------- */

export function useMeasure<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/* --------------------------------------------------------------------------
   Scales
   ----------------------------------------------------------------------- */

/** Round the top of the axis to a number a human reads without decoding it. */
function niceTicks(max: number): { top: number; ticks: number[] } {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => Math.ceil(max / s) <= 5) ?? 2000;
  const count = Math.max(1, Math.ceil(max / step));
  return { top: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/* --------------------------------------------------------------------------
   Word order
   ----------------------------------------------------------------------- */

/**
 * A count and the word it counts, in the order the language puts them.
 *
 * **The number goes where the language puts it.** English counts first — "24 done"; Korean
 * names the thing first and counts after — "완료 24", which is how the severity chips one
 * card away read, how the project cards read, how the work list's "진행 중 2개" reads, and
 * how this chart's own spoken summary reads (`chart.summary`: "작업 로그: 시작 24, 완료 24").
 * A bare numeral in front of a state word is English grammar wearing Korean words, and
 * src/lib/i18n/ko.ts says so in as many words beside `word.inProgressCount`: "2 진행 중"처럼
 * 숫자가 상태어 앞에 오는 영어 어순은 쓰지 않는다.
 *
 * **It is a function because the last time it was a call site it was written once.** Round 1
 * found hard-coded value-then-label in the legend, where it disagreed with its own aria-label
 * on the same element, and fixed the legend. The tooltip 150 lines above it kept English
 * order for four more rounds: hovering the 작업 chart printed "11 시작 · 11 완료 · 0 진행 중"
 * over a legend reading "시작 27 · 완료 27 · 진행 중 0" and a spoken status reading
 * "시작 11, 완료 11" — one chart, one word, two orders (P9 round 5 critic). Every surface
 * that prints a bare count beside one of the app's own words calls this now, so the rule
 * lives in one place instead of once per element.
 *
 * `space` inserts the separator the flow needs: the legend and tip rows are flex boxes with
 * their own `gap`, the gap line is running text in a `<p>` and needs a real space.
 */
function counted(value: ReactNode, label: ReactNode, space = false): ReactNode[] {
  const parts = getLocale() === "ko" ? [label, value] : [value, label];
  return space ? [parts[0], " ", parts[1]] : parts;
}

const PAD = { top: 12, right: 10, bottom: 22, left: 30 };
/** A tick that also carries the date it opens needs a second line under it. */
const PAD_BOTTOM_DATED = 34;
const PLOT_H = 132;

/** How much of a tick label sits either side of its anchor, roughly, at 10px. */
const TICK_HALF = 20;

/** "+3", "−1", "±0" — a change against the period the chart is scoped to. */
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

/** Height of the tallest bar in the 24-hour strip, in px. */
const HOUR_BAR_H = 48;

/* --------------------------------------------------------------------------
   The burn-up: two cumulative lines and the gap between them
   ----------------------------------------------------------------------- */

export interface SeriesSpec {
  label: string;
  /** A CSS colour — always a `--series-*` token from tokens.css. */
  color: string;
}

export function BurnUp({
  series,
  upper,
  lower,
  gap,
  noun,
  scope,
  empty,
}: {
  series: CumulativeSeries;
  upper: SeriesSpec;
  lower: SeriesSpec;
  /** What the shaded band between the lines means, and the wash it is drawn in. */
  gap: { label: string; wash: string };
  /** What one unit is, for the tooltip and the accessible summary. */
  noun: string;
  /**
   * The window the chart is scoped to, named — "the last 7 days". Given one, the legend
   * carries what changed inside it beside each running total, because a cumulative line
   * ends at the project's lifetime total whatever the range, and a legend that reads
   * exactly the same at 7 days as at All time looks like a control that does nothing
   * (round 1 critic). Null for an all-time chart, where the total *is* the change.
   */
  scope?: string | null;
  /** What to draw when this project has nothing to plot at all. */
  empty?: { title: string; hint: string };
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const points = series.points;
  const n = points.length;

  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const { top, ticks } = niceTicks(series.max);
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + PLOT_H - (v / top) * PLOT_H;

  const xTicks = axisTicks(series.axis, innerW);
  const dated = xTicks.some((t) => t.date !== null);
  const padBottom = dated ? PAD_BOTTOM_DATED : PAD.bottom;
  const height = PAD.top + PLOT_H + padBottom;
  const delta = scope
    ? {
        upper: series.totalUpper - series.baseUpper,
        lower: series.totalLower - series.baseLower,
        gap:
          series.totalUpper - series.totalLower - (series.baseUpper - series.baseLower),
      }
    : null;

  const nearest = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el || n === 0) return null;
      const box = el.getBoundingClientRect();
      const px = clientX - box.left;
      const i = Math.round(((px - PAD.left) / Math.max(1, innerW)) * (n - 1));
      return Math.min(n - 1, Math.max(0, i));
    },
    [innerW, n, ref]
  );

  /**
   * Nothing has ever happened on this series: no work log started, or no bug filed.
   *
   * Two flat lines pinned to zero, a full axis and a legend of noughts is a chart claiming
   * to plot something. A project one hour old got two of them side by side (P5 critic), and
   * the honest reading — "there is nothing here yet, and here is what puts something here" —
   * took a reader three seconds and a squint. This is not the same as a *quiet* range: a
   * project with records but none inside the window still draws its lines, because the level
   * they sit at is real information.
   */
  if (empty && series.totalUpper === 0 && series.totalLower === 0) {
    return (
      <div className="chart chart-empty" role="img" aria-label={`${empty.title}. ${empty.hint}`}>
        <div className="chart-empty-plot" style={{ height: PAD.top + PLOT_H + PAD.bottom }}>
          <p className="chart-empty-title">{empty.title}</p>
          <p className="chart-empty-hint">{empty.hint}</p>
        </div>
        {/* The legend still names the three things this chart will show, at the zero they
            honestly stand at — so the card is the same shape as the one beside it. */}
        <Legend
          items={[
            { color: upper.color, label: upper.label, value: 0 },
            { color: lower.color, label: lower.label, value: 0 },
            { color: gap.wash, label: gap.label, value: 0, band: true },
          ]}
        />
      </div>
    );
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (n === 0) return;
    const move = (d: number) => {
      e.preventDefault();
      setActive((prev) => Math.min(n - 1, Math.max(0, (prev ?? n - 1) + d)));
    };
    if (e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowLeft") move(-1);
    else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === "Escape") setActive(null);
  };

  const line = (pick: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(" ");
  const band =
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.upper).toFixed(1)}`).join(" ") +
    " " +
    points
      .slice()
      .reverse()
      .map((p, i) => `L${x(n - 1 - i).toFixed(1)} ${y(p.lower).toFixed(1)}`)
      .join(" ") +
    " Z";

  const at = active === null ? null : points[active];
  const openGap = series.totalUpper - series.totalLower;
  const summary =
    t(
      "chart.summary",
      upper.label,
      series.totalUpper,
      lower.label,
      series.totalLower,
      noun,
      n,
      bucketLabel(points[0].bucket, series.axis),
      bucketLabel(points[n - 1].bucket, series.axis)
    ) +
    (delta && scope
      ? t(
          "chart.summaryDelta",
          scope,
          signed(delta.upper),
          upper.label,
          signed(delta.lower),
          lower.label
        )
      : "") +
    t("chart.summaryKeys");

  return (
    <div className="chart">
      <div
        className="chart-plot"
        ref={ref}
        tabIndex={0}
        role="img"
        aria-label={summary}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onPointerMove={(e) => setActive(nearest(e.clientX))}
        onPointerLeave={() => setActive(null)}
        style={{ height }}
      >
        {width > 0 && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            {ticks.map((t) => (
              <g key={t}>
                <line
                  className={t === 0 ? "chart-axis-rule" : "chart-grid"}
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={y(t)}
                  y2={y(t)}
                  shapeRendering="crispEdges"
                />
                <text className="chart-tick" x={PAD.left - 7} y={y(t) + 3.5} textAnchor="end">
                  {t}
                </text>
              </g>
            ))}

            {xTicks.map((t) => {
              const px = x(t.index);
              const anchor =
                px - TICK_HALF < 0 ? "start" : px + TICK_HALF > width ? "end" : "middle";
              return (
                <g key={t.index}>
                  <text
                    className="chart-tick"
                    x={px}
                    y={PAD.top + PLOT_H + 14}
                    textAnchor={anchor}
                  >
                    {t.label}
                  </text>
                  {t.date && (
                    <text
                      className="chart-tick chart-tick-date"
                      x={px}
                      y={PAD.top + PLOT_H + 26}
                      textAnchor={anchor}
                    >
                      {t.date}
                    </text>
                  )}
                </g>
              );
            })}

            <path d={band} fill={gap.wash} />
            <path d={line((p) => p.upper)} fill="none" stroke={upper.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <path d={line((p) => p.lower)} fill="none" stroke={lower.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

            {active !== null && at && (
              <line
                className="chart-crosshair"
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                shapeRendering="crispEdges"
              />
            )}

            {/* End dots mark where each line stands now; the active dots follow the pointer. */}
            <circle className="chart-dot" cx={x(n - 1)} cy={y(points[n - 1].upper)} r="4" fill={upper.color} />
            <circle className="chart-dot" cx={x(n - 1)} cy={y(points[n - 1].lower)} r="4" fill={lower.color} />
            {active !== null && at && active !== n - 1 && (
              <>
                <circle className="chart-dot" cx={x(active)} cy={y(at.upper)} r="4" fill={upper.color} />
                <circle className="chart-dot" cx={x(active)} cy={y(at.lower)} r="4" fill={lower.color} />
              </>
            )}
          </svg>
        )}

        {at && (
          <ChartTip x={x(active as number)} width={width}>
            <p className="tip-when">{bucketLabel(at.bucket, series.axis)}</p>
            <ul className="tip-rows">
              <TipRow color={upper.color} value={at.upper} label={upper.label} added={at.addedUpper} />
              <TipRow color={lower.color} value={at.lower} label={lower.label} added={at.addedLower} />
            </ul>
            <p className="tip-gap">
              {counted(
                <span key="value" className="tip-gap-value tabular">
                  {at.upper - at.lower}
                </span>,
                <span key="label" className="tip-gap-label">
                  {gap.label}
                </span>,
                true
              )}
            </p>
          </ChartTip>
        )}
      </div>

      {/* Keyboard readers get the same reading the pointer does, in words. */}
      <p className="sr-only" role="status">
        {at
          ? t(
              "chart.reading",
              bucketLabel(at.bucket, series.axis),
              at.upper,
              upper.label,
              at.lower,
              lower.label,
              at.upper - at.lower,
              gap.label
            )
          : ""}
      </p>

      {/* The legend sits under the plot and carries each series' current value, so the
          three numbers this chart is about are printed even when nobody hovers — and so
          the card head cannot reflow differently from the card beside it. */}
      <Legend
        items={[
          {
            color: upper.color,
            label: upper.label,
            value: series.totalUpper,
            delta: delta?.upper,
            deltaTitle:
              delta && scope
                ? t("chart.deltaTip", signed(delta.upper), upper.label, scope)
                : undefined,
          },
          {
            color: lower.color,
            label: lower.label,
            value: series.totalLower,
            delta: delta?.lower,
            deltaTitle:
              delta && scope
                ? t("chart.deltaTip", signed(delta.lower), lower.label, scope)
                : undefined,
          },
          {
            color: gap.wash,
            label: gap.label,
            value: openGap,
            band: true,
            delta: delta?.gap,
            deltaTitle:
              delta && scope
                ? t("chart.deltaTip", signed(delta.gap), gap.label, scope)
                : undefined,
          },
        ]}
      />
    </div>
  );
}

function TipRow({
  color,
  value,
  label,
  added,
}: {
  color: string;
  value: number;
  label: string;
  added: string[];
}) {
  return (
    <li className="tip-row">
      <span className="key-line" style={{ background: color }} aria-hidden="true" />
      {counted(
        <span key="value" className="tip-value tabular">
          {value}
        </span>,
        <span key="label" className="tip-label">
          {label}
        </span>
      )}
      {added.length > 0 && (
        <span className="tip-added">
          +{added.length} · {added.slice(0, 3).join(", ")}
          {added.length > 3 ? "…" : ""}
        </span>
      )}
    </li>
  );
}

/**
 * Follows the crosshair, and flips rather than leaving the card. Hidden from assistive
 * technology on purpose: it is a visual echo of the status line above, which says the
 * same thing in a sentence.
 */
function ChartTip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const side = x < 130 ? "start" : x > width - 130 ? "end" : "mid";
  return (
    <div className={`chart-tip is-${side}`} style={{ left: x }} aria-hidden="true">
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
   The 24-hour strip: a sparkline, not a chart
   ----------------------------------------------------------------------- */

export function HourBars({
  hours,
  label,
}: {
  hours: { start: number; count: number }[];
  label: string;
}) {
  const max = Math.max(1, ...hours.map((h) => h.count));
  const n = hours.length;
  /** Every sixth hour, and the right-hand end, which is the hour we are standing in. */
  const ticks = hours
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => i === n - 1 || (n - 1 - i) % 6 === 0);

  return (
    <div className="hour-strip">
      <div className="hour-bars" role="img" aria-label={label}>
        {hours.map((h, i) => (
          <span
            key={h.start}
            className={`hour-bar${i === n - 1 ? " is-now" : ""}${h.count === 0 ? " is-empty" : ""}`}
            style={{ height: `${h.count === 0 ? 2 : Math.max(3, Math.round((h.count / max) * HOUR_BAR_H))}px` }}
            title={t("chart.hourTip", axisLabel(h.start, "hour"), h.count)}
          />
        ))}
      </div>
      {/* An axis, not a decoration: the hours are named, in the same UTC the rest of the
          page prints, and the tallest bar's value is spelled out so the shape has a scale. */}
      <p className="hour-axis tabular" aria-hidden="true">
        {ticks.map(({ h, i }) => (
          <span
            key={h.start}
            className="hour-tick"
            style={
              i === n - 1
                ? { right: 0 }
                : i === 0
                  ? { left: 0 }
                  : { left: `${(i / (n - 1)) * 100}%`, transform: "translateX(-50%)" }
            }
          >
            {i === n - 1 ? t("chart.now") : axisLabel(h.start, "hour")}
          </span>
        ))}
      </p>
      {/* The figure keeps its own element and the sentence is split around it, so the number
          can sit where each language puts it: before the noun in English, after it in
          Korean ("가장 바쁜 시간대 이벤트 9건"). */}
      <p className="hour-scale">
        {t("chart.busiestHourPre")}
        <span className="hour-scale-max tabular">{max}</span>
        {t("chart.busiestHour", max)}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
   The per-agent split: one stacked bar per agent, beside its own numbers
   ----------------------------------------------------------------------- */

export function SplitBar({
  parts,
  total,
  max,
  title,
}: {
  parts: { value: number; color: string; label: string }[];
  total: number;
  /** The busiest agent's total: every row is drawn against the same scale. */
  max: number;
  title: string;
}) {
  const share = max > 0 ? total / max : 0;
  return (
    <span className="split-bar" style={{ width: `${Math.max(share * 100, total > 0 ? 4 : 0)}%` }} title={title}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span
            key={p.label}
            className="split-seg"
            style={{ flexGrow: p.value, background: p.color }}
            aria-hidden="true"
          />
        ))}
    </span>
  );
}

/**
 * A chart's legend. Always rendered when a chart has two or more series, and it carries
 * each series' current value — so the number is a direct label, not something only a
 * hover will admit to. A line-key for a line, a taller block for a filled band, matching
 * the mark it stands for.
 *
 * The number goes where the language puts it: see {@link counted}, which the tooltip 150
 * lines above also calls, because for four rounds it did not.
 */
export function Legend({
  items,
}: {
  items: {
    color: string;
    label: string;
    value?: ReactNode;
    band?: boolean;
    /** Change over the chart's range, when it is scoped to one. */
    delta?: number | null;
    deltaTitle?: string;
  }[];
}) {
  return (
    <ul className="chart-legend">
      {items.map((it) => {
        const value =
          it.value === undefined ? null : (
            <span key="value" className="legend-value tabular">
              {it.value}
            </span>
          );
        const label = (
          <span key="label" className="legend-label">
            {it.label}
          </span>
        );
        return (
          <li key={it.label}>
            <span
              className={`key-line${it.band ? " is-band" : ""}`}
              style={{ background: it.color }}
              aria-hidden="true"
            />
            {counted(value, label)}
            {it.delta !== undefined && it.delta !== null && (
              <span
                className={`legend-delta tabular${it.delta === 0 ? " is-flat" : ""}`}
                title={it.deltaTitle}
              >
                {signed(it.delta)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Re-render on a timer, so "and counting" durations really do count. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
