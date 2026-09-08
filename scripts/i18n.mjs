/** 앱과 같은 한국어 문구를 사용하여 화면을 검사합니다. */
import { ko } from "../src/lib/i18n/ko.ts";

export const DICTS = { ko };
export const LOCALES = ["ko"];

/** One word of app chrome, in the language a gate is walking. */
export function t(locale, key, ...args) {
  const value = (DICTS[locale] ?? ko)[key];
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
