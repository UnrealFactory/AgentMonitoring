/**
 * The app's language, and the one function that reads it.
 *
 * Hand-rolled on purpose — no i18n dependency. What a library would give us here is plural
 * rules, message parsing and a loader; this app needs none of the three. Korean has no
 * plural agreement, every message is a TypeScript function with real parameters (so the
 * compiler checks the arguments, which a `{count, plural, ...}` string never can), and both
 * dictionaries are two small modules bundled with the window.
 *
 * ```ts
 * t("nav.dashboard")                 // "대시보드"
 * t("word.inProgressOf", 2, 12)      // "12개 중 2개 진행 중"
 * ```
 *
 * `t` reads a module-level locale rather than a React context, so the same call works in
 * lib/words.ts, lib/format.ts and lib/dashboard.ts — none of which are components. The
 * re-render is arranged once, at the root: `AppProvider` subscribes with {@link useLocale},
 * so changing the language repaints the whole window, which is exactly the scope of the
 * change.
 *
 * ## The one rule that costs you a round if you break it
 *
 * **A repaint is not a recompute.** Anything held across renders — a `useMemo`, a value
 * cached in a module — keeps whatever words it was built with, and the whole window
 * repainting around it does not touch it. So:
 *
 *   * a pure module (lib/dashboard.ts) returns **keys and numbers**, never `t(...)` output,
 *     when the result is something a page will memoize; the page says the words as it draws
 *     them, and cannot get this wrong;
 *   * a `useMemo` in a component that *does* call `t` takes `useLocale()` in its dependency
 *     list, beside the data.
 *
 * Neither is theoretical. Both halves of it shipped: a Korean dashboard kept an English
 * "started 16 · done 16 · notes 30" in its 24-hour line and an English "Today" over its
 * feed, and a record's contents rail stayed in the language it was first drawn in, because
 * the memos that made them listed the events and the clock and not the language (P9 round 1
 * critic). `npm run check:i18n` now reaches those screens *by pressing the toggle*, so the
 * next one of these fails a gate instead of a reader.
 *
 * ## Where the choice is kept
 *
 *   * `?lang=ko|en` in the address — wins for this window, and is written through to the
 *     store below so a reload keeps it. This is also how the gates walk both languages.
 *   * `localStorage` — the browser's answer, and the desktop webview's fast path.
 *   * `settings.json` — the desktop app's own file, next to the vault path it already
 *     remembers (src-tauri/src/lib.rs). Read once at boot and mirrored into localStorage,
 *     so the second run of the app never flashes the wrong language.
 *   * Default: **Korean**.
 */
import { useSyncExternalStore } from "react";
import { en, type Dict, type Key } from "./en";
import { ko } from "./ko";

export type Locale = "ko" | "en";

export const LOCALES: Locale[] = ["ko", "en"];
export const DEFAULT_LOCALE: Locale = "ko";

const DICTS: Record<Locale, Dict> = { ko, en };

/** Where the browser (and the desktop webview) remembers the reader's choice. */
const STORAGE_KEY = "agentmon.locale";

const isLocale = (value: unknown): value is Locale =>
  value === "ko" || value === "en";

function fromUrl(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const value = new URLSearchParams(window.location.search).get("lang");
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function fromStorage(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function remember(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* A webview with storage denied still switches for this session. */
  }
}

let current: Locale = fromUrl() ?? fromStorage() ?? DEFAULT_LOCALE;
if (typeof document !== "undefined") document.documentElement.lang = current;
// A ?lang= that was obeyed is also a choice: it must survive the first navigation, which
// react-router makes by dropping the query string.
if (fromUrl()) remember(current);

const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;

/** The other language — what the toggle offers. */
export const otherLocale = (locale: Locale = current): Locale => (locale === "ko" ? "en" : "ko");

export function setLocale(next: Locale, { persist = true } = {}): void {
  if (!isLocale(next) || next === current) return;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (persist) {
    remember(next);
    void saveLocaleToDesktop(next);
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to the language. One call at the root repaints the whole app. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/* --------------------------------------------------------------------------
   The desktop app's own file
   ----------------------------------------------------------------------- */

/**
 * settings.json holds the vault the human chose; the language goes in beside it.
 *
 * Loaded once, after boot, and only when the address bar did not already decide: a window
 * opened with `?lang=en` is answering a question the file does not get to re-answer. The
 * value is mirrored into localStorage on the way in, so every later start of the app reads
 * it synchronously and no reader ever sees the language change under them.
 */
export async function loadDesktopLocale(): Promise<void> {
  if (typeof window === "undefined" || fromUrl()) return;
  const { api, isTauri } = await import("../api");
  if (!isTauri()) return;
  try {
    const saved = await api.getLocale();
    if (isLocale(saved)) {
      remember(saved);
      setLocale(saved, { persist: false });
    }
  } catch {
    /* No settings file yet, or an old build with no such command: keep the default. */
  }
}

async function saveLocaleToDesktop(locale: Locale): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { api, isTauri } = await import("../api");
    if (!isTauri()) return;
    await api.setLocale(locale);
  } catch {
    /* The choice still holds for this window and in localStorage. */
  }
}

/* --------------------------------------------------------------------------
   t()
   ----------------------------------------------------------------------- */

/** The parameters a key takes — `[]` for a plain string, the function's own list otherwise. */
export type Args<K extends Key> = Dict[K] extends (...args: infer A) => string ? A : [];

/**
 * One word of the app's own chrome, in the language on screen.
 *
 * Falls back to English for a key the active dictionary somehow lacks, which the types make
 * impossible at build time and which is still better than printing the key at runtime.
 */
export function t<K extends Key>(key: K, ...args: Args<K>): string {
  const value = (DICTS[current][key] ?? en[key]) as Dict[K];
  return typeof value === "function"
    ? (value as (...a: unknown[]) => string)(...(args as unknown[]))
    : (value as string);
}

export type { Dict, Key };
export { en, ko };
