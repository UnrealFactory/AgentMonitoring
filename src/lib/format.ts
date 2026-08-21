/**
 * Formatting helpers. Timestamps in the vault are always UTC ISO8601 strings; the screens
 * print them in the **reader's timezone**, so a note saved at 오후 6:32 in Seoul says
 * 오후 6:32 on screen and matches the file's modified time in Explorer. Tooltips keep the
 * record's exact UTC string ({@link formatDateTimeUtc}) for when two machines must agree.
 *
 * Words live next door in lib/words.ts and lib/i18n — this file turns data into text, those
 * decide what the text is called. Every function here is written twice, once per language,
 * and both halves are hand-assembled from date parts rather than handed to a locale
 * formatter, so only the timezone varies by machine, never the shape of the string.
 */
import { getLocale, t } from "./i18n";

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** "오후 6:32" / "6:32 pm" — local wall-clock time, the way the reader's OS says it. */
const clock12 = (d: Date): string => {
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return getLocale() === "ko"
    ? `${h < 12 ? "오전" : "오후"} ${h12}:${pad(d.getMinutes())}`
    : `${h12}:${pad(d.getMinutes())} ${h < 12 ? "am" : "pm"}`;
};

const EN_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const EN_DATE_UTC = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "18 Aug 2026, 6:32 pm" / "2026년 8월 18일 오후 6:32" — in the reader's timezone. */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return t("time.empty");
  return getLocale() === "ko"
    ? `${formatDate(iso)} ${clock12(d)}`
    : `${EN_DATE.format(d)}, ${clock12(d)}`;
}

/**
 * "18 Aug 2026, 09:12 UTC" — for tooltips: the record's own timestamp, identical on every
 * machine, 24-hour because it is the stored value rather than a wall clock.
 */
export function formatDateTimeUtc(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return t("time.empty");
  const clockUtc = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return getLocale() === "ko"
    ? `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${clockUtc} UTC`
    : `${EN_DATE_UTC.format(d)}, ${clockUtc} UTC`;
}

/** "18 Aug 2026" / "2026년 8월 18일" — the reader's local date. */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return t("time.empty");
  return getLocale() === "ko"
    ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
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
