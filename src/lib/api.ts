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
  DeletedProject,
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

/**
 * Errors carry the message the backend produced — those messages say how to fix things.
 *
 * Written with a plain field rather than a constructor parameter property so that Node can
 * load this module by stripping its types: `npm run check:errors` imports the real
 * {@link failureKind} and {@link vaultErrorMessage} rather than a copy of them, and a gate
 * that tests a copy tests nothing.
 */
export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * The desktop transport. Note what it cannot give you: a status.
 *
 * A Tauri command answers a failure with a string — `Result<T, String>` in
 * src-tauri/src/lib.rs, whose `Err` is `CoreError`'s Display and nothing else. There is no
 * status code on this side of the app and there never will be; HTTP is the browser's
 * accident, not a fact about a vault. So nothing above this file may ask "was it a 404?" to
 * find out what happened — see {@link failureKind}, which asks the message instead, and is
 * therefore the same answer on both transports.
 */
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

  /**
   * Delete a project — its directory, its records, its event log — from the vault folder.
   *
   * **The only call in this file that takes something away, and the only one no agent can
   * make.** There is no `agentmon project delete` and no MCP tool: an agent appends to this
   * vault. This is reachable from one place in the product, the confirm dialog that will not
   * enable its button until a human has typed the slug (components/DeleteProject.tsx).
   *
   * It answers with what was there a moment before rather than with a record re-read from
   * disk — there is nothing left to read — so the window can name what it removed.
   */
  deleteProject: (project: string, agent = DEFAULT_ACTOR): Promise<DeletedProject> =>
    isTauri()
      ? invokeCommand<DeletedProject>("delete_project", { slug: project, agent })
      : fetchJson<DeletedProject>(
          `/vault-api/projects/${enc(project)}?agent=${enc(agent)}`,
          { method: "DELETE" }
        ),
};

/**
 * Who the app records as the actor when a human — not an agent — writes something.
 *
 * Every event carries an actor, and pretending a person clicking "Create project" is one
 * of the agents would put a name in the feed that never touched the vault.
 */
export const DEFAULT_ACTOR = "app";

/* --------------------------------------------------------------------------
   What a failure was
   ----------------------------------------------------------------------- */

/**
 * What a failed read *was* — one classification, read off the message, not the transport.
 *
 * `no_project` / `no_record` are stale links: the vault is fine and the address is not.
 * `not_here` is the same thing said less precisely (a 404 whose sentence this list has not
 * learned). `unreadable` is the vault actually failing.
 */
export type FailureKind = "no_project" | "no_record" | "bad_address" | "not_here" | "unreadable";

