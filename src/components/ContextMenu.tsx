/**
 * Right-click, in this app's own hand.
 *
 * The defect this closes was reported against the shipped desktop build: right-clicking a
 * project in the sidebar opened WebView2's menu — "새 창에서 링크 열기 / 링크 복사 / 검사" —
 * which is Edge's menu, in Edge's language, offering to open an internal `tauri://` address
 * in a new browser window and to inspect the page. A desktop app that leaks the browser it
 * happens to be drawn in is not a desktop app; nobody right-clicks in Linear and meets
 * Chromium.
 *
 * So the default menu is suppressed for the whole document, with one exception that matters:
 * **text entry keeps its native menu**. Copy, paste, undo, "add to dictionary" and the spell
 * checker's suggestions live there and cannot be rebuilt honestly by a web app, so inside an
 * `<input>`, a `<textarea>` or a contenteditable the browser stays in charge.
 *
 * What replaces it is this: one menu component, one keyboard contract, drawn from the same
 * tokens as the command palette and the filter menus.
 *
 *   ↑ ↓ move · Home/End jump · ↵ run · esc close · click away close · Tab close
 *
 * It is invoked by pointer (`onContextMenu`) and by keyboard (Shift+F10, or the Menu key
 * beside the right Ctrl on a PC keyboard) from whatever row has the focus — an app whose
 * actions are only reachable with a mouse has hidden them from half its readers. Focus goes
 * into the menu on open and back to the row on close, so ↑↓ still drives the list afterwards.
 *
 * **A menu is only offered where there is something to do.** Everywhere else the right
 * button does nothing at all — no menu, and no browser menu either. The single exception is
 * selected prose: taking Copy away from a reading app would be a worse defect than the one
 * this fixes, so a right-click inside a selection offers Copy, drawn by the app.
 */
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { modalDepth, onModalChange, useModalLock } from "../lib/modal";
import { vaultErrorMessage } from "../lib/api";
import { writeClipboard } from "../lib/clipboard";
import { t } from "../lib/i18n";
import { plainMarks } from "./ui";

/** One line of a menu. Deliberately data, not JSX: the same item is built in three places. */
export interface MenuItem {
  /** Stable inside its menu; also the hook a gate can drive it by (`data-item`). */
  id: string;
  label: string;
  /** The value or consequence, in small type on the right — "relay", "영구 삭제". */
  hint?: string;
  /** Draw a hairline above this item. */
  separator?: boolean;
  /**
   * This one destroys something. Drawn in red, and — because colour is not a label — its
   * hint says what it costs in words (src/lib/menus.ts). Exactly one item in the app sets
   * it: 삭제 on a project, which opens a dialog rather than acting.
   */
  danger?: boolean;
  run: () => void;
}

/** A menu, and the thing it is about (its accessible name). */
export interface MenuSpec {
  label: string;
  items: MenuItem[];
}

interface Point {
  x: number;
  y: number;
}

interface Request {
  /** Bumped per open, so position is recomputed for this menu and not the last one. */
  id: number;
  spec: MenuSpec;
  at: Point;
  invoker: HTMLElement | null;
}

export interface ToastOptions {
  tone?: "info" | "warn";
}

interface Toast extends ToastOptions {
  id: number;
  text: string;
}

interface ContextMenuApi {
  open: (spec: MenuSpec, at: Point, invoker: HTMLElement | null) => void;
  close: () => void;
  toast: (text: string, options?: ToastOptions) => void;
}

const Ctx = createContext<ContextMenuApi | null>(null);

/** Never touch the window edge; sit just off the cursor, the way every desktop menu does. */
const MARGIN = 8;
const NUDGE = 2;

/** How long a toast stays. Every toast in this app is one line reporting a fact. */
const TOAST_MS = 2200;

/** Anything Tab can reach — what a row hands the focus back to when the menu closes. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ==========================================================================
   The Menu key's echo
   ======================================================================= */

/**
 * The Menu key fires *twice*, and the second one used to close what the first one opened.
 *
 * Chromium — and therefore WebView2 — answers VK_APPS (the key beside the right Ctrl) with a
 * `keydown` of `key: "ContextMenu"` **and then**, a millisecond later, a synthesized
 * `contextmenu` event on whatever has the focus. `preventDefault()` on the keydown does not
 * stop it. So the sequence the P8 round shipped was:
 *
 *   t+0ms  keydown ContextMenu → the row opens this menu
 *   t+1ms  the menu is in the DOM and the first item has the keyboard
 *   t+2ms  Chromium's own contextmenu arrives, targeting that item inside `.ctx-layer`,
 *          whose handler reads it as "a right-click somewhere else" and closes the menu
 *
 * Net effect: the Menu key appeared to do nothing at all, on every row in the app, in the
 * shipped desktop window. (Shift+F10 was fine — Chromium sends no echo for it, which is why
 * the gate that only pressed Shift+F10 never saw this.)
 *
 * The echo is the same gesture as the keypress, not a new one, so it is consumed once: a
 * keyboard-origin contextmenu (`button` is -1 rather than 2) arriving just after a keyboard
 * open is swallowed — the default is still prevented, so no browser menu — and the window
 * is closed behind it. A *second* Menu key press therefore behaves normally and dismisses
 * the menu, which is what the key does on the rest of the desktop.
 */
