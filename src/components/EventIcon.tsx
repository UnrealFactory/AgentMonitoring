import type { ReactNode } from "react";
import { tone, type EventTone } from "../lib/dashboard";

/**
 * One glyph per kind of event, in the tone the rest of the app already uses for that kind:
 * blue for work in progress, green for done, orange for a bug, purple for a fix. The
 * icon is never the only thing carrying the meaning — the verb beside it says it in words.
 *
 * Shared by the dashboard's activity feed and the vault-wide feed on the Projects screen,
 * so one event does not get two different glyphs depending on which screen prints it.
 */
export function EventIcon({ type }: { type: string }) {
  const t: EventTone = tone(type);
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  let path: ReactNode;
  if (type === "work_started") path = <path d="M5 3.5 L11 7 L5 10.5 Z" {...stroke} />;
  else if (type === "work_updated") path = <path d="M3.5 4.5 H10.5 M3.5 7 H10.5 M3.5 9.5 H7.5" {...stroke} />;
  else if (type === "work_done" || type === "bug_resolved")
    path = <path d="M3.5 7.2 L6 9.7 L10.5 4.3" {...stroke} strokeWidth={1.8} />;
  else if (type === "work_abandoned") path = <path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" {...stroke} />;
  else if (type === "bug_created")
    path = (
      <path
        d="M7 3.4a1.9 1.9 0 0 1 1.9 1.9v2.6A1.9 1.9 0 0 1 7 9.8a1.9 1.9 0 0 1-1.9-1.9V5.3A1.9 1.9 0 0 1 7 3.4Z M2.6 5.6h2.5 M8.9 5.6h2.5 M2.6 8.2h2.5 M8.9 8.2h2.5"
        {...stroke}
        strokeWidth={1.3}
      />
    );
  else if (type === "bug_claimed") path = <path d="M4 10.5V3.5h6l-1.6 2 1.6 2H4" {...stroke} />;
  else if (type === "bug_commented")
    path = <path d="M2.6 3.6h8.8v5.2H6.2l-2.4 2V8.8H2.6z" {...stroke} strokeWidth={1.3} />;
  else if (type === "bug_closed") path = <path d="M7 2.8v8.4 M3.6 4.4l6.8 5.2" {...stroke} />;
  /* A note is a page with a folded corner; the revision keeps the page and marks the fold,
     and the removal is the page struck through — the record of the note leaving, which is
     the honest half of a removable record. */
  else if (type === "note_created")
    path = <path d="M3.4 2.8h5.2l2 2v6.4H3.4z M8.6 2.8v2h2" {...stroke} strokeWidth={1.3} />;
  else if (type === "note_updated")
    path = (
      <path
        d="M3.4 2.8h5.2l2 2v6.4H3.4z M8.6 2.8v2h2 M5.2 8.8l3.4-3.4 M5.2 8.8h-.9v-.9"
        {...stroke}
        strokeWidth={1.3}
      />
    );
  else if (type === "note_removed")
    path = (
      <path d="M3.4 2.8h5.2l2 2v6.4H3.4z M8.6 2.8v2h2 M4.6 9.4l4.8-4.8" {...stroke} strokeWidth={1.3} />
    );
  else path = <path d="M2.6 4.4h3.4l1 1.4h4.4v5.2H2.6z" {...stroke} strokeWidth={1.3} />;

  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className={`event-icon tone-${t}`}>
      {path}
    </svg>
  );
}
