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
import { t } from "./i18n";
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
    /* Not the backend's sentence — there was no backend. Said here, in the reader's
       language, with the runtime's own words kept verbatim inside it. */
    throw new ApiError(t("err.unreachable", path, String(err)));
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* keep the raw body */
    }
    throw new ApiError(message || t("err.httpStatus", res.status), res.status);
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
    if (!isTauri()) throw new ApiError(t("err.desktopOnlySwitch"));
    return invokeCommand<VaultInfo>("set_vault_path", { path });
  },

  /**
   * Open the native folder picker and switch to the vault the human chose (desktop only).
   * Resolves to the new vault, or to null when the dialog was dismissed.
   */
  chooseVaultFolder: async (): Promise<VaultInfo | null> => {
    if (!isTauri()) throw new ApiError(t("err.desktopOnlyPicker"));
    return invokeCommand<VaultInfo | null>("choose_vault_folder", {});
  },

  /**
   * Make a vault in a folder the human picks, and open it — `agentmon init` for somebody
   * who installed the app and has no terminal. Null means the dialog was dismissed.
   */
  createVaultFolder: async (): Promise<VaultInfo | null> => {
    if (!isTauri()) throw new ApiError(t("err.desktopOnlyCreate"));
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
   * Where `docs/AGENT_MANUAL.md` is on this machine, or null when it is not there.
   *
   * An installed copy ships two executables and no docs directory, so the first screen used
   * to send its reader to a file that does not exist on their disk. It is asked for rather
   * than assumed: the desktop app looks beside its own binary. Browser mode answers without
   * asking, because it can only exist inside this repository — the screens are served by the
   * vault-api middleware in `scripts/vite-vault-api.mjs`, running from the repo root, and
   * the manual is checked in next to it.
   */
  manualPath: async (): Promise<string | null> => {
    if (!isTauri()) return "docs/AGENT_MANUAL.md";
    return invokeCommand<string | null>("manual_path", {});
  },

  /**
   * The language the human last chose, out of the desktop app's `settings.json`.
   *
   * The same file that remembers which vault they opened (src-tauri/src/lib.rs): a
   * preference the app asks for once is a preference it must still have tomorrow. Browser
   * mode answers null — there the choice lives in localStorage, which is the browser's own
   * equivalent and needs no round trip (src/lib/i18n/index.ts).
   */
  getLocale: async (): Promise<string | null> => {
    if (!isTauri()) return null;
    return invokeCommand<string | null>("get_locale", {});
  },

  /** Remember it. Desktop only, for the same reason. */
  setLocale: async (locale: string): Promise<void> => {
    if (!isTauri()) return;
    await invokeCommand<null>("set_locale", { locale });
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
 *
 * *In the reader's words* means in the reader's language too. This function used to return
 * four English literals while their Korean twins sat unused in the dictionary, so five of
 * the six screens answered a bad link with "This project has no WORK-9999" under a Korean
 * sidebar, and /projects — which called `t("vault.readFailed")` itself — answered the same
 * failure in Korean. One condition, two languages, one app.
 */
export function failureTitle(error: string, status: number | undefined, id?: string): string {
  if (status !== 404) return t("vault.readFailed");
  const project = /^project '([^']+)' not found/.exec(error);
  if (project) return t("vault.noProject", project[1]);
  if (id) return t("vault.noRecord", id);
  return t("vault.notInThisVault");
}

/* --------------------------------------------------------------------------
   The sentence under the headline
   ----------------------------------------------------------------------- */

/** A path, an id or a command, marked as the technical token it is. */
const code = (value: string): string => value.trim().replace(/^`|`$/g, "");

/**
 * The backend's diagnosis, matched and re-said in the reader's language.
 *
 * The headline above ({@link failureTitle}) is the app's own sentence; this is the line
 * under it, and it arrives from a place that does not know what language the window is in:
 * `agentmon-core` in Rust (desktop) or `scripts/vault-fs.mjs` (browser dev server), both
 * written in English. Translating it *there* would mean two more copies of the dictionary,
 * in two more languages of implementation, kept in step by nothing.
 *
 * So the shapes are matched here — there are a dozen of them, all authored in this
 * repository — and the parts that are data (paths, slugs, ids, command lines) are carried
 * across untouched. Anything unrecognised is returned exactly as it came: a true sentence
 * in the wrong language is worth more than a confident guess in the right one, and an
 * English string that reaches a Korean screen this way is a message this list has not
 * learned yet, which `npm run check:i18n` says out loud.
 */
export function vaultErrorMessage(message: string): string {
  const text = message.trim();
  for (const [pattern, say] of MESSAGES) {
    const m = pattern.exec(text);
    if (m) return say(m);
  }
  return message;
}

const MESSAGES: [RegExp, (m: RegExpExecArray) => string][] = [
  /* browser: resolveVault() in scripts/vault-fs.mjs — the three ways to have no vault */
  [
    /^no vault\.json in (.+?) \(\?vault=\) — .*?create one with (.+)$/s,
    (m) => t("err.noVaultForQuery", code(m[1]), code(m[2])),
  ],
  [
    /^AGENTMON_VAULT names (.+?), which has no vault\.json — .*?falling back to (.+?)\..*?create a vault there with (.+)$/s,
    (m) => t("err.noVaultForEnv", code(m[1]), code(m[2]), code(m[3])),
  ],
  [
    /^no vault\.json found in (.+?) — set AGENTMON_VAULT.*?create one with (.+)$/s,
    (m) =>
      t(
        "err.noVaultAnywhere",
        m[1]
          .split(" or ")
          .map((dir) => `\`${code(dir)}\``)
          .join(t("err.orJoin")),
        code(m[2])
      ),
  ],
  /* desktop: VaultError::NotFound and the folder picker in src-tauri/src/lib.rs */
  [
    /^no vault found at (.+?): no vault\.json in that directory\. Run (.+?) to create one\.?$/s,
    (m) => t("err.noVaultAt", code(m[1]), t("err.noVaultJsonHint", code(m[2]))),
  ],
  [/^no vault found at (.+?): (.+)$/s, (m) => t("err.noVaultAt", code(m[1]), m[2])],
  [
    /^(.+?) is not a vault: it has no vault\.json\..*?create one there with (.+?)\.?$/s,
    (m) => t("err.notAVault", code(m[1]), code(m[2])),
  ],
  [/^that folder cannot be read: (.+)$/s, (m) => t("err.folderUnreadable", code(m[1]))],
  /* both transports: the record that is not there, with the hint each one adds */
  [
    /^project '([^']+)' not found in vault (.+?)(?: \(run (.+?) to see projects\))?\.?$/s,
    (m) =>
      t("err.projectNotFound", m[1], code(m[2])) +
      (m[3] ? t("err.projectListHint", code(m[3])) : ""),
  ],
  [
    /^record '([^']+)' not found in project '([^']+)'(?: \(expected file (.+?)\))?\.?$/s,
    (m) => t("err.recordNotFound", m[1], m[2]) + (m[3] ? t("err.expectedFile", code(m[3])) : ""),
  ],
  /* both transports: an address that cannot be a record at all */
  [
    /^invalid project slug '([^']*)': expected lowercase letters.*$/s,
    (m) => t("err.badSlug", m[1]),
  ],
  [
    /^invalid id '([^']*)': expected (\S+) \(e\.g\. (\S+?)\)$/s,
    (m) => t("err.badId", m[1], m[2], m[3]),
  ],
  [/^no vault-api (?:write )?route for (.+)$/s, (m) => t("err.noRoute", code(m[1]))],
];

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
                : { ok: false, error: event.payload.error ?? t("err.stoppedAnswering") }
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