let keyEchoUntil = 0;

/** How long after a keyboard open an echo can still be arriving. It arrives in ~1ms. */
const KEY_ECHO_MS = 1000;

/** Called by the keyboard opener, so the echo that follows can be told from a real click. */
function expectKeyEcho(): void {
  keyEchoUntil = performance.now() + KEY_ECHO_MS;
}

/**
 * Is this contextmenu event the echo of the keypress that just opened a menu? Consuming, so
 * it answers true at most once per keypress.
 */
function takeKeyEcho(e: { button: number }): boolean {
  // A right-click is always button 2; the synthesized one is -1 (0 in some engines).
  if (e.button === 2 || performance.now() > keyEchoUntil) return false;
  keyEchoUntil = 0;
  return true;
}

/**
 * Is the pointer over something a human types into?
 *
 * The one place the browser's own menu is worth more than ours: it carries paste, undo and
 * the spell checker, none of which a page can offer. `readonly` fields count — the menu is
 * still how you copy out of one.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest<HTMLElement>(
    "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']"
  );
  if (!el) return false;
  if (el instanceof HTMLInputElement) {
    // A checkbox or a radio is a button that happens to be an <input>; there is nothing to
    // copy out of it and nothing to paste into it.
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
      type
    );
  }
  return true;
}

/** The selected text, if the click landed inside it — a right-click on prose keeps Copy. */
function selectionAt(point: Point): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    for (const rect of selection.getRangeAt(i).getClientRects()) {
      if (
        point.x >= rect.left - 2 &&
        point.x <= rect.right + 2 &&
        point.y >= rect.top - 2 &&
        point.y <= rect.bottom + 2
      ) {
        return text;
      }
    }
  }
  return null;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const location = useLocation();

  const close = useCallback(() => setRequest(null), []);

  const open = useCallback((spec: MenuSpec, at: Point, invoker: HTMLElement | null) => {
    if (!spec.items.length) return;
    seq.current += 1;
    setRequest({ id: seq.current, spec, at, invoker });
  }, []);

  const showToast = useCallback((text: string, options?: ToastOptions) => {
    seq.current += 1;
    setToast({ id: seq.current, text, ...options });
  }, []);

  const api = useMemo<ContextMenuApi>(
    () => ({ open, close, toast: showToast }),
    [open, close, showToast]
  );

  /**
   * The suppression itself: on `document`, in the bubble phase, so a row that opened its own
   * menu (and called `preventDefault` doing it) is already answered by the time this runs.
   * Everything else gets nothing — except a text field, which keeps the browser's menu, and
   * a selection, which gets Copy drawn by the app.
   */
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented || isTextEntry(e.target)) return;
      e.preventDefault();
      // The Menu key's echo, arriving over a page that happens to have a selection on it:
      // one keypress must not also raise a second menu about the words behind the first.
      if (takeKeyEcho(e)) return;
      const at = { x: e.clientX, y: e.clientY };
      const text = selectionAt(at);
      if (!text) return;
      open(
        {
          label: t("menu.selection"),
          items: [
            {
              id: "copy-selection",
              label: t("app.copy"),
              run: () => {
                void writeClipboard(text).then((ok) =>
                  showToast(
                    ok ? t("menu.copiedSelection") : t("menu.copyFailed"),
                    ok ? undefined : WARN
                  )
                );
              },
            },
          ],
        },
        at,
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      );
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [open, showToast]);

  // A menu anchored to a row on a screen the reader has left is a menu about nothing.
  // The toast is not: "relay 프로젝트를 삭제했습니다" is raised by an action that *navigates*
  // (src/components/DeleteProject.tsx), so clearing it here would silence the one line
  // reporting the deletion the reader just asked for.
  useEffect(() => setRequest(null), [location.pathname, location.search]);

  /* One line, then gone. Every toast in this app reports something that already happened
     and leaves no trace on screen — a copy, a delete — and none of them is a question, so
     none of them waits for an answer. */
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* Keyed by the open, so a second menu never inherits the first one's item refs. */}
      {request && <Menu key={request.id} request={request} onClose={close} />}
      {toast && <ToastBar toast={toast} onDismiss={() => setToast(null)} />}
    </Ctx.Provider>
  );
}

