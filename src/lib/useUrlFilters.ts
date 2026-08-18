/**
 * Filter state that lives in the URL, for the two triage screens (work, bugs).
 *
 * A board is a place people navigate *from*: they filter to "critical, unassigned", open a
 * record, read it, and press Back — and a board that keeps its filters in `useState` throws
 * that away and drops them back on the default view. The same state in the query string
 * fixes three things at once: Back returns to the view they left, a link to that view can be
 * pasted to somebody else, and a reload does not lose the work of setting it up. That is how
 * every issue tracker a reader has met behaves.
 *
 * Two details that matter:
 *   * defaults are omitted from the URL, so an untouched board is `/p/x/bugs` and not
 *     `/p/x/bugs?tab=open&severity=all&label=all&…`;
 *   * changing a filter *replaces* the history entry rather than pushing one, so a search
 *     box does not bury the previous screen under one entry per keystroke. Opening a record
 *     is the push, and Back lands on the board as it was left.
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type FilterSpec = Record<string, string>;

export type UrlFilters<S extends FilterSpec> = {
  /** Current values: the URL's, falling back to the default for anything absent. */
  values: S;
  /** Set one filter (to its default = remove it from the URL). */
  set: <K extends keyof S & string>(key: K, value: S[K]) => void;
  /**
   * Back to the defaults, leaving `keep` (and any unrelated query parameter) alone. One
   * call, not one per key: two updates in the same tick would both read the same "before".
   */
  reset: (keep?: (keyof S & string)[]) => void;
  /** Is anything set away from its default? `except` skips a key (usually the tab). */
  isDirty: (except?: (keyof S & string)[]) => boolean;
};

/**
 * `defaults` must be a stable object (a module-level constant), not a fresh literal, and
 * so must `allowed` — a module constant for the closed vocabularies (tab, status,
 * severity) or a `useMemo` for the open ones (label, tag, agent, assignee, reporter),
 * which are only known once the project's records are loaded.
 */
export function useUrlFilters<S extends FilterSpec>(
  defaults: S,
  /**
   * The values each filter may take. A **closed** vocabulary (tab, severity) is a
   * constant; an **open** one — the labels, tags and agent names a project happens to
   * contain — has to be passed in from the loaded records, because that is the only place
   * it exists. Both are checked the same way, and for the same reason: a URL is typed by
   * hand and outlives the build that produced it, so `?agent=nova` pasted into a project
   * that has never heard of nova must show the unfiltered board, not an empty one whose
   * menu says "All agents" while the rows say nothing matched.
   *
   * A filter with no entry here accepts anything (the free-text search box).
   */
  allowed: Partial<Record<keyof S & string, readonly string[]>> = {}
): UrlFilters<S> {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const out = { ...defaults } as S;
    for (const key of Object.keys(defaults) as (keyof S & string)[]) {
      const raw = params.get(key);
      if (raw === null) continue;
      const permitted = allowed[key];
      if (permitted && !permitted.includes(raw)) continue;
      out[key] = raw as S[keyof S & string];
    }
    return out;
  }, [params, defaults, allowed]);

  const set = useCallback(
    <K extends keyof S & string>(key: K, value: S[K]) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === defaults[key] || value === "") next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true }
      );
    },
    [setParams, defaults]
  );

  const reset = useCallback(
    (keep: (keyof S & string)[] = []) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const key of Object.keys(defaults)) {
            if (!keep.includes(key as keyof S & string)) next.delete(key);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams, defaults]
  );

  const isDirty = useCallback(
    (except: (keyof S & string)[] = []) =>
      (Object.keys(defaults) as (keyof S & string)[]).some(
        (key) => !except.includes(key) && values[key] !== defaults[key]
      ),
    [values, defaults]
  );

  return { values, set, reset, isDirty };
}
