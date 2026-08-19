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
  ProjectStatus,
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

/**
 * Browser mode can be pointed at another vault for the session with `?vault=<dir>` — the
 * dev-server twin of the desktop app's "Open vault folder…". It is read once, at boot, and
 * carried in sessionStorage from there: react-router drops the query string on the first
 * navigation, and a reader who opened a second vault expects to still be in it after
 * clicking a link.
 */
const VAULT_KEY = "agentmon.vault";

function vaultOverride(): string | null {
  if (typeof window === "undefined" || isTauri()) return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("vault");
    if (fromUrl !== null) {
      if (fromUrl) sessionStorage.setItem(VAULT_KEY, fromUrl);
      else sessionStorage.removeItem(VAULT_KEY);
      return fromUrl || null;
    }
    return sessionStorage.getItem(VAULT_KEY);
  } catch {
    return null;
  }
}

/** Add the session's vault override, if any, to a `/vault-api/...` path. */
function withVault(path: string): string {
  const dir = vaultOverride();
  if (!dir) return path;
  return `${path}${path.includes("?") ? "&" : "?"}vault=${encodeURIComponent(dir)}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withVault(path), {
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
      ...init,
    });
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
   * the browser dev server serves whatever vault it was started with, or the one named
   * by `?vault=<dir>`.
   */
  setVaultPath: async (path: string): Promise<VaultInfo> => {
    if (!isTauri()) {
      throw new ApiError(
        "switching vaults is only available in the desktop app; in browser mode pass ?vault=<dir> or set AGENTMON_VAULT before `npm run dev`"
      );
    }
    return invokeCommand<VaultInfo>("set_vault_path", { path });
  },

  /**
   * Open the native folder picker and switch to the vault the human chose (desktop only).
   * Resolves to the new vault, or to null when the dialog was dismissed.
   */
  chooseVaultFolder: async (): Promise<VaultInfo | null> => {
    if (!isTauri()) throw new ApiError("the folder picker is only available in the desktop app");
    return invokeCommand<VaultInfo | null>("choose_vault_folder", {});
  },

  /**
   * Make a vault in a folder the human picks, and open it — `agentmon init` for somebody
   * who installed the app and has no terminal. Null means the dialog was dismissed.
   */
  createVaultFolder: async (): Promise<VaultInfo | null> => {
    if (!isTauri())
      throw new ApiError(
        "creating a vault from the window is only available in the desktop app; in browser mode run `agentmon init --vault <dir> --name \"<vault name>\"`"
      );
    return invokeCommand<VaultInfo | null>("create_vault_folder", {});
  },

  /**
   * Where the `agentmon` binary is on this machine, when the app ships with one.
   *
   * The installed app puts the CLI beside itself but not on PATH, so a command line that
   * begins `agentmon` is not runnable for the human reading it. Null in browser mode and in
   * dev builds, where the bare name is right.
   */
  cliPath: async (): Promise<string | null> => {
    if (!isTauri()) return null;
    return invokeCommand<string | null>("cli_path", {});
  },

  /**
   * Create a project. Both transports end in the same `agentmon-core` code: the desktop app
   * calls it in-process, and the dev middleware runs the `agentmon` binary, so there is one
   * implementation of a write and browser mode cannot drift from it.
   */
  createProject: (input: {
    slug: string;
    name: string;
    description?: string;
    tags?: string[];
    agent?: string;
  }): Promise<Project> =>
    isTauri()
      ? invokeCommand<Project>("create_project", {
          slug: input.slug,
          name: input.name,
          description: input.description ?? "",
          tags: input.tags ?? [],
          agent: input.agent ?? DEFAULT_ACTOR,
        })
      : fetchJson<Project>("/vault-api/projects", {
          method: "POST",
          body: JSON.stringify({ ...input, agent: input.agent ?? DEFAULT_ACTOR }),
        }),

  /** Archive or unarchive a project (a `project_updated` event, like every other write). */
  setProjectStatus: (
    project: string,
    status: ProjectStatus,
    agent = DEFAULT_ACTOR
  ): Promise<Project> =>
    isTauri()
      ? invokeCommand<Project>("set_project_status", { project, status, agent })
      : fetchJson<Project>(`/vault-api/projects/${enc(project)}/status`, {
          method: "POST",
          body: JSON.stringify({ status, agent }),
        }),
};

/**
 * Who the app records as the actor when a human — not an agent — writes something.
 *
 * Every event carries an actor, and pretending a person clicking "Create project" is one
 * of the agents would put a name in the feed that never touched the vault.
 */
export const DEFAULT_ACTOR = "app";

/**
 * What a failed read actually was, in the reader's words rather than the transport's.
 *
 * Both transports answer a missing record the same way — 404 with a message naming the id
 * or the slug — and that case is not "could not read the vault", it is "that is not here".
 * A reader who follows a link to `BUG-9999` and is told the vault is unreadable goes and
 * checks their disk; the truth is that the link is stale.
 */
export function failureTitle(error: string, status: number | undefined, id?: string): string {
  if (status !== 404) return "Could not read the vault";
  const project = /^project '([^']+)' not found/.exec(error);
  if (project) return `This vault has no project called “${project[1]}”`;
  if (id) return `This project has no ${id}`;
  return "Not in this vault";
}

