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

/** `defaults` must be a stable object (a module-level constant), not a fresh literal. */
export function useUrlFilters<S extends FilterSpec>(
  defaults: S,
  /** Values a filter is allowed to take, when it is an enum: anything else is ignored. */
  allowed: Partial<Record<keyof S & string, readonly string[]>> = {}
): UrlFilters<S> {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const out = { ...defaults } as S;
    for (const key of Object.keys(defaults) as (keyof S & string)[]) {
      const raw = params.get(key);
      if (raw === null) continue;
      const permitted = allowed[key];
      // A URL is typed by hand and outlives the build that produced it, so an unknown
      // value is treated as "not set" rather than as a filter nothing can match.
      if (permitted && !permitted.includes(raw)) continue;
      out[key] = raw as S[keyof S & string];
    }
    return out;
    // `allowed` is a literal at the call sites; the params + defaults are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, defaults]);

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
