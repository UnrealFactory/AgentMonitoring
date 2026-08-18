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
import { axisLabel, bucketLabel, type CumulativeSeries } from "../lib/dashboard";

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

/**
 * How many x labels fit without them touching, and which buckets get one. The last
 * bucket always gets one — it is where the lines end and the reader looks first — so the
 * label before it is dropped whenever the two would land closer than a full stride
 * apart, which is how "20:00 21:00" came to be printed as one word.
 */
function labelIndices(count: number, innerWidth: number): number[] {
  const room = Math.max(2, Math.floor(innerWidth / 64));
  const stride = Math.max(1, Math.ceil((count - 1) / (room - 1)));
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  if (out[out.length - 1] !== count - 1) {
    if (out.length > 1 && count - 1 - out[out.length - 1] < stride) out.pop();
    out.push(count - 1);
  }
  return out;
}

const PAD = { top: 12, right: 10, bottom: 22, left: 30 };
const PLOT_H = 132;

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
}: {
  series: CumulativeSeries;
  upper: SeriesSpec;
  lower: SeriesSpec;
  /** What the shaded band between the lines means, and the wash it is drawn in. */
  gap: { label: string; wash: string };
  /** What one unit is, for the tooltip and the accessible summary. */
  noun: string;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const points = series.points;
  const n = points.length;

  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const { top, ticks } = niceTicks(series.max);
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + PLOT_H - (v / top) * PLOT_H;

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
    `${upper.label} ${series.totalUpper}, ${lower.label} ${series.totalLower} ${noun} ` +
    `over ${n} periods ending ${bucketLabel(points[n - 1].bucket, series.axis)}. ` +
    `Use the left and right arrow keys to read each period.`;

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
        style={{ height: PAD.top + PLOT_H + PAD.bottom }}
      >
        {width > 0 && (
          <svg
            width={width}
            height={PAD.top + PLOT_H + PAD.bottom}
            aria-hidden="true"
            focusable="false"
          >
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

            {labelIndices(n, innerW).map((i) => (
              <text
                key={i}
                className="chart-tick"
                x={x(i)}
                y={PAD.top + PLOT_H + 14}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              >
                {axisLabel(points[i].bucket.start, series.axis.granularity)}
              </text>
            ))}

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
              <span className="tip-gap-value tabular">{at.upper - at.lower}</span> {gap.label}
            </p>
          </ChartTip>
        )}
      </div>

      {/* Keyboard readers get the same reading the pointer does, in words. */}
      <p className="sr-only" role="status">
        {at
          ? `${bucketLabel(at.bucket, series.axis)}: ${at.upper} ${upper.label}, ${at.lower} ${lower.label}, ${at.upper - at.lower} ${gap.label}.`
          : ""}
      </p>

      {/* The legend sits under the plot and carries each series' current value, so the
          three numbers this chart is about are printed even when nobody hovers — and so
          the card head cannot reflow differently from the card beside it. */}
      <Legend
        items={[
          { color: upper.color, label: upper.label, value: series.totalUpper },
          { color: lower.color, label: lower.label, value: series.totalLower },
          { color: gap.wash, label: gap.label, value: openGap, band: true },
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
      <span className="tip-value tabular">{value}</span>
      <span className="tip-label">{label}</span>
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
  return (
    <div className="hour-bars" role="img" aria-label={label}>
      {hours.map((h, i) => (
        <span
          key={h.start}
          className={`hour-bar${i === hours.length - 1 ? " is-now" : ""}${h.count === 0 ? " is-empty" : ""}`}
          style={{ height: `${h.count === 0 ? 2 : Math.max(3, Math.round((h.count / max) * 22))}px` }}
          title={`${axisLabel(h.start, "hour")} — ${h.count} event${h.count === 1 ? "" : "s"}`}
        />
      ))}
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
 */
export function Legend({
  items,
}: {
  items: { color: string; label: string; value?: ReactNode; band?: boolean }[];
}) {
  return (
    <ul className="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span
            className={`key-line${it.band ? " is-band" : ""}`}
            style={{ background: it.color }}
            aria-hidden="true"
          />
          {it.value !== undefined && <span className="legend-value tabular">{it.value}</span>}
          <span className="legend-label">{it.label}</span>
        </li>
      ))}
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