const WARN: ToastOptions = { tone: "warn" };

function Menu({ request, onClose }: { request: Request; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [placed, setPlaced] = useState<{ id: number; left: number; top: number } | null>(null);
  const { items } = request.spec;

  // While it is up it owns the keyboard: the list screens' window-level handler stands down
  // (src/lib/modal.ts), so ↓ moves the menu and never the board behind it.
  useModalLock(true);

  /* Flip rather than overflow. A menu opened 40px from the right edge of a 960px window
     grows to the left; one opened near the bottom grows upward; either way it stays whole
     and inside the window, which is the difference between a menu and a clipped popover. */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = request.at.x + NUDGE;
    let top = request.at.y + NUDGE;
    if (left + width > vw - MARGIN) left = Math.max(MARGIN, request.at.x - width - NUDGE);
    if (top + height > vh - MARGIN) top = Math.max(MARGIN, request.at.y - height - NUDGE);
    setPlaced({ id: request.id, left, top });
  }, [request]);

  /* …and it gives the keyboard up to anything that arrives over it. Ctrl+K on an open row
     menu used to open the palette *on top* while this stayed mounted across its scrim, and
     the first Escape then closed the menu rather than the palette the reader was looking at
     (P8 round 2 critic). Declared after the lock above, so the depth read here already
     counts this menu's own. */
  useEffect(() => {
    const mine = modalDepth();
    return onModalChange((depth) => {
      if (depth > mine) onClose();
    });
  }, [onClose]);

  // The keyboard goes in, and comes back out to the row it came from.
  useEffect(() => {
    itemRefs.current[0]?.focus({ preventScroll: true });
    const invoker = request.invoker;
    return () => {
      if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    };
  }, [request]);

  /**
   * esc from anywhere, in the capture phase, for the same reason the palette does it: a
   * dismissal that only works while the focus is where the component put it is not one. A
   * resize or the window going away also ends it — a menu pinned to a cursor position in a
   * window that is no longer that shape is pointing at nothing.
   *
   * **Not scroll**, which is the rule the filter menu keeps and the wrong one here. The
   * layer under this menu covers the window, so the wheel cannot reach the page, and the
   * keys that would scroll it are answered below — while a *stale* scroll can still be
   * arriving as the menu opens (a trackpad still gliding, or a row that had to be scrolled
   * into view to be clicked at all). Closing on it means the menu vanishes the instant it
   * appears, which is exactly what it did.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const close = () => onClose();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const focusAt = (i: number) => {
    const list = itemRefs.current.filter((el): el is HTMLButtonElement => !!el);
    if (list.length) list[(i + list.length) % list.length].focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = itemRefs.current.filter((el): el is HTMLButtonElement => !!el);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        handled();
        return focusAt(at + 1);
      case "ArrowUp":
        handled();
        return focusAt(at - 1);
      // PageUp/PageDown are here so that nothing a key can do scrolls the page out from
      // under a menu anchored to a row on it. In a five-item menu, an end is what they mean.
      case "Home":
      case "PageUp":
        handled();
        return focusAt(0);
      case "End":
      case "PageDown":
        handled();
        return focusAt(list.length - 1);
      case "Tab":
        // A menu is not a place to Tab through: it closes, and the row gets the focus back.
        handled();
        return onClose();
      default:
        // ↵ and space are the button's own; they must not also reach the list underneath.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
    }
  };

  const run = (item: MenuItem) => {
    item.run();
    onClose();
  };

  const position = placed?.id === request.id ? placed : null;

  return (
    <div
      className="ctx-layer"
      role="presentation"
      onMouseDown={onClose}
      onWheel={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        // The keypress that opened this menu, arriving a second time (see takeKeyEcho).
        // Reading it as a right-click elsewhere is what made the Menu key a no-op.
        if (takeKeyEcho(e)) return;
        onClose();
      }}
    >
      <div
        className="ctx-menu"
        ref={menuRef}
        role="menu"
        aria-label={request.spec.label}
        tabIndex={-1}
        style={{
          left: position?.left ?? request.at.x,
          top: position?.top ?? request.at.y,
          maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
          /* Transparent for the one frame it takes to measure itself and decide which way
             to grow — never `visibility: hidden`, which also makes it unfocusable, and the
             first thing that happens to this menu is that it takes the keyboard. */
          opacity: position ? 1 : 0,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        // Scrolling a menu tall enough to have its own overflow must not dismiss it.
        onWheel={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* A Fragment, not a wrapper element: `role="menu"` may only own menu items,
            groups and separators, and a stray <div> between them is a lie to a screen
            reader about what this list contains. */}
        {items.map((item, i) => (
          <Fragment key={item.id}>
            {item.separator && <div className="ctx-sep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              data-item={item.id}
              className={`ctx-item${item.danger ? " is-danger" : ""}`}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              /* One highlight at a time: the pointer moves the focus, it does not paint a
                 second cursor beside the keyboard's. `preventScroll` matters — focusing an
                 element normally asks the browser to reveal it, and on a long screen that
                 scrolled the page a pixel under a menu whose whole job is to stay anchored
                 to the row it was opened on (which then dismissed itself). */
              onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
              onClick={() => run(item)}
            >
              <span className="ctx-label">{item.label}</span>
              {item.hint && <span className="ctx-hint">{item.hint}</span>}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ToastBar({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div className="toast-layer">
      <div className={`toast${toast.tone === "warn" ? " is-warn" : ""}`} role="status">
        <span className="toast-mark" aria-hidden="true">
          {toast.tone === "warn" ? (
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path
                d="M8 4.5 V9 M8 11.2 v0.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path
                d="M3.5 8.4 L6.4 11.2 L12.5 4.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        <span className="toast-text">{toast.text}</span>
        <button className="toast-dismiss" aria-label={t("app.dismiss")} onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  );
}

/* ==========================================================================
   What a screen uses
   ======================================================================= */

export function useContextMenuApi(): ContextMenuApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useContextMenuApi must be used inside <ContextMenuProvider>");
  return api;
}

/**
 * The two handlers a row spreads onto itself.
 *
 * Returns a *factory* rather than the handlers themselves because rows are rendered in a
 * `map` and a hook may not be called in a loop:
 *
 * ```tsx
 * const contextMenu = useContextMenu();
 * …
 * <Link {...contextMenu(() => recordMenu(work))} />
 * ```
 *
 * The spec is built at the moment of the click, so a menu never carries a count or a status
 * that went stale between render and right-click.
 */
export function useContextMenu() {
  const { open } = useContextMenuApi();
  return useCallback(
    (build: () => MenuSpec | null) => ({
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        // The innermost row wins, and the event carries on to the document rather than
        // being swallowed: `preventDefault` is the whole signal, and a gate (and the next
        // reader of this code) can see it on the event where it happened.
        if (e.defaultPrevented) return;
        // A menu opened from this row by the Menu key an instant ago; this is that same
        // keypress coming back. Opening a second one under it is not what was asked for.
        if (takeKeyEcho(e)) {
          e.preventDefault();
          return;
        }
        const spec = build();
        if (!spec?.items.length) return; // the document-level suppressor still eats the event
        e.preventDefault();
        open(spec, { x: e.clientX, y: e.clientY }, invokerFor(e.currentTarget));
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
        // Shift+F10 everywhere, and the Menu key on the keyboards that have one.
        if (e.defaultPrevented) return;
        if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) return;
        const spec = build();
        if (!spec?.items.length) return;
        e.preventDefault();
        // Chromium sends a contextmenu event of its own straight after this one; it is the
        // same gesture, and the menu about to open must survive it (see takeKeyEcho).
        expectKeyEcho();
        const box = e.currentTarget.getBoundingClientRect();
        // Under the row's leading edge, where the reader's eye already is — not at 0,0.
        open(spec, { x: box.left + 16, y: box.bottom - 4 }, invokerFor(e.currentTarget));
      },
    }),
    [open]
  );
}

/** Where the focus should land when the menu closes: the row itself, or the link inside it. */
function invokerFor(row: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && row.contains(active)) return active;
  if (row.matches(FOCUSABLE)) return row;
  return row.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * Copy, with the one line of feedback that makes it believable.
 *
 * A copy action with no acknowledgement is indistinguishable from a copy action that
 * failed, and in a webview it sometimes is one — so the toast reports what actually
 * happened rather than assuming.
 *
 * The value may be a *promise for* the value, because not every surface that shows a record
 * has read all of it. A feed line carries an id and a summary, never a title (lib/menus.ts),
 * and the alternative to fetching one on demand is either a menu that is missing an item on
 * some screens or a screen that reads every record it lists in case somebody right-clicks.
 * A read of one file is cheaper than both, and its failure is a sentence rather than a
 * silence.
 */
export function useCopy() {
  const { toast } = useContextMenuApi();
  return useCallback(
    (text: string | (() => Promise<string>), what: string) => {
      void (async () => {
        let value: string;
        try {
          value = typeof text === "string" ? text : await text();
        } catch (err) {
          /* An ApiError from the vault: the same sentence the error card would show,
             in the reader's language, with the marks dropped for a plain toast. */
          toast(plainMarks(vaultErrorMessage(err instanceof Error ? err.message : String(err))), WARN);
          return;
        }
        const ok = await writeClipboard(value);
        toast(ok ? t("menu.copiedWhat", what) : t("menu.copyFailed"), ok ? undefined : WARN);
      })();
    },
    [toast]
  );
}
