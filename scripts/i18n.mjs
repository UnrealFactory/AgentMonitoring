/**
 * The app's dictionaries, for the gates.
 *
 * A gate that reaches for a control by the words on it ("Filter by severity") tests one
 * language and silently stops testing the other — and the app ships in two. So the gates
 * read the same two modules the window reads (node 24 strips the types), and ask them for
 * whatever the locale under test calls a thing.
 *
 * Two rules for the gates that use this:
 *
 *   * **Prefer a data attribute.** `[role=tab][data-value=all]` is language-proof and does
 *     not care what the tab says; use `t()` only where the *words themselves* are the thing
 *     being checked (an aria-label, a control's current value).
 *   * **Walk both languages** wherever the check is about layout or wording, and pin the
 *     locale with `?lang=` so a run is reproducible whatever the last human clicked.
 */
import { en } from "../src/lib/i18n/en.ts";
import { ko } from "../src/lib/i18n/ko.ts";

export const DICTS = { en, ko };
export const LOCALES = ["ko", "en"];

/** One word of app chrome, in the language a gate is walking. */
export function t(locale, key, ...args) {
  const value = (DICTS[locale] ?? en)[key];
  if (value === undefined) throw new Error(`no i18n key "${key}"`);
  return typeof value === "function" ? value(...args) : value;
}

/** Where the app remembers the reader's language (src/lib/i18n/index.ts). */
export const LOCALE_KEY = "agentmon.locale";

/**
 * Open every page in this context in `locale`.
 *
 * Through storage rather than through `?lang=`: the query string is also where the boards
 * keep their filters, and a gate that asserts "the default view carries no query string"
 * must not be the thing that put one there.
 */
export function useLocale(contextOrPage, locale) {
  return contextOrPage.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* a context with storage denied still runs in the default language */
      }
    },
    [LOCALE_KEY, locale]
  );
}
