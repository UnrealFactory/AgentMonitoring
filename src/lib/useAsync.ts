import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
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
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(undefined);
    setStatus(undefined);
    loaderRef
      .current()
      .then((value) => {
        if (id !== runId.current) return;
        setData(value);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== runId.current) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus(statusOf(err));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, status, loading, reload };
}
