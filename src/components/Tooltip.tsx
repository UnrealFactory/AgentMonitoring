/**
 * Every `title` in this app, drawn by this app.
 *
 * The defect was reported against the shipped desktop build: hovering a project row in the
 * sidebar raised WebView2's own tooltip — a white box with a grey border and Segoe UI inside
 * it, sitting on a #0b0c0e column. It is the same failure the context menu was rebuilt for
 * (components/ContextMenu.tsx): a desktop app that leaks the browser it happens to be drawn
 * in. Nobody hovers a count in Linear and meets Edge.
 *
 * ## Why the attribute stays
 *
 * There are 144 `[title]` elements on the dashboard alone, and the obvious fix — replace each
 * one with a `<Tooltip>` wrapper — would have touched every component in the app and broken a
 * gate on the way past. `title` is not only a tooltip here: scripts/check-i18n.mjs sweeps
 * `[title]` twice on every screen, for Latin text left in a Korean window and for the app's
 * own words in the wrong order, and a screen reader uses it for the accessible name of an
 * element that has no visible label. So the attribute is the API, and this layer is the
 * renderer:
 *
 *   1. the pointer enters an element with a title → the value is stashed and the attribute is
 *      set to the **empty string**, which per HTML is "this element has no advisory
 *      information" and also stops the browser consulting an ancestor's title;
 *   2. 400ms later (or at once, if the reader is moving along a row of them) this draws it;
 *   3. the pointer leaves → the attribute goes back, exactly as it was.
 *
 * So the DOM is untouched at rest, which is the state every gate reads it in, and the native
 * tooltip has no window in which to appear: the blanking happens on `mouseover`, the moment
 * the hover starts, not when this decides to show something.
 *
 * The one asymmetry is deliberate. **Keyboard focus never blanks anything.** No browser
 * raises a native tooltip for focus, so there is nothing to suppress — and a focused element
 * whose accessible name *is* its title (the nav counts, the severity dots) would go nameless
 * to a screen reader for as long as it held the focus. The tooltip is drawn from the live
 * attribute instead and the attribute stays live.
 *
 * ## Where it goes
 *
 * A pointer tooltip sits off the cursor hotspot, below and right, the way every desktop
 * tooltip does; a focus tooltip is anchored under the element, because the reader who put the
 * focus there is not holding a mouse and the cursor is wherever it was abandoned. Either way
 * it flips rather than clipping — above the cursor near the bottom edge, back to the left near
 * the right one — and then is clamped into the window as a last resort. The same rule the
 * context menu keeps, for the same reason: a popover that leaves the window is not one.
 *
 * ## What it is not
 *
 * It is not an accessibility feature, and it says so: `aria-hidden`. The text it prints is
 * already on the element it describes, as `title` (or as `aria-label` beside it), which is
 * what a screen reader reads. Announcing it twice, from a box the reader cannot reach, would
 * be worse than not drawing it at all. `role="tooltip"` is there so the box is *typed*
 * honestly for anything reading the tree for other reasons.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { onModalChange } from "../lib/modal";

/** How long the pointer rests before a tooltip appears. Windows' own waits about 500ms. */
const SHOW_DELAY = 400;

/**
 * After one has been on screen, the next opens with no delay at all for this long. Reading
 * across the sidebar's counts, or down a column of dates, is one gesture and not five, and
 * paying 400ms per element turns it into five.
 */
const WARM_MS = 150;

/** Never nearer the window edge than this — the margin the context menu keeps. */
const MARGIN = 8;

/* Off the cursor hotspot. Below by more than beside it, so the box clears the pointer glyph
   rather than sitting under its tail, and never covers what is being pointed at. */
const CURSOR_RIGHT = 12;
const CURSOR_BELOW = 20;
/** When it has to go over the cursor instead, it clears the tip rather than the whole arrow. */
const CURSOR_ABOVE = 10;

/** Under a focused element, clear of the 2px focus ring and its 2px offset. */
const ANCHOR_GAP = 6;

