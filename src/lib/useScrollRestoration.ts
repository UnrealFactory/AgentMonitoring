/**
 * Back returns to the *place*, not just the page.
 *
 * The defect this closes was reported against the shipped desktop build the day gestures
 * arrived: scroll a list, open the seventh record, draw ← — and the list is at the top
 * again, the row you were reading somewhere below the fold. The app's scroller is `#main`
 * (`.main{overflow-y:auto}`), not the window, so no router or browser default ever touched
 * it; and the list's data loads asynchronously, so on the way back the screen is briefly a
 * short skeleton, the browser clamps `scrollTop` toward 0, and the position is destroyed
 * before the rows that could hold it have arrived.
 *
 * So the position is kept and re-applied by hand, per **history entry** (`location.key`,
 * which back/forward revisit and new navigations never reuse):
 *
 *  - **POP** (Alt+Left, the ← / → gestures, the browser buttons): re-apply the saved
 *    position — patiently. Until the async content is tall enough to hold it, the write is
 *    retried once a frame, and abandoned the moment the reader scrolls, presses, or clicks
 *    (their hand on the page outranks the restoration), or after a deadline (the data may
 *    genuinely have shrunk — a clamped best-effort is then the right answer).
 *  - **PUSH** (opening a record, switching screens): start at the top, explicitly. Before
 *    this file the scroller simply kept whatever offset it had, which is the same defect
 *    mirrored: a record opened from a deep scroll position started mid-document.
 *  - **REPLACE** (the list filters, `useUrlFilters`): the reader has not moved, but the
 *    history entry has been swapped for one with a fresh key — carry the position onto the
 *    new key and otherwise leave the scroll alone, so typing in a filter box never yanks
 *    the board.
 *
 * One hook, called once from the Shell (App.tsx), beside {@link useWindowTitle}.
 */
import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** scrollTop per `location.key`. Session-lived, like the history entries it mirrors. */
const positions = new Map<string, number>();

/** How long a POP keeps waiting for the content that can hold its position. */
const RESTORE_DEADLINE_MS = 3000;

/**
 * Put `want` back, against content that may still be loading.
 *
 * Returns the cancel function; cancelling stops the retries, never the scroll itself.
 */
function restore(el: HTMLElement, want: number): () => void {
  el.scrollTop = want;
  if (Math.abs(el.scrollTop - want) <= 1) return () => {};

  let raf = 0;
  const deadline = performance.now() + RESTORE_DEADLINE_MS;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("wheel", stop);
    window.removeEventListener("pointerdown", stop);
    window.removeEventListener("keydown", stop);
  };
  const tick = () => {
    raf = 0;
    el.scrollTop = want;
    if (Math.abs(el.scrollTop - want) <= 1 || performance.now() > deadline) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  // The reader's own hand ends the wait: a restoration that lands *after* they started
  // scrolling would snatch the page away from them.
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("pointerdown", stop);
  window.addEventListener("keydown", stop);
  return stop;
}

export function useScrollRestoration(): void {
  const location = useLocation();
  const navType = useNavigationType();

  /* Layout effect, not effect: the decision has to land before the paint that would
     otherwise flash the wrong position. */
  useLayoutEffect(() => {
    const el = document.getElementById("main");
    if (!el) return;
    const key = location.key;

    let cancel = () => {};
    if (navType === "POP") {
      cancel = restore(el, positions.get(key) ?? 0);
    } else if (navType === "PUSH") {
      el.scrollTop = 0;
      positions.set(key, 0);
    } else {
      positions.set(key, el.scrollTop);
    }

    /* Every scroll while this entry is current is the position Back should return to —
       including the ones the app itself performs (the ↑/↓ gestures land here too). */
    const onScroll = () => positions.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancel();
    };
  }, [location.key, navType]);
}
