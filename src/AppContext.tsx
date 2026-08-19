import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams } from "react-router-dom";
import { api, subscribeVaultChanges, transport, type VaultHealth } from "./lib/api";
import { useAsync } from "./lib/useAsync";
import type { Project, VaultInfo } from "./lib/types";

/**
 * The vault stopped answering while the app was showing it.
 *
 * Distinct from `error`, which means nothing could be read at all and the screen says so
 * where the content would be. This is the other case: there is a screenful of real data,
 * it is no longer being kept current, and without a word about it the reader has no way to
 * tell a quiet vault from an unreachable one.
 */
export interface VaultTrouble {
  message: string;
  /** When the app last had a good answer, for "showing data from …". */
  since: number;
}

interface AppData {
  vault: VaultInfo | undefined;
  projects: Project[];
  loading: boolean;
  error: string | undefined;
  reload: () => void;
  transport: "tauri" | "browser";
  /**
   * Bumped once per vault change (a CLI write, an in-app create, a switch to another
   * vault). Every screen passes it to `useAsync` as the refresh key, so the whole app
   * moves together instead of the sidebar knowing something the page does not.
   */
  vaultNonce: number;
  /** Force that refresh — for a screen that has just written to the vault itself. */
  refresh: () => void;
  /** Set while the vault cannot be read and the app is showing the last good data. */
  trouble: VaultTrouble | null;
}

const Ctx = createContext<AppData | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const vault = useAsync(() => api.vaultInfo(), [], nonce);
  const projects = useAsync(() => api.listProjects(), [], nonce);
  const [health, setHealth] = useState<VaultHealth>({ ok: true });

  /**
   * The one subscription in the app. It lives here rather than in the shell because the
   * nonce it feeds is what every page reads: a listener attached beside the router would
   * refresh the sidebar and leave the screen beside it stale, which is exactly the
   * self-contradiction the P4 critic caught.
   *
   * The second callback is the honesty half: browser mode reports a poll that failed, and
   * either transport reports a refresh that failed, so "the vault went away" is a sentence
   * the app can say instead of a number that quietly stops moving.
   */
  useEffect(() => subscribeVaultChanges(refresh, setHealth), [refresh]);

  const badRead = health.ok ? undefined : health.error;
  const badRefresh = vault.refreshError ?? projects.refreshError;
  const message = badRead ?? badRefresh;

  // When it started, so the banner can say how old the data on screen is. Kept in a ref
  // rather than state: it must not restart the clock on every re-render.
  const troubleSince = useRef<number | null>(null);
  if (message && troubleSince.current === null) troubleSince.current = Date.now();
  if (!message) troubleSince.current = null;
  const trouble = message ? { message, since: troubleSince.current ?? Date.now() } : null;

  // Stable identity: callers subscribe to this, and a function that changed on every load
  // would tear their effects down and rebuild them each time.
  const reload = useCallback(() => {
    vault.reload();
    projects.reload();
  }, [vault.reload, projects.reload]);

  const value = useMemo<AppData>(
    () => ({
      vault: vault.data,
      projects: projects.data ?? [],
      loading: vault.loading || projects.loading,
      error: vault.error ?? projects.error,
      reload,
      transport: transport(),
      vaultNonce: nonce,
      refresh,
      trouble,
    }),
    [
      vault.data,
      vault.loading,
      vault.error,
      projects.data,
      projects.loading,
      projects.error,
      reload,
      nonce,
      refresh,
      trouble?.message,
      trouble?.since,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/**
 * The refresh key every screen's loader takes as its third argument.
 *
 * `useAsync(() => api.listBugs(slug), [slug], useVaultNonce())` is the whole contract: the
 * request is identified by the slug, and re-issued — without a skeleton, without losing
 * scroll — whenever the vault underneath it changes.
 */
export function useVaultNonce(): number {
  return useApp().vaultNonce;
}

/** The project slug from the route, if the current screen is scoped to one. */
export function useProjectSlug(): string | undefined {
  return useParams<{ project: string }>().project;
}

/** The current project record, once the project list has loaded. */
export function useCurrentProject(): Project | undefined {
  const slug = useProjectSlug();
  const { projects } = useApp();
  return projects.find((p) => p.slug === slug);
}
