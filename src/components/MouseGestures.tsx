/**
 * Right-drag mouse gestures, in the AgentCodeGUI dialect.
 *
 * Hold the right button, draw, let go. While the stroke is being drawn a trail follows the
 * cursor and — the moment the shape matches an action — a bubble in the middle of the window
 * names what letting go will do, so an unfamiliar stroke can be checked before it commits.
 * The vocabulary is the one the human already has from AgentCodeGUI, mapped onto what this
 * app can do:
 *
 *   ↑ 맨 위로 · ↓ 맨 아래로 · ← 뒤로 · → 앞으로 · ↑↓ 기록 새로 읽기
 *   →↑ 창 최대화/이전 크기로 · ↓→ 창 닫기            (the last two: desktop window only)
 *
 * ## The recognizer (constants and behaviour ported from AgentCodeGUI's mouseGesture.tsx)
 *
 * A right-press *arms*; nothing is a gesture until the pointer has moved {@link START_PX}
 * from the press, so a plain right-click is exactly what it always was — the context menu's
 * turn (components/ContextMenu.tsx). Past that, direction segments are committed each time
 * the pointer gets {@link STROKE_PX} from a *moving anchor*, quantized to the dominant axis,
 * with consecutive duplicates collapsed: "L", "UD", "DR". No timers — a stroke drawn slowly
 * is the same stroke.
 *
 * ## Coexistence with the right button's other job
 *
 * Windows delivers `contextmenu` *after* the right-button pointerup. Any drawn gesture —
 * matched or not — swallows exactly one of them, in the capture phase, from a listener that
 * lives at module scope: if it lived in this component and a gesture ever unmounted the
 * layer, the listener would be gone before the event it must eat arrived. A drag that never
 * crossed the start threshold swallows nothing.
 *
 * ## What gestures refuse to do
 *
 * Nothing, while a dialog is up. The delete confirmation owns the window (lib/modal.ts, the
 * P12 rule): Alt+Left already declines to navigate out from under it, and a stroke of the
 * mouse is the same navigation by another hand — checked when the press arms *and* again
 * when the stroke runs, because a dialog can arrive mid-draw.
 *
 * Mounted once, in the Shell (App.tsx). Idle it renders nothing at all, which is why
 * browser mode can keep it mounted without a screenshot anywhere noticing.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { isTauri } from "../lib/api";
import { t, useLocale } from "../lib/i18n";
import { isDialogOpen } from "../lib/modal";
import { ask } from "./Titlebar";

/** Distance from the press before a right-drag is a gesture at all (px). */
const START_PX = 14;
/** Distance from the moving anchor before one direction segment commits (px). */
const STROKE_PX = 24;
/** How long an executed stroke's trail takes to fade off the screen (ms). */
const FADE_MS = 240;

type Dir = "U" | "D" | "L" | "R";

interface GestureAction {
  /** "L", "UD", "DR" — {@link Dir} letters in drawing order. */
  pattern: string;
  label: string;
  run: () => void;
}

/* ==========================================================================
   The one contextmenu that must not happen
   ======================================================================= */

let swallowUntil = 0;

if (typeof window !== "undefined") {
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (performance.now() >= swallowUntil) return;
      swallowUntil = 0; // one event per gesture — the next right-click is a right-click
      e.preventDefault();
      e.stopImmediatePropagation(); // nothing downstream: not the row menus, not the Copy-selection fallback
    },
    true
  );
}

/** Called by a finished stroke, just before its action runs. */
function swallowNextContextMenu(): void {
  swallowUntil = performance.now() + 300;
}

/* ==========================================================================
   The layer
   ======================================================================= */

interface Trail {
  pts: string[];
  pattern: string;
  out: boolean;
}

/** The main screens' scroller, resolved at run time so remounts cannot strand a gesture. */
function scrollMain(top: boolean): void {
  const el = document.getElementById("main");
  if (el) el.scrollTo({ top: top ? 0 : el.scrollHeight, behavior: "smooth" });
}