/** `project 'x' not found …` — the shape both backends produce, hint clause or not. */
const NO_PROJECT = /^project '([^']+)' not found\b/;
/** `record 'BUG-9999' not found in project 'x' …` — likewise. */
const NO_RECORD = /^record '([^']+)' not found in project '([^']+)'/;
/** `invalid id 'NOTANID' …` / `invalid project slug 'Bad Slug' …` — an unusable address. */
const BAD_ADDRESS = /^invalid (?:id|project slug) '/;

/**
 * Classify a failure. **The message decides**, and the status only breaks ties.
 *
 * The round-2 shape of this function asked `status !== 404` first, and that one line made
 * the desktop app — the product — answer every stale link with "could not read the vault",
 * because {@link invokeCommand} has no status to give it and never had: Tauri commands
 * return `Result<T, String>`. Browser mode, whose `fetchJson` attaches `res.status`, said
 * "this project has no BUG-9999" for the identical condition. One condition, two sentences,
 * one app — and the gate that walks the screens drives the dev server, so it could only ever
 * see the half that was right.
 *
 * The message is the half both transports share. `agentmon-core` (desktop, in-process) and
 * `scripts/vault-fs.mjs` (browser dev server) are separate implementations that print the
 * same sentence for the same condition, deliberately, and {@link vaultErrorMessage} below
 * already relies on exactly that to say those sentences in Korean. So the headline is read
 * off the same place, the two transports cannot disagree, and `npm run check:errors` proves
 * it against the strings the real `agentmon` binary emits — including the two hint clauses
 * that exist only in Rust and that no Playwright gate can reach.
 */
export function failureKind(error: string, status?: number): FailureKind {
  const text = error.trim();
  if (NO_PROJECT.test(text)) return "no_project";
  if (NO_RECORD.test(text)) return "no_record";
  if (BAD_ADDRESS.test(text)) return "bad_address";
  return status === 404 ? "not_here" : "unreadable";
}

/**
 * What a failed read actually was, in the reader's words rather than the transport's.
 *
 * A missing record is not "could not read the vault", it is "that is not here": a reader who
 * follows a link to `BUG-9999` and is told the vault is unreadable goes and checks their
 * disk, when the truth is that the link is stale.
 *
 * *In the reader's words* means in the reader's language too. This function used to return
 * four English literals while their Korean twins sat unused in the dictionary, so five of
 * the six screens answered a bad link with "This project has no WORK-9999" under a Korean
 * sidebar, and /projects — which called `t("vault.readFailed")` itself — answered the same
 * failure in Korean. One condition, two languages, one app.
 */
export function failureTitle(error: string, status: number | undefined, id?: string): string {
  switch (failureKind(error, status)) {
    case "no_project":
      return t("vault.noProject", NO_PROJECT.exec(error.trim())![1]);
    case "no_record":
      /* The id in the message is the record that was asked for, which is the record the
         reader clicked; `id` is the route's own copy of it, and only the list screens (which
         are not looking up a record) lack one. */
      return t("vault.noRecord", id ?? NO_RECORD.exec(error.trim())![1]);
    case "bad_address":
      /* Nothing was missing: the address cannot name a record at all. Saying "could not read
         the vault" over a body that says which form an id takes blames the disk for a typo. */
      return t("vault.badAddress");
    case "not_here":
      return id ? t("vault.noRecord", id) : t("vault.notInThisVault");
    default:
      return t("vault.readFailed");
  }
}

/**
 * True when a retry could not possibly help — so the screen offers no retry button.
 *
 * The record is not in the vault, or the address could never have named one: the button
 * would re-ask a question that has been answered, and offering it tells the reader the app
 * is unsure. False for an unreadable vault, which a second later often is not.
 *
 * Screens used to spell this `status === 404` inline, five times, which is the same
 * transport bug as the headline had and shipped in the same window: the desktop app offered
 * "다시 시도" under a record that will never exist.
 */
export function nothingToRetry(error: string, status?: number): boolean {
  return failureKind(error, status) !== "unreadable";
}

/**
 * The one failed *background* refresh a project-scoped screen may not sit through: the
 * project itself is not in the vault any more.
 *
 * Everything else a refresh can fail with — a dev server restarting, a record caught
 * mid-write, a vault folder renamed — leaves the last good screen exactly where it was,
 * because the reader is reading and one missed poll is not news (useAsync, and the shell's
 * one line above the page). This is different in kind: a work list, a bug board and a
 * dashboard are lists *of a project*, and when that folder leaves the disk every row on
 * them names a file that is not there. Left alone the window contradicts itself — its own
 * sidebar has already dropped the project while the pane beside it goes on counting twelve
 * work logs, indefinitely (P12 round 2 critic, measured on both transports). So the three
 * list screens turn this one into the screen the app already draws for a stale project
 * link, and a *record* page keeps its copy with `StaleRecordBar` over it: there the reader
 * still has the thing they came to read.
 *
 * Read off the message via {@link failureKind}, so it is the same answer in the desktop
 * app — which has no status to give — as in browser mode. Deliberately not `not_here`: that
 * is the fallback for a 404 whose sentence this file has not learned, it can only ever be
 * reached on the transport that carries statuses, and a branch that nukes a screen in the
 * browser while keeping it on the desktop is the transport split this file exists to avoid.
 */
export function projectGone(refreshError: string | undefined, status?: number): boolean {
  return refreshError !== undefined && failureKind(refreshError, status) === "no_project";
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
 * learned yet.
 *
 * Two gates say that out loud, and it takes both. `npm run check:i18n` reads the rendered
 * screens, which is the only way to catch a string that never reaches this function — but it
 * drives the dev server, so every clause `agentmon-core` adds and the middleware does not
 * (the `(expected file …)` and `(run \`agentmon project list\` …)` hints) is invisible to it.
 * `npm run check:errors` closes that half: it runs the real `agentmon` binary, takes the
 * sentences it actually prints, and reads them through this list.
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
  /* These two arrive with a hint clause on the desktop and without one in browser mode —
     `agentmon-core` appends it, `scripts/vault-fs.mjs` does not. The hint is handed to the
     dictionary rather than concatenated onto its answer, so the sentence boundary between
     the two clauses is decided in the file that knows how the language ends a sentence. */
  [
    /^project '([^']+)' not found in vault (.+?)(?: \(run (.+?) to see projects\))?\.?$/s,
    (m) =>
      t("err.projectNotFound", m[1], code(m[2]), m[3] ? t("err.projectListHint", code(m[3])) : ""),
  ],
  [
    /^record '([^']+)' not found in project '([^']+)'(?: \(expected file (.+?)\))?\.?$/s,
    (m) => t("err.recordNotFound", m[1], m[2], m[3] ? t("err.expectedFile", code(m[3])) : ""),
  ],
  /* both transports: an address that cannot be a record at all */
  /* browser: checkSlug() in scripts/vault-fs.mjs */
  [
    /^invalid project slug '([^']*)': expected lowercase letters.*$/s,
    (m) => t("err.badSlug", m[1]),
  ],
  /* desktop: CoreError::InvalidId — which is *also* what a bad project slug arrives as
     (validate_slug in crates/agentmon-core/src/vault.rs), and which words itself "expected
     the form X" where the middleware says "expected X". Both are matched: this pair spent a
     round untranslated, English under a Korean headline, on the desktop only. */
  [
    /^invalid id '([^']*)': expected the form lowercase letters, digits.*$/s,
    (m) => t("err.badSlug", m[1]),
  ],
  [
    /^invalid id '([^']*)': expected (?:the form )?(.+?) \(e\.g\. (.+?)\)\.?$/s,
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
