/**
 * The arrows, for the segmented controls that call themselves tablists.
 *
 * Six surfaces in this app draw the same `.segmented` control and give it `role="tablist"`
 * with `role="tab"` buttons inside: the work list's status filter, the bug board's, the
 * notes filter, the app-feedback kinds, the dashboard's range, and the record screens'
 * Agent / Human toggle. That role is a promise about the keyboard — a reader who has
 * arrived on a tab expects ← and → to move along the row — and for six rounds not one of
 * them kept it. Tab reached every segment and Enter and Space pressed it, so nothing was
 * unreachable; the arrows simply did nothing, which is the quiet kind of broken that a
 * screen-reader user hits first (D3 round 3 critic).
 *
 * One handler, on the container, so the six cannot drift apart:
 *
 *   * **← →** move one segment, wrapping at each end; **Home** / **End** jump to the ends.
 *   * The move both focuses the segment and presses it — automatic activation, which is the
 *     right pattern for tabs whose panel is already in the document and costs nothing to
 *     draw. `aria-selected` therefore always follows the focus rather than lagging it.
 *   * **↑ ↓ are deliberately not bound.** A tablist is horizontal unless it says otherwise,
 *     and on the two list screens the up and down arrows belong to the row cursor
 *     (lib/useListKeyboard.ts). Taking them here would move a filter *and* the list.
 *
 * `preventDefault` on a move is what keeps the window-level list handler out of it — that
 * handler stands down on an already-handled key, which is the same contract the filter
 * menus use.
 */
import type { KeyboardEvent } from "react";

export function tablistKeys(event: KeyboardEvent<HTMLElement>): void {
  const step =
    event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? 0 : event.key === "End" ? 0 : null;
  if (step === null || event.altKey || event.ctrlKey || event.metaKey) return;

  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
  );
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
  /* Nothing to move: the focus is somewhere else on the page, or this control has one
     segment. Both leave the key to whoever else wants it. */
  if (tabs.length < 2 || at < 0) return;

  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (at + step + tabs.length) % tabs.length;
  event.preventDefault();
  if (next === at) return;
  tabs[next].focus();
  tabs[next].click();
}