export function MouseGestureLayer() {
  /* The bubble's words follow the language like any other text in the window. */
  useLocale();
  const navigate = useNavigate();
  const { reload } = useApp();
  const [trail, setTrail] = useState<Trail | null>(null);

  /* Whether →↑ would maximize or restore is a fact about the window, re-read as each
     gesture arms (below) — by the time two strokes have been drawn, the answer is in. */
  const maximizedRef = useRef(false);

  /* Rebuilt every render (labels track the language; →↑ tracks the window) and read
     through a ref at pointerup, so the engine effect never has to re-bind. */
  const actionsRef = useRef<GestureAction[]>([]);
  actionsRef.current = [
    { pattern: "U", label: t("gesture.scrollTop"), run: () => scrollMain(true) },
    { pattern: "D", label: t("gesture.scrollBottom"), run: () => scrollMain(false) },
    { pattern: "L", label: t("gesture.back"), run: () => navigate(-1) },
    { pattern: "R", label: t("gesture.forward"), run: () => navigate(1) },
    { pattern: "UD", label: t("gesture.refresh"), run: reload },
    ...(isTauri()
      ? [
          {
            pattern: "RU",
            label: maximizedRef.current ? t("gesture.restore") : t("gesture.maximize"),
            run: () => void ask("toggleMaximize", "allow-toggle-maximize"),
          },
          {
            // "닫기" the way the X now means it: the window hides, the app stays in the
            // tray (src-tauri/src/lib.rs, on_window_event).
            pattern: "DR",
            label: t("gesture.close"),
            run: () => void ask("close", "allow-close"),
          },
        ]
      : []),
  ];

  useEffect(() => {
    let armed = false; // right button down, watching
    let active = false; // …and past the start threshold: this is a gesture now
    let sx = 0, sy = 0; // where the press happened
    let ax = 0, ay = 0; // the moving anchor a segment is measured from
    let lx = 0, ly = 0; // last sampled trail point
    let dirs = "";
    let pts: string[] = [];
    let raf = 0;
    let fadeTimer = 0;

    const flush = () => {
      raf = 0;
      setTrail({ pts: [...pts], pattern: dirs, out: false });
    };
    /** Trail repaints are rAF-coalesced: many pointermoves, one render per frame. */
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const finish = (fade: boolean) => {
      armed = false;
      active = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (fade) {
        setTrail((tr) => (tr ? { ...tr, out: true } : tr));
        window.clearTimeout(fadeTimer);
        fadeTimer = window.setTimeout(() => setTrail(null), FADE_MS);
      } else {
        setTrail(null);
      }
    };

    /** Which glyph →↑'s bubble should wear, refreshed per gesture; best effort. */
    const readMaximized = async () => {
      if (!isTauri()) return;
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        maximizedRef.current = await getCurrentWindow().isMaximized();
      } catch {
        /* keep the last known answer */
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 2 || e.pointerType !== "mouse") return;
      if (isDialogOpen()) return; // the dialog owns the window; the right button waits
      window.clearTimeout(fadeTimer); // a fresh press clears a lingering fade at once
      armed = true;
      active = false;
      sx = e.clientX;
      sy = e.clientY;
      ax = sx;
      ay = sy;
      lx = sx;
      ly = sy;
      dirs = "";
      pts = [`${sx},${sy}`];
      void readMaximized();
    };

    const onMove = (e: PointerEvent) => {
      if (!armed) return;
      // The mouseup that never arrived (released outside the window, alt-tabbed away):
      // the button is no longer held, so this drag is not that gesture. Disarm, or a
      // stale start point would turn some later drag into one.
      if (!(e.buttons & 2)) {
        finish(false);
        return;
      }
      if (!active) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) <= START_PX) return;
        active = true;
      }
      // Sub-2px jitter is not trail; everything else is, one point per sample.
      if (Math.hypot(e.clientX - lx, e.clientY - ly) >= 2) {
        lx = e.clientX;
        ly = e.clientY;
        pts.push(`${lx},${ly}`);
        schedule();
      }
      const dx = e.clientX - ax;
      const dy = e.clientY - ay;
      if (Math.hypot(dx, dy) >= STROKE_PX) {
        const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U";
        if (dirs[dirs.length - 1] !== dir) {
          dirs += dir;
          schedule();
        }
        ax = e.clientX; // re-seed either way: a long straight is one segment, not many
        ay = e.clientY;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 2 || !armed) return;
      const wasActive = active;
      const pattern = dirs;
      finish(wasActive);
      if (!wasActive) return; // a plain right-click — the context menu's turn
      // Anything drawn suppresses the menu, matched or not: an unrecognized shape does
      // nothing, and opening a menu at the end of it is not what was being asked for.
      swallowNextContextMenu();
      if (isDialogOpen()) return; // a dialog arrived mid-draw; the stroke yields
      actionsRef.current.find((a) => a.pattern === pattern)?.run();
    };

    const onCancel = () => finish(false);

    // Down in the capture phase so no row's own handler can eat the arming press; the
    // rest on window, because a stroke has every right to leave the element it started on.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(fadeTimer);
    };
  }, []);

  if (!trail) return null;
  const match = trail.pattern
    ? actionsRef.current.find((a) => a.pattern === trail.pattern)
    : undefined;

  return createPortal(
    <div className={"mg-layer" + (trail.out ? " out" : "")} aria-hidden="true">
      <svg className="mg-trail">
        <polyline points={trail.pts.join(" ")} />
      </svg>
      {/* Only a recognized shape gets the bubble — the trail alone says "drawing", the
          bubble says "this will run". Keyed by the pattern so the pop-in replays when the
          recognized action changes mid-draw. */}
      {match && (
        <div key={trail.pattern} className="mg-label">
          <GestureGlyph pattern={trail.pattern} size={30} />
          <span className="mg-name">{match.label}</span>
        </div>
      )}
    </div>,
    document.body
  );
}

