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
 * **The app's own Back gesture is one of those listeners**, and it was the one that ignored
 * this file for three rounds: Alt+Left (src/App.tsx) navigated the page behind an armed
 * 프로젝트 삭제 dialog, leaving it on top of a screen about a different project — where ↵
 * still deleted the first one, off the disk, measured (P12 round 2 critic). A modal that can
 * be navigated out from under is not a modal, whatever it does with Escape.
 *
 * The same flag is mirrored onto `<html data-modal="open">` so CSS and the headless gates
 * (scripts/check-keys.mjs) can see it too.
 */
import { useEffect } from "react";

/**
 * What kind of thing holds the lock — the difference between "stand down" and "stay".
 *
 * A **menu** is the shallowest surface in the app: it is drawn under a dialog's scrim
 * (`.ctx-layer` is z-index 70, `.modal-scrim` 80), so anything dialog-shaped that opens over
 * one buries it, and it closes rather than sitting there answering keys from behind the
 * glass. A **dialog** — the command palette, the delete confirmation — owns the window while
 * it is up: nothing else opens over it, so the layer the reader is looking at is always the
 * layer their keys reach.
 *
 * The distinction is not decoration. Without it, "a modal arrived over me" is one number and
 * every modal has to guess: a copy menu raised on the slug printed inside the delete dialog
 * would either bury the dialog (it did — invisibly, holding the keyboard, and the next
 * Escape closed the dialog underneath while the menu stayed) or be treated as a takeover and
 * dismiss the dialog the reader was halfway through typing into.
 */
export type ModalKind = "menu" | "dialog";

let depth = 0;
let dialogs = 0;

/** True while any modal is on screen. Cheap enough to call from a keydown handler. */
export function isModalOpen(): boolean {
  return depth > 0;
}

/**
 * True while a *dialog* is on screen.
 *
 * What the two things that can appear from anywhere ask before appearing: the command
 * palette's Ctrl+K (components/CommandPalette.tsx) and the context menu's open
 * (components/ContextMenu.tsx). Neither may open over a dialog.
 */
export function isDialogOpen(): boolean {
  return dialogs > 0;
}

/** How many modals are stacked. What a modal compares against to notice one arrived over it. */
export function modalDepth(): number {
  return depth;
}

/** How many of those are dialogs. What a dialog compares against for the same reason. */
export function dialogDepth(): number {
  return dialogs;
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

/**
 * Hold the modal lock for as long as `open` is true.
 *
 * `kind` defaults to `"dialog"` because that is the stronger claim — a surface that owns the
 * window until it is answered — and the weaker one should have to say so.
 */
export function useModalLock(open: boolean, kind: ModalKind = "dialog"): void {
  useEffect(() => {
    if (!open) return;
    depth += 1;
    if (kind === "dialog") dialogs += 1;
    document.documentElement.setAttribute("data-modal", "open");
    for (const fn of [...watchers]) fn(depth);
    return () => {
      depth = Math.max(0, depth - 1);
      if (kind === "dialog") dialogs = Math.max(0, dialogs - 1);
      if (depth === 0) document.documentElement.removeAttribute("data-modal");
      for (const fn of [...watchers]) fn(depth);
    };
  }, [open, kind]);
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
