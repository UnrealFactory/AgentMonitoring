/**
 * Which half of a record the reader is looking at — the agent area or the human one.
 *
 * Every record carries two areas (SPEC.md, "The human area"): the What/Why/How a machine
 * wrote for the next machine, and the same events retold for a person who was not there.
 * The detail screens draw one of them at a time, and *which* one is a property of the
 * reader, not of the record: somebody reading their way through a week of work should not
 * have to press the same button on every screen.
 *
 * So the choice is one value for the whole window, kept the way {@link ../i18n} keeps the
 * language — a module-level store with `useSyncExternalStore`, so a page that is not a
 * component (a gate, a menu handler) can read it too, and every open record repaints when
 * it changes.
 *
 * Three states, not two. `null` is "the reader has not said", and it is what makes the
 * default per-record rather than global: a record with a human area opens on it, a record
 * without one opens on the agent area, and neither is a choice that outlives the screen.
 * The moment the reader presses a segment it becomes theirs and follows them — including
 * onto records that answer it with an empty state, which is the honest reading of "the
 * choice persists": a reader who asked for the human half is told this record has none,
 * not silently handed the other half.
 *
 * `sessionStorage`, so it survives a reload of the same window (the desktop app reloads on
 * update; the gates navigate by `goto`) and dies with the window, which is exactly the
 * scope SPEC gives it.
 *
 * ## The one thing that is allowed to show the other half without changing that
 *
 * Two places on a record offer the reader the *other* half without being the toggle: the
 * empty box's "read the agent's half" on a record nobody retold, and the correction line on
 * a retelling whose trail is over there. Both are about **this record** — their own words
 * say so — and for a round both called {@link setRecordView}, which is the session-wide
 * setter the toggle uses. So a reader who pinned the human half and walked into one legacy
 * record lost the pin at that record, silently, for the rest of the window: the next record
 * opened on the agent area, and the one after that, with nothing on screen admitting the
 * pin had been thrown away. That is the exact behaviour the paragraph above swears off,
 * undone by the button drawn inside the box that does the telling (D3 round 2 critic).
 *
 * {@link useRecordView} therefore hands back a second way to change what is drawn:
 * `peekAgent()`, a component-local override keyed to the record on screen. It touches no
 * store and notifies nobody, so the session choice is exactly what it was — the next record
 * opens on the half the reader asked for. The screen says so in one line while it lasts
 * (`view.peekNote`), because a control showing "Agent" while the reader's choice is Human
 * is the kind of quiet disagreement this file exists to prevent.
 */
import { useRef, useState, useSyncExternalStore } from "react";

export type RecordView = "agent" | "human";

/** What the reader has chosen this session — `null` until they press a segment. */
export type RecordViewChoice = RecordView | null;

const STORAGE_KEY = "agentmon.recordView";

const isView = (value: unknown): value is RecordView => value === "agent" || value === "human";

function fromStorage(): RecordViewChoice {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return isView(value) ? value : null;
  } catch {
    /* A webview with storage denied still switches for this screen. */
    return null;
  }
}

let chosen: RecordViewChoice = fromStorage();
const listeners = new Set<() => void>();

export const getRecordViewChoice = (): RecordViewChoice => chosen;

export function setRecordView(next: RecordView): void {
  if (!isView(next) || next === chosen) return;
  chosen = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* The choice still holds for this window. */
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The view this record should draw, and the setter the toggle calls.
 *
 * @param hasHuman whether this record carries a human area — the default when the reader
 *                 has not chosen (SPEC: Human when there is one, Agent otherwise). `null`
 *                 while the record is still loading, which is not the same as "it has
 *                 none" and must not be read as one.
 * @param key      the record's id. The default is latched to the *record*, not recomputed
 *                 from every refresh of it: this app is live, so an agent running
 *                 `agentmon work update --human` on a legacy record adds a human area to a
 *                 page somebody is in the middle of reading, and without the latch that
 *                 page would swap itself from the agent's sections to a retelling under
 *                 their eyes, with no click. "Opens on the human area" is a claim about
 *                 opening a record; after that the reader is driving. (Caught by
 *                 scripts/check-live.mjs, which rewrites a note under an open page.)
 */
export function useRecordView(
  hasHuman: boolean | null,
  key?: string
): {
  view: RecordView;
  choice: RecordViewChoice;
  choose: (next: RecordView) => void;
  /**
   * Draw the agent area for **this record only**, leaving the session choice alone — what
   * the empty box's button and the correction line do. Silent no-op semantics on a record
   * already showing the agent area: there is nothing to override.
   */
  peekAgent: () => void;
  /** Whether that override is what is on screen, so the page can say so. */
  peeking: boolean;
} {
  const choice = useSyncExternalStore(subscribe, getRecordViewChoice, getRecordViewChoice);
  /* Derived-from-props state, written during render on purpose: the value must be right on
     the first paint of a record, and an effect lands one paint too late. */
  const latched = useRef<{ key?: string; has: boolean } | null>(null);
  if (hasHuman !== null && (!latched.current || latched.current.key !== key)) {
    latched.current = { key, has: hasHuman };
  }
  const fallback: RecordView = latched.current?.has ? "human" : "agent";
  const chosen: RecordView = choice ?? fallback;

  /* The per-record override, held as the id it was asked for rather than as a boolean: the
     detail screens are one mounted component that the router walks from record to record, so
     a boolean would follow the reader onto the next one. Comparing ids means it expires by
     arithmetic the moment the address changes — and, going back, applies again to the record
     it was asked for, which is what the reader was looking at. */
  const [peeked, setPeeked] = useState<string | null>(null);
  const peeking = chosen === "human" && peeked !== null && peeked === (key ?? "");
  const view: RecordView = peeking ? "agent" : chosen;

  /* The two views are two documents, not two states of one, and the app scrolls inside
     `#main` (lib/useScrollRestoration.ts). A reader half-way down a long agent record who
     asks for the retelling would otherwise land past the end of a much shorter one and see
     the foot of a page they have not read. Each view starts at its own top. */
  const toTop = () => {
    const main = typeof document !== "undefined" ? document.getElementById("main") : null;
    if (main) main.scrollTop = 0;
  };

  return {
    view,
    choice,
    peeking,
    choose: (next: RecordView) => {
      /* Pressing the segment the reader is already on is still a choice, and it is recorded:
         it is how somebody pins the half they want before walking through five records.
         Against what is *on screen*, not against the stored choice: while an override is up
         the reader sees the agent area, and pressing Human is a swap even though the stored
         choice already says human — that press is what takes the override back down. */
      const swapped = next !== view;
      if (peeked !== null) setPeeked(null);
      setRecordView(next);
      if (swapped) toTop();
    },
    peekAgent: () => {
      if (view === "agent") return;
      setPeeked(key ?? "");
      toTop();
    },
  };
}
