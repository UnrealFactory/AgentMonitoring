import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Run an async loader and track its state. Results from a stale run (deps changed while
 * a request was in flight) are dropped, so navigating quickly never shows the wrong
 * record. `deps` is the identity of the request, exactly like useEffect's.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const runId = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(undefined);
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
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}