/* ==========================================================================
   The glyph: the pattern drawn as arrows
   ======================================================================= */

const DIR_VEC: Record<Dir, [number, number]> = {
  U: [0, -1],
  D: [0, 1],
  L: [-1, 0],
  R: [1, 0],
};

/** Stroke length per segment, in glyph units. */
const GLYPH_U = 10;
/** Arrowhead wing length. */
const GLYPH_AH = 3.4;
/** Wing spread, radians off the shaft. */
const GLYPH_WING = 0.62;
/** A 180° reversal would retrace itself and read as one line, so the second arrow starts
 *  this far beside the first (vertical reversals offset right, horizontal ones down). */
const GLYPH_GAP = 6;
/** Padding around the pattern's box, so 1- and 2-segment glyphs share a stroke weight. */
const GLYPH_PAD = 9;

function GestureGlyph({ pattern, size }: { pattern: string; size: number }) {
  type Pt = [number, number];
  interface Run {
    pts: Pt[];
    last: Dir;
  }

  const runs: Run[] = [];
  let x = 0;
  let y = 0;
  let pts: Pt[] = [[0, 0]];
  let prev: Dir | null = null;
  for (const ch of pattern) {
    const dir = ch as Dir;
    const vec = DIR_VEC[dir];
    if (!vec) continue;
    if (prev && DIR_VEC[prev][0] === -vec[0] && DIR_VEC[prev][1] === -vec[1]) {
      runs.push({ pts, last: prev });
      if (vec[0] === 0) x += GLYPH_GAP;
      else y += GLYPH_GAP;
      pts = [[x, y]];
    }
    x += vec[0] * GLYPH_U;
    y += vec[1] * GLYPH_U;
    pts.push([x, y]);
    prev = dir;
  }
  if (prev) runs.push({ pts, last: prev });
  if (!runs.length) return null;

  const heads = runs.map(({ pts: run, last }) => {
    const [px, py] = run[run.length - 1];
    const [vx, vy] = DIR_VEC[last];
    const back = Math.atan2(vy, vx) + Math.PI;
    const wing = (a: number): Pt => [
      px + GLYPH_AH * Math.cos(back + a),
      py + GLYPH_AH * Math.sin(back + a),
    ];
    const [w1x, w1y] = wing(-GLYPH_WING);
    const [w2x, w2y] = wing(GLYPH_WING);
    return `M ${w1x} ${w1y} L ${px} ${py} L ${w2x} ${w2y}`;
  });

  const all = runs.flatMap((r) => r.pts);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // A square viewBox around the box, so stroke weight does not change with the pattern.
  const side = Math.max(maxX - minX, maxY - minY) + GLYPH_PAD * 2;
  const vx = (minX + maxX) / 2 - side / 2;
  const vy = (minY + maxY) / 2 - side / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${vx} ${vy} ${side} ${side}`}
      aria-hidden="true"
      focusable="false"
    >
      {runs.map((run, i) => (
        <polyline
          key={i}
          points={run.pts.map(([px, py]) => `${px},${py}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {heads.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
