/**
 * The data layer. One API, two transports:
 *
 *   desktop  — Tauri `invoke("list_worklogs", { project })`  (src-tauri/src/lib.rs)
 *   browser  — `fetch("/vault-api/projects/<slug>/worklogs")` (vite.config.ts middleware)
 *
 * Both read the same vault directory and return the same JSON, so nothing above this
 * file knows or cares which one is live. Browser mode exists so the UI can be driven by
 * Playwright without building the desktop app; the desktop app is the product.
 */
import type {
  BugDetail,
  BugSummary,
  Project,
  ProjectStatusSnapshot,
  VaultEvent,
  VaultInfo,
  WorklogDetail,
  WorklogSummary,
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" &&
  (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined);

export const transport = (): "tauri" | "browser" => (isTauri() ? "tauri" : "browser");

/** Errors carry the message the backend produced — those messages say how to fix things. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function invokeCommand<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return (await invoke<T>(cmd, args)) as T;
  } catch (err) {
    throw new ApiError(typeof err === "string" ? err : String(err));
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new ApiError(
      `could not reach the vault API at ${path} — is the dev server running? (${String(err)})`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* keep the raw body */
    }
    throw new ApiError(message || `${res.status} ${res.statusText}`, res.status);
  }
  return JSON.parse(text) as T;
}

/** Pick a transport for one call. `args` feed the Tauri command, `path` the HTTP route. */
function call<T>(cmd: string, args: Record<string, unknown>, path: string): Promise<T> {
  return isTauri() ? invokeCommand<T>(cmd, args) : fetchJson<T>(path);
}

const enc = encodeURIComponent;

export const api = {
  vaultInfo: () => call<VaultInfo>("get_vault_info", {}, "/vault-api/vault"),

  listProjects: () => call<Project[]>("list_projects", {}, "/vault-api/projects"),

  getProject: (project: string) =>
    call<Project>("get_project", { project }, `/vault-api/projects/${enc(project)}`),

  listWorklogs: (project: string) =>
    call<WorklogSummary[]>(
      "list_worklogs",
      { project },
      `/vault-api/projects/${enc(project)}/worklogs`
    ),

  getWorklog: (project: string, id: string) =>
    call<WorklogDetail>(
      "get_worklog",
      { project, id },
      `/vault-api/projects/${enc(project)}/worklogs/${enc(id)}`
    ),

  listBugs: (project: string) =>
    call<BugSummary[]>("list_bugs", { project }, `/vault-api/projects/${enc(project)}/bugs`),

  getBug: (project: string, id: string) =>
    call<BugDetail>(
      "get_bug",
      { project, id },
      `/vault-api/projects/${enc(project)}/bugs/${enc(id)}`
    ),

  listEvents: (project: string, limit?: number) =>
    call<VaultEvent[]>(
      "list_events",
      { project, limit: limit ?? null },
      `/vault-api/projects/${enc(project)}/events${limit ? `?limit=${limit}` : ""}`
    ),

  getStatus: (project: string) =>
    call<ProjectStatusSnapshot>(
      "get_status",
      { project },
      `/vault-api/projects/${enc(project)}/status`
    ),

  /**
   * Point the app at a vault somewhere else on disk (portability). Desktop only —
   * the browser dev server serves whatever vault it was started with.
   */
  setVaultPath: async (path: string): Promise<VaultInfo> => {
    if (!isTauri()) {
      throw new ApiError(
        "switching vaults is only available in the desktop app; in browser mode set AGENTMON_VAULT before `npm run dev`"
      );
    }
    return invokeCommand<VaultInfo>("set_vault_path", { path });
  },
};

/**
 * Subscribe to vault changes. In the desktop app this will be backed by the Tauri
 * filesystem watcher; in browser mode there is nothing to listen to, so it is a no-op.
 * Returns an unsubscribe function.
 */
export async function subscribeVaultChanges(onChange: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen("vault-changed", () => onChange());
  } catch {
    return () => {};
  }
}
