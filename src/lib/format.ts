/**
 * Formatting helpers. Timestamps in the vault are always UTC ISO8601 strings.
 *
 * Words live next door in lib/words.ts — this file turns data into text, that one decides
 * what the text is called.
 */

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "18 Aug 2026, 09:12" — absolute, unambiguous, no locale surprises in screenshots. */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(d);
}

/** "18 Aug 2026, 09:12 UTC" — for tooltips, where the timezone must be explicit. */
export function formatDateTimeUtc(iso: string | null | undefined): string {
  const text = formatDateTime(iso);
  return text === "—" ? text : `${text} UTC`;
}

/** "18 Aug 2026" */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** "3h ago" / "2d ago" / "just now" — for feeds, where recency is what matters. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return "—";
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);

  /* Either side of now is "just now". The app's clock ticks every thirty seconds
     (charts.useNow), so an event an agent wrote a second ago is routinely a few seconds in
     the *future* of the `now` the screen is holding — and the feed printed "in a moment"
     for the line that had just appeared in it. A write cannot be in the future; a stale
     clock can. */
  if (s < 45) return "just now";

  // Largest unit that still yields a number a human can hold in their head.
  const steps: [limit: number, per: number, suffix: string][] = [
    [90, 60, "m"], //           < 90s  -> 1m
    [3600, 60, "m"], //         < 1h   -> Nm
    [86400, 3600, "h"], //      < 1d   -> Nh
    [604800, 86400, "d"], //    < 1w   -> Nd
    [2629800, 604800, "w"], //  < 1mo  -> Nw
    [31557600, 2629800, "mo"], //< 1y  -> Nmo
  ];
  const step = steps.find(([limit]) => s < limit);
  const text = step ? `${Math.max(1, Math.round(s / step[1]))}${step[2]}` : `${Math.round(s / 31557600)}y`;
  return future ? `in ${text}` : `${text} ago`;
}

/** Elapsed time between two instants, e.g. "1h 47m". */
export function formatDuration(fromIso: string, toIso: string | null): string {
  const from = parse(fromIso);
  const to = parse(toIso) ?? new Date();
  if (!from) return "—";
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

/* Status and severity labels moved to lib/words.ts, which is the one place the app's
   vocabulary is decided — a state that has two names is a screen disagreeing with the
   screen beside it.

   Event wording and event colour live with the screen that draws them (lib/dashboard.ts):
   they are one vocabulary — the verb, the icon and the tone have to be chosen together —
   and splitting them across two files is how they drift apart. */

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