/**
 * How often browser mode asks the dev server whether the vault moved. The endpoint is a
 * stat walk over a few dozen files, so this is cheap; it is also skipped entirely while
 * the tab is hidden, and asked once immediately when it comes back.
 */
export const POLL_MS = 2_000;

/** Slowest the poll backs off to while the vault keeps failing to answer. */
export const POLL_MAX_MS = 30_000;

/**
 * How often the desktop app checks, from this side, that the vault is still answering.
 *
 * The Rust watchdog (src-tauri/src/lib.rs) is the primary tell: it probes every five
 * seconds, emits `vault-health`, and — the part only it can do — re-arms the file watcher
 * when the directory comes back, because a `notify` handle on a folder that was renamed or
 * unplugged never fires again. This slower beat is the backstop for the case that watchdog
 * cannot report on: the event channel itself. One read of vault.json a quarter-minute is a
 * rounding error, and between the two of them the desktop app can never sit silently on
 * numbers that stopped moving.
 */
export const DESKTOP_HEALTH_MS = 15_000;

/** Whether the vault is answering, and what it said when it stopped. */
export type VaultHealth = { ok: true } | { ok: false; error: string };

/**
 * Subscribe to vault changes. Returns an unsubscribe function.
 *
 * Desktop: the `vault-changed` event the Rust filesystem watcher emits (src-tauri/src/lib.rs).
 * Browser: a poll of `/vault-api/cursor`, which returns one string summarising every record
 * file's size and mtime. Both end in the same callback, so nothing above this file knows
 * which one it is on — and every screen in the app hangs off that one signal, rather than
 * the sidebar refreshing while the dashboard beside it goes on printing yesterday.
 *
 * `onHealth` is the other half of that signal: a poll that fails is the app finding out the
 * vault it is showing can no longer be read, and a reader looking at numbers from four
 * minutes ago is owed that sentence (AppContext turns it into the banner in the shell).
 * Repeated failures also back the poll off towards {@link POLL_MAX_MS}, so a dev server
 * pointed at a directory that is gone is asked twice a minute, not thirty times.
 */
export function subscribeVaultChanges(
  onChange: () => void,
  onHealth?: (health: VaultHealth) => void
): () => void {
  if (isTauri()) {
    let cancelled = false;
    const disposers: (() => void)[] = [];
    const register = (un: () => void) => {
      // Unmounted while the listener was still being registered: drop it immediately
      // rather than leaving an orphan behind.
      if (cancelled) un();
      else disposers.push(un);
    };
    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        register(await listen("vault-changed", () => onChange()));
        /* The desktop's honesty channel, emitted by the Rust watchdog: the vault stopped
           answering, or started again. Same shape as the browser poll's, so the shell
           raises the same banner either way. */
        register(
          await listen<{ ok: boolean; error: string | null }>("vault-health", (event) => {
            onHealth?.(
              event.payload.ok
                ? { ok: true }
                : { ok: false, error: event.payload.error ?? "the vault stopped answering" }
            );
          })
        );
      })
      .catch(() => {});

    /* The honesty half, desktop side (see DESKTOP_HEALTH_MS): a heartbeat read of the
       vault, so a watcher that has quietly stopped firing is a sentence on screen rather
       than numbers that never move again. Same rule as the browser poll — one miss is
       noise, two is the vault not being there — and coming back re-reads everything. */
    let fails = 0;
    const beat = setInterval(async () => {
      try {
        await api.vaultInfo();
        if (fails > 0) onChange();
        fails = 0;
        onHealth?.({ ok: true });
      } catch (err) {
        fails += 1;
        if (fails >= 2) {
          onHealth?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }, DESKTOP_HEALTH_MS);

    return () => {
      cancelled = true;
      clearInterval(beat);
      for (const un of disposers) un();
      disposers.length = 0;
    };
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor: string | null = null;
  let fails = 0;

  const poll = async () => {
    if (stopped) return;
    if (typeof document === "undefined" || !document.hidden) {
      try {
        const next = (await fetchJson<{ cursor: string }>("/vault-api/cursor")).cursor;
        // The first answer only establishes the baseline: the screen was drawn from that
        // same vault a moment ago, and reloading it would be a refresh nobody asked for.
        if (cursor !== null && next !== cursor) onChange();
        cursor = next;
        if (fails > 0) {
          // Back from the dead: re-read everything, because whatever happened while the
          // vault was unreachable did not reach this window.
          onChange();
        }
        fails = 0;
        onHealth?.({ ok: true });
      } catch (err) {
        // One miss is a dev server restarting or a record caught mid-write, and saying so
        // would be noise. A second is the vault not being there.
        fails += 1;
        if (fails >= 2) {
          onHealth?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    if (!stopped) {
      const wait = Math.min(POLL_MS * 2 ** Math.max(0, fails - 1), POLL_MAX_MS);
      timer = setTimeout(poll, wait);
    }
  };

  const onVisible = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      void poll();
    }
  };

  void poll();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}
