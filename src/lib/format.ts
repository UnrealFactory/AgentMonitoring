/** Formatting helpers. Timestamps in the vault are always UTC ISO8601 strings. */

import type { BugStatus, EventType, Severity, WorkStatus } from "./types";

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

  if (s < 45) return future ? "in a moment" : "just now";

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

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  in_progress: "In progress",
  done: "Done",
  abandoned: "Abandoned",
};

export const BUG_STATUS_LABEL: Record<BugStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const EVENT_LABEL: Record<EventType, string> = {
  work_started: "started work",
  work_updated: "updated work",
  work_done: "finished work",
  work_abandoned: "abandoned work",
  bug_created: "filed a bug",
  bug_claimed: "claimed a bug",
  bug_commented: "commented on a bug",
  bug_resolved: "resolved a bug",
  bug_closed: "closed a bug",
  project_created: "created the project",
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type as EventType] ?? type.replace(/_/g, " ");
}

/** Which accent an event dot gets in the timeline. */
export function eventTone(type: string): "work" | "done" | "bug" | "resolved" | "neutral" {
  if (type === "work_done") return "done";
  if (type.startsWith("work_")) return "work";
  if (type === "bug_resolved" || type === "bug_closed") return "resolved";
  if (type.startsWith("bug_")) return "bug";
  return "neutral";
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
