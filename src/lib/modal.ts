/**
 * Is a modal open, and does it have the keyboard?
 *
 * One boolean, shared by the whole app, because the alternative is what the round-2 critic
 * measured: the command palette open over the bug board, the arrows driving the *board's*
 * cursor behind the scrim and ↵ navigating the page underneath while the palette highlighted
 * something else. A window-level key handler that has never heard of modals will do that
 * every time, and every screen-level handler is one.
 *
 * So: a modal marks itself open for as long as it is mounted, and anything that listens on
 * `window` asks {@link isModalOpen} first. It is a module-level count rather than context on
 * purpose — the callers are event handlers, not components, and they need the answer at the
 * instant the key is pressed rather than at the last render.
 *
 * The same flag is mirrored onto `<html data-modal="open">` so CSS and the headless gates
 * (scripts/check-keys.mjs) can see it too.
 */
import { useEffect } from "react";

let depth = 0;

/** True while any modal is on screen. Cheap enough to call from a keydown handler. */
export function isModalOpen(): boolean {
  return depth > 0;
}

/** How many modals are stacked. What a modal compares against to notice one arrived over it. */
export function modalDepth(): number {
  return depth;
}

const watchers = new Set<(depth: number) => void>();

/**
 * Be told when the stack changes.
 *
 * One subscriber so far: the context menu, which stands down when something else takes the
 * keyboard over it. Ctrl+K on an open row menu used to leave the palette and the menu on
 * screen together, straddling the palette's scrim, and cost two Escapes to get back to the
 * page — the first of them closing a menu the reader had stopped looking at (P8 round 2
 * critic). A menu is the shallowest thing in this app; anything that arrives over it wins.
 */
export function onModalChange(fn: (depth: number) => void): () => void {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
}

/** Hold the modal lock for as long as `open` is true. */
export function useModalLock(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    depth += 1;
    document.documentElement.setAttribute("data-modal", "open");
    for (const fn of [...watchers]) fn(depth);
    return () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) document.documentElement.removeAttribute("data-modal");
      for (const fn of [...watchers]) fn(depth);
    };
  }, [open]);
}

/** Everything inside `root` that Tab can reach, in tab order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const sel =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(sel)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
  );
}

/**
 * Keep Tab inside `root`: wrap at both ends, and pull focus back in if it is already out.
 * Returns true when the event was handled, so the caller can `preventDefault()`.
 */
export function trapTab(root: HTMLElement, shiftKey: boolean): boolean {
  const stops = focusables(root);
  if (!stops.length) return false;
  const current = document.activeElement as HTMLElement | null;
  const i = current ? stops.indexOf(current) : -1;
  const next =
    i < 0 ? stops[0] : stops[(i + (shiftKey ? -1 : 1) + stops.length) % stops.length];
  next.focus();
  return true;
}
