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
import { api, subscribeProjectChanges, transport, type DataHealth } from "./lib/api";
import { loadDesktopLocale, useLocale, type Locale } from "./lib/i18n";
import { useAsync } from "./lib/useAsync";
import type { Project, ProjectRow } from "./lib/types";

/**
 * The data layer stopped answering while the app was showing it.
 *
 * Distinct from `error`, which means nothing could be read at all and the screen says so
 * where the content would be. This is the other case: there is a screenful of real data,
 * it is no longer being kept current, and without a word about it the reader has no way to
 * tell a quiet project from an unreachable one.
 */
export interface DataTrouble {
  message: string;
  /** When the app last had a good answer, for "showing data from …". */
  since: number;
}

interface AppData {
  /** Every registered project row, available or not — what the Projects screen lists. */
  rows: ProjectRow[];
  /** The readable projects, most recently active first — what the sidebar lists. */
  projects: Project[];
  loading: boolean;
  error: string | undefined;
  reload: () => void;
  transport: "tauri" | "browser";
  /**
   * Bumped once per data change (a CLI write, an in-app create, a registry change).
   * Every screen passes it to `useAsync` as the refresh key, so the whole app moves
   * together instead of the sidebar knowing something the page does not.
   */
  dataNonce: number;
  /** Force that refresh — for a screen that has just written something itself. */
  refresh: () => void;
  /** Set while the data cannot be read and the app is showing the last good copy. */
  trouble: DataTrouble | null;
  /**
   * The language on screen.
   *
   * Held here for the same reason the nonce is: it is a fact the *whole* window depends
   * on. `t()` reads the locale from a module-level store rather than from this context
   * (lib/i18n), so that lib/words.ts and lib/format.ts — which are not components — can
   * call it too; subscribing once at the root is what turns a change to that store into
   * one repaint of every screen, instead of a sidebar in Korean above a board in English.
   */
  locale: Locale;
}

const Ctx = createContext<AppData | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /* The whole window's language, subscribed once. The desktop app's remembered choice
     arrives a beat later, out of settings.json; in browser mode (and on every run after the
     first, because the answer is mirrored into localStorage) it is already right. */
  const locale = useLocale();
  useEffect(() => {
    void loadDesktopLocale();
  }, []);

  const rows = useAsync(() => api.listProjects(), [], nonce);
  const [health, setHealth] = useState<DataHealth>({ ok: true });

  /**
   * The one subscription in the app. It lives here rather than in the shell because the
   * nonce it feeds is what every page reads: a listener attached beside the router would
   * refresh the sidebar and leave the screen beside it stale.
   *
   * The second callback is the honesty half: browser mode reports a poll that failed, and
   * either transport reports a refresh that failed, so "the data went away" is a sentence
   * the app can say instead of a number that quietly stops moving.
   */
  useEffect(() => subscribeProjectChanges(refresh, setHealth), [refresh]);

  const badRead = health.ok ? undefined : health.error;
  const message = badRead ?? rows.refreshError;

  // When it started, so the banner can say how old the data on screen is. Kept in a ref
  // rather than state: it must not restart the clock on every re-render.
  const troubleSince = useRef<number | null>(null);
  if (message && troubleSince.current === null) troubleSince.current = Date.now();
  if (!message) troubleSince.current = null;
  const trouble = message ? { message, since: troubleSince.current ?? Date.now() } : null;

  const value = useMemo<AppData>(() => {
    const allRows = rows.data ?? [];
    return {
      rows: allRows,
      projects: allRows.flatMap((r) => (r.available && r.project ? [r.project] : [])),
      loading: rows.loading,
      error: rows.error,
      reload: rows.reload,
      transport: transport(),
      dataNonce: nonce,
      refresh,
      trouble,
      locale,
    };
  }, [
    rows.data,
    rows.loading,
    rows.error,
    rows.reload,
    nonce,
    refresh,
    trouble?.message,
    trouble?.since,
    locale,
  ]);

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
 * `useAsync(() => api.listBugs(id), [id], useDataNonce())` is the whole contract: the
 * request is identified by the project id, and re-issued — without a skeleton, without
 * losing scroll — whenever the data underneath it changes.
 */
export function useDataNonce(): number {
  return useApp().dataNonce;
}

/** The project id from the route, if the current screen is scoped to one. */
export function useProjectId(): string | undefined {
  return useParams<{ project: string }>().project;
}

/** The current project record, once the project list has loaded. */
export function useCurrentProject(): Project | undefined {
  const id = useProjectId();
  const { projects } = useApp();
  return projects.find((p) => p.id === id);
}
