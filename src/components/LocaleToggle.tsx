/**
 * The language, at the foot of the shell.
 *
 * Two segments rather than a dropdown: there are exactly two languages, both fit in the
 * column, and a menu would hide the one fact this control exists to state — that the other
 * language is there. It is the same segmented control the boards use for their tabs, at the
 * one size the sidebar has room for.
 *
 * Each segment names itself **in its own language** (한국어 / English), which is the rule
 * every language picker worth using keeps: a reader who has landed in the wrong one must be
 * able to find their way out without reading the wrong one.
 *
 * The click applies instantly and everywhere — `setLocale` notifies the store the root
 * subscribes to (src/AppContext.tsx), so the whole window repaints — and is remembered:
 * localStorage in browser mode, `settings.json` beside the vault path in the desktop app
 * (src/lib/i18n/index.ts).
 */
import { LOCALES, setLocale, t, useLocale, type Locale } from "../lib/i18n";

const NAME: Record<Locale, "locale.ko" | "locale.en"> = { ko: "locale.ko", en: "locale.en" };

export function LocaleToggle() {
  const locale = useLocale();
  return (
    <div className="locale-toggle" role="group" aria-label={t("locale.label")}>
      {LOCALES.map((value) => {
        const name = t(NAME[value]);
        return (
          <button
            key={value}
            type="button"
            lang={value}
            data-value={value}
            className={`locale-option${value === locale ? " is-active" : ""}`}
            aria-pressed={value === locale}
            title={t("locale.switchTo", name)}
            onClick={() => setLocale(value)}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
