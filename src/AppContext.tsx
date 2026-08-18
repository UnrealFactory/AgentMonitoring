import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { api, transport } from "./lib/api";
import { useAsync } from "./lib/useAsync";
import type { Project, VaultInfo } from "./lib/types";

interface AppData {
  vault: VaultInfo | undefined;
  projects: Project[];
  loading: boolean;
  error: string | undefined;
  reload: () => void;
  transport: "tauri" | "browser";
}

const Ctx = createContext<AppData | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const vault = useAsync(() => api.vaultInfo(), []);
  const projects = useAsync(() => api.listProjects(), []);

  // Stable identity: the vault watcher subscribes to this, and a reload function that
  // changed on every load would tear the subscription down and rebuild it each time.
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
    }),
    [
      vault.data,
      vault.loading,
      vault.error,
      projects.data,
      projects.loading,
      projects.error,
      reload,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
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