/** U+00A0. Built from its code point: a literal one is invisible in the source. */
const NBSP = String.fromCharCode(0xa0);

type Kind = "pointer" | "anchor";

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Shot {
  /** Bumped per open, so a placement can tell whether it belongs to what is on screen. */
  id: number;
  text: string;
  kind: Kind;
  /** The cursor, for a pointer tooltip. */
  at: { x: number; y: number };
  /** The element's box, for a focused one. */
  box: Box | null;
}

interface Placed {
  id: number;
  left: number;
  top: number;
}

const clamp = (lo: number, v: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

/**
 * The dashboard's burn-up draws a tip of its own, following its crosshair
 * (components/charts.tsx). Two tooltips about one chart is one too many, so while that tip is
 * up nothing else inside the same chart card offers one — the legend's ±n deltas being the
 * pair that can otherwise be hovered while the plot is held open by the keyboard.
 *
 * The title attribute is still blanked in that case: the browser's tooltip would be the third.
 */
function chartTipOpen(el: Element): boolean {
  const chart = el.closest(".chart");
  return !!chart && !!chart.querySelector(".chart-tip");
}

/**
 * The middle dot is a joint, not a bullet.
 *
 * Half the titles in this app are compound — "작업 로그 30 · 진행 중 2", a date and a
 * duration, a name and a count — and a line that wraps in front of a `·` starts with what
 * looks like a list marker. Gluing the dot to the text before it with a no-break space moves
 * the only break opportunity to *after* the separator, where it reads as a continuation.
 *
 * The no-break space is built from its code point rather than typed into the string: a
 * literal one is invisible in a diff and the next editor deletes it by accident.
 */
function joinDots(text: string): string {
  return text.replace(/ · /g, NBSP + "· ");
}

export function TooltipLayer() {
  const [shot, setShot] = useState<Shot | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  /* Everything below is a ref rather than state on purpose: these are answers a mouse event
     needs at the instant it fires, not values a render is derived from. */
  const timer = useRef<number | null>(null);
  /** The element whose title this layer is currently holding, and what it held. */
  const held = useRef<{ el: HTMLElement; title: string } | null>(null);
  const cursor = useRef({ x: 0, y: 0 });
  const shown = useRef(false);
  const lastHide = useRef(0);
  const buttonsDown = useRef(false);
  const seq = useRef(0);

  /** Give the attribute back — but only if it is still the blank this layer put there. */
  const release = useCallback(() => {
    const holding = held.current;
    held.current = null;
    if (!holding || !holding.el.isConnected) return;
    /* A re-render between claim and release can have written a *newer* title (a count that
       changed while it was hovered). React's own DOM already agrees with that value, so
       putting the stashed one back would leave a stale string nothing would ever correct. */
    if (holding.el.getAttribute("title") === "") holding.el.setAttribute("title", holding.title);
  }, []);

  const hide = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (shown.current) {
      shown.current = false;
      lastHide.current = performance.now();
      setShot(null);
    }
  }, []);

  /** Leave the element entirely: nothing on screen, and the attribute restored. */
  const leave = useCallback(() => {
    hide();
    release();
  }, [hide, release]);

  const show = useCallback((el: HTMLElement, text: string, kind: Kind) => {
    // Re-asked at the moment of showing, not only when the timer was set: 400ms is long
    // enough for the row to have been navigated away from, or for the chart beside it to
    // have opened its own tip.
    if (!el.isConnected || chartTipOpen(el)) return;
    seq.current += 1;
    shown.current = true;
    setPlaced(null);
    setShot({
      id: seq.current,
      text,
      kind,
      at: { ...cursor.current },
      box: kind === "anchor" ? boxOf(el.getBoundingClientRect()) : null,
    });
  }, []);

  const arm = useCallback(
    (el: HTMLElement, text: string, kind: Kind) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      /* A keyboard reader asked for this by moving the focus onto it; a pointer reader has
         only rested there, and might be on the way somewhere else. So focus is instant and
         hover waits — unless the last tooltip was up a moment ago, in which case this is the
         same gesture continuing along a row. */
      const warm = kind === "anchor" || performance.now() - lastHide.current < WARM_MS;
      if (warm) {
        timer.current = null;
        show(el, text, kind);
        return;
      }
      timer.current = window.setTimeout(() => {
        timer.current = null;
        show(el, text, kind);
      }, SHOW_DELAY);
    },
    [show]
  );

  /* --- the delegation ---------------------------------------------------------------
     One listener per event, on the document, for the whole app: 144 titled elements on the
     dashboard, 40 on a bug page, and a component that had to opt in would be a component
     somebody forgets. ------------------------------------------------------------------ */
  useEffect(() => {
    const anchorFor = (node: EventTarget | null): HTMLElement | null =>
      node instanceof Element ? node.closest<HTMLElement>("[title]") : null;

    const onMouseOver = (e: MouseEvent) => {
      buttonsDown.current = e.buttons !== 0;
      cursor.current = { x: e.clientX, y: e.clientY };
      const el = anchorFor(e.target);
      if (!el) {
        leave();
        return;
      }
      if (held.current?.el === el) return; // moving about inside the same element
      release();
      hide();

      const title = el.getAttribute("title") ?? "";
      // `title=""` is a suppression somebody wrote on purpose; there is nothing to draw and
      // nothing to blank.
      if (!title.trim()) return;

      /* Blank it now, not when the tooltip is shown. The native one appears after ~500ms of
         hover and this waits 400: leaving the attribute live in between is a race this loses
         on a slow frame, and losing it means the white box the reader reported. */
      held.current = { el, title };
      el.setAttribute("title", "");

      if (buttonsDown.current) return; // dragging, selecting, or holding the title bar
      if (chartTipOpen(el)) return;
      arm(el, title, "pointer");
    };

    const onMouseOut = (e: MouseEvent) => {
      const holding = held.current;
      if (!holding) return;
      const to = e.relatedTarget;
      // Into a child of the same element: not a departure.
      if (to instanceof Node && holding.el.contains(to)) return;
      /* Straight onto the next tooltipped element: leave the swap to the `mouseover` that
         is already on its way, so the box moves instead of blinking out and back. */
      if (to instanceof Element && to.closest("[title]")) {
        release();
        return;
      }
      leave();
    };

    /* The cursor is read at show time, 400ms after the hover began, and by then the pointer
       has usually travelled — a tooltip pinned to the pixel where the element was entered
       points at its edge. Passive and ref-only: no render comes out of this. */
    const onMouseMove = (e: MouseEvent) => {
      cursor.current = { x: e.clientX, y: e.clientY };
      buttonsDown.current = e.buttons !== 0;
      if (buttonsDown.current) hide();
    };

    const onFocusIn = (e: FocusEvent) => {
      /* Only a keyboard focus, and the test is on the element that took it rather than on the
         one carrying the title — a focusable child of a titled box is focus-visible; the box
         around it never is. Clicking a row focuses it too, and a tooltip that appears under
         the pointer on every click is a tooltip in the way. `:focus-visible` is the browser's
         own answer to "did they mean to be here", and it is the predicate the focus ring in
         tokens.css is already drawn from. */
      const focused = e.target instanceof Element ? e.target : null;
      const el = focused?.matches(":focus-visible") ? anchorFor(focused) : null;
      if (!el) {
        hide();
        return;
      }
      // The pointer may be resting on this same element, in which case its title is blanked
      // and held; the stash is the value either way.
      const title = held.current?.el === el ? held.current.title : (el.getAttribute("title") ?? "");
      if (!title.trim() || chartTipOpen(el)) {
        hide();
        return;
      }
      arm(el, title, "anchor");
    };

    const onFocusOut = () => hide();

    const onDown = () => {
      buttonsDown.current = true;
      // A press is the start of a click, a drag, a selection or a window move. None of them
      // want a tooltip over them — and the title bar's drag hands the gesture to Windows, so
      // the matching release never arrives here at all (the next `mousemove` clears the flag).
      hide();
    };
    const onUp = () => {
      buttonsDown.current = false;
    };

    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp, true);
    return () => {
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mouseup", onUp, true);
    };
  }, [arm, hide, leave, release]);

  /* --- everything that ends one ----------------------------------------------------- */
  useEffect(() => {
    /*
     * Escape closes it — and every other key does too, which is what the native one does and
     * what a reader means: they have stopped pointing at things and started typing. Tab and
     * the arrows are not an exception, because `keydown` runs *before* the focus moves, so
     * the box this hides is the one about the element being left and the `focusin` behind it
     * draws the one about the element arrived at.
     *
     * Nothing is consumed. The palette, the context menu and the filter menus all answer
     * Escape, and a tooltip is the shallowest thing on this screen — it must not be the thing
     * that eats the key that was meant for the menu underneath it.
     */
    const onKeyDown = () => hide();
    // Capture, because the scroll that matters is inside a pane and does not bubble to window.
    const onScroll = () => hide();
    const onWheel = () => hide();
    const onClick = () => hide();
    /*
     * These all `hide` rather than `leave`: the pointer is still resting on the element, and
     * handing its `title` back while it is under the cursor is exactly the state the browser
     * raises its own tooltip from. The attribute comes back on the way out (`mouseout`), on a
     * route change, or when this layer unmounts — never while the mouse is still on it.
     */
    const onContextMenu = () => hide();
    const onBlur = () => hide();
    const onResize = () => hide();
    const onVisibility = () => hide();
    const onDragStart = () => hide();

    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    // The command palette, a context menu, anything that takes the keyboard over the page.
    const offModal = onModalChange(() => hide());
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      offModal();
    };
  }, [hide]);

  // A tooltip about a row on a screen the reader has left is a tooltip about nothing. Also
  // the one moment an element can vanish while this layer is holding its attribute.
  useEffect(() => {
    leave();
  }, [location.pathname, location.search, leave]);

  // Unmounted with a title still blanked — hot reload in dev, and the shell coming down.
  useEffect(() => release, [release]);

  /**
   * Where it goes, measured rather than guessed: the width depends on the text, which is a
   * project's name in one place and four clauses of a vault error in another.
   *
   * Preference first — off the cursor, or under the element — then a flip if that side has no
   * room, then a clamp into the window, which is what catches a box taller than the space
   * above *and* below it. `useLayoutEffect` so this is decided before the first paint: the
   * box is `visibility: hidden` until it lands, so nothing is ever drawn at 0,0.
   */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!shot || !el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left: number;
    let top: number;
    if (shot.kind === "anchor" && shot.box) {
      const box = shot.box;
      left = box.left;
      top = box.bottom + ANCHOR_GAP;
      if (top + height > vh - MARGIN) top = box.top - ANCHOR_GAP - height;
      if (left + width > vw - MARGIN) left = box.right - width;
    } else {
      left = shot.at.x + CURSOR_RIGHT;
      top = shot.at.y + CURSOR_BELOW;
      if (top + height > vh - MARGIN) top = shot.at.y - CURSOR_ABOVE - height;
      if (left + width > vw - MARGIN) left = shot.at.x - CURSOR_RIGHT - width;
    }
    setPlaced({
      id: shot.id,
      left: Math.round(clamp(MARGIN, left, vw - MARGIN - width)),
      top: Math.round(clamp(MARGIN, top, vh - MARGIN - height)),
    });
  }, [shot]);

  if (!shot) return null;
  const position = placed?.id === shot.id ? placed : null;
  return (
    <div
      className="tooltip"
      ref={boxRef}
      role="tooltip"
      aria-hidden="true"
      data-tooltip-kind={shot.kind}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {joinDots(shot.text)}
    </div>
  );
}

/** A snapshot: a live DOMRect is re-read after the next layout, and this one must not move. */
function boxOf(r: DOMRect): Box {
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}
