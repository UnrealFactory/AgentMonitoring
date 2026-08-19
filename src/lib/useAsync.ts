import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  /**
   * A *background* refresh that failed while the screen kept its last good data.
   *
   * Not an error state — nothing on screen changes — but not nothing either: without it a
   * board whose vault went unreadable freezes on stale numbers forever with no tell. The
   * shell turns it into one line above the page (AppContext, App.tsx).
   */
  refreshError: string | undefined;
  /**
   * The status the failure carried, when it carried one — 404 for a record or project
   * that is not in the vault. Screens use it to say what actually happened instead of
   * blaming the vault for a link that outlived its record.
   */
  status: number | undefined;
  loading: boolean;
  reload: () => void;
}

/** Duck-typed on purpose: this hook knows nothing about the transport that threw. */
function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null || !("status" in err)) return undefined;
  const raw = (err as { status?: unknown }).status;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

/**
 * Run an async loader and track its state. Results from a stale run (deps changed while
 * a request was in flight) are dropped, so navigating quickly never shows the wrong
 * record. `deps` is the identity of the request, exactly like useEffect's.
 *
 * `refreshKey` is the *same* request asked again — the vault changed under an open screen
 * (see AppContext's vault nonce). That is a different event from a navigation and has to
 * look different: a navigation may show a skeleton, because the reader asked for another
 * thing and nothing on screen is true any more; a refresh must not, because the reader is
 * reading. So a refresh keeps the rendered data and the loading flag exactly where they
 * are, swaps the values in when they arrive, and — if the vault is momentarily unreadable
 * (a dev server restarting, a record mid-write) — keeps the last good screen rather than
 * replacing a page somebody is reading with an error.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  refreshKey = 0
): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refreshError, setRefreshError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  /** The identity of the last request actually issued, for telling a refresh from a load. */
  const lastDeps = useRef<unknown[] | null>(null);
  const lastNonce = useRef(nonce);
  const settled = useRef(false);

  useEffect(() => {
    const changed =
      lastDeps.current === null ||
      lastDeps.current.length !== deps.length ||
      deps.some((d, i) => !Object.is(d, (lastDeps.current as unknown[])[i]));
    // A refresh is: same request, same manual-reload nonce, and something already on
    // screen to keep. Anything else is a load.
    const refresh = !changed && nonce === lastNonce.current && settled.current;
    lastDeps.current = deps;
    lastNonce.current = nonce;

    const id = ++runId.current;
    if (!refresh) {
      setLoading(true);
      setError(undefined);
      setStatus(undefined);
    }
    loaderRef
      .current()
      .then((value) => {
        if (id !== runId.current) return;
        settled.current = true;
        setData(value);
        setError(undefined);
        setRefreshError(undefined);
        setStatus(undefined);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== runId.current) return;
        // A background refresh that failed leaves the screen as it was: the reader did
        // not ask for anything, so nothing they are looking at should change — but the
        // shell says so in one line, rather than letting stale numbers pass for current.
        if (refresh) {
          setRefreshError(err instanceof Error ? err.message : String(err));
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus(statusOf(err));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, refreshKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, refreshError, status, loading, reload };
}
