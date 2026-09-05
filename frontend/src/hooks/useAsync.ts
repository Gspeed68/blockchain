import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "success"; data: T };

/**
 * Small fetch-on-mount hook shared by every page. Every consumer gets an
 * explicit loading/error/success state to render — the project brief calls
 * for handling those "properly rather than silently", so there's no
 * component in this app that just renders `undefined` while data loads.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fn()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { ...state, reload };
}
