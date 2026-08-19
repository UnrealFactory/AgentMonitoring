/**
 * Formatting helpers. Timestamps in the vault are always UTC ISO8601 strings.
 *
 * Words live next door in lib/words.ts and lib/i18n — this file turns data into text, those
 * decide what the text is called. Every function here is written twice, once per language,
 * and both halves are built from the record's **UTC** parts rather than from the reader's
 * timezone: the vault is UTC and the screens say so, in Korean as in English.
 */
import { getLocale, t } from "./i18n";

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** "10:20" — the same clock in both languages, because a clock is not a word. */
const clock = (d: Date): string => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

const EN_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "18 Aug 2026, 09:12" / "2026년 8월 18일 09:12" — absolute, unambiguous, and identical on
 * every machine: assembled from UTC parts, never from the reader's locale settings, so a
 * screenshot taken in Seoul and one taken in London hold the same string.
 */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return t("time.empty");
  return getLocale() === "ko"
    ? `${formatDate(iso)} ${clock(d)}`
    : `${EN_DATE.format(d)}, ${clock(d)}`;
}

/** "18 Aug 2026, 09:12 UTC" — for tooltips, where the timezone must be explicit. */
export function formatDateTimeUtc(iso: string | null | undefined): string {
  const text = formatDateTime(iso);
  return text === t("time.empty") ? text : `${text} UTC`;
}

/** "18 Aug 2026" / "2026년 8월 18일" */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return t("time.empty");
  return getLocale() === "ko"
    ? `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
    : EN_DATE.format(d);
}

/** "3h ago" / "3시간 전" / "just now" / "방금" — for feeds, where recency is what matters. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return t("time.empty");
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);

  /* Either side of now is "just now". The app's clock ticks every thirty seconds
     (charts.useNow), so an event an agent wrote a second ago is routinely a few seconds in
     the *future* of the `now` the screen is holding — and the feed printed "in a moment"
     for the line that had just appeared in it. A write cannot be in the future; a stale
     clock can. */
  if (s < 45) return t("time.justNow");

  // Largest unit that still yields a number a human can hold in their head. The unit's own
  // spelling is the dictionary's job — "2h" in English is "2시간" in Korean, and the suffix
  // is not a letter that can be appended to a number.
  const steps: [limit: number, per: number, unit: Unit][] = [
    [90, 60, "time.minutes"], //           < 90s  -> 1m
    [3600, 60, "time.minutes"], //         < 1h   -> Nm
    [86400, 3600, "time.hours"], //        < 1d   -> Nh
    [604800, 86400, "time.days"], //       < 1w   -> Nd
    [2629800, 604800, "time.weeks"], //    < 1mo  -> Nw
    [31557600, 2629800, "time.months"], // < 1y   -> Nmo
  ];
  const step = steps.find(([limit]) => s < limit);
  const text = step
    ? t(step[2], Math.max(1, Math.round(s / step[1])))
    : t("time.years", Math.round(s / 31557600));
  return future ? t("time.in", text) : t("time.ago", text);
}

type Unit = "time.minutes" | "time.hours" | "time.days" | "time.weeks" | "time.months";

/** Elapsed time between two instants, e.g. "1h 47m" / "1시간 47분". */
export function formatDuration(fromIso: string, toIso: string | null): string {
  const from = parse(fromIso);
  const to = parse(toIso) ?? new Date();
  if (!from) return t("time.empty");
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  if (mins < 60) return t("time.durMinutes", mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return mins % 60 ? t("time.durHoursMinutes", hours, mins % 60) : t("time.durHours", hours);
  }
  const days = Math.floor(hours / 24);
  return hours % 24 ? t("time.durDaysHours", days, hours % 24) : t("time.durDays", days);
}

/* Status and severity labels live in lib/words.ts, which is the one place the app's
   vocabulary is decided — a state that has two names is a screen disagreeing with the
   screen beside it. The words themselves are in lib/i18n.

   Event wording and event colour live with the screen that draws them (lib/dashboard.ts):
   they are one vocabulary — the verb, the icon and the tone have to be chosen together —
   and splitting them across two files is how they drift apart. */
