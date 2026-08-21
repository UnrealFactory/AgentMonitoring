/**
 * The data layer. One API, two transports:
 *
 *   desktop  — Tauri `invoke("list_worklogs", { id })`            (src-tauri/src/lib.rs)
 *   browser  — `fetch("/project-api/projects/<id>/worklogs")`     (vite.config.ts middleware)
 *
 * Both read the same AgentMonitoring folders and return the same JSON, so nothing above
 * this file knows or cares which one is live. Browser mode exists so the UI can be driven
 * by Playwright without building the desktop app; the desktop app is the product.
 */
import { t } from "./i18n";
import type {
  BugDetail,
  BugSummary,
  DeletedProject,
  FeedbackItem,
  FeedbackStatus,
  NoteDetail,
  NoteSummary,
  Project,
  ProjectRow,
  ProjectStatusSnapshot,
  VaultEvent,
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
 * {@link failureKind} and {@link projectErrorMessage} rather than a copy of them, and a
 * gate that tests a copy tests nothing.
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
 * accident, not a fact about a folder of records. So nothing above this file may ask "was
 * it a 404?" to find out what happened — see {@link failureKind}, which asks the message
 * instead, and is therefore the same answer on both transports.
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
 * Browser mode can be pointed at other project folders for the session with
 * `?dirs=<folder;folder>` — the dev-server twin of the desktop app's registry. It is read
 * once, at boot, and carried in sessionStorage from there: react-router drops the query
 * string on the first navigation, and a reader who opened another project set expects to
 * still be in it after clicking a link.
 */
const DIRS_KEY = "agentmon.dirs";

function dirsOverride(): string | null {
  if (typeof window === "undefined" || isTauri()) return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("dirs");
    if (fromUrl !== null) {
      if (fromUrl) sessionStorage.setItem(DIRS_KEY, fromUrl);
      else sessionStorage.removeItem(DIRS_KEY);
      return fromUrl || null;
    }
    return sessionStorage.getItem(DIRS_KEY);
  } catch {
    return null;
  }
}

/** Add the session's dirs override, if any, to a `/project-api/...` path. */
function withDirs(path: string): string {
  const dirs = dirsOverride();
  if (!dirs) return path;
  return `${path}${path.includes("?") ? "&" : "?"}dirs=${encodeURIComponent(dirs)}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withDirs(path), {
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

/** The blob's content-type for a referenced image, from its extension — the same
 *  whitelist the backends enforce (`ASSET_EXTENSIONS` in agentmon-core). */
function assetMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    }[ext] ?? "application/octet-stream"
  );
}

export const api = {
  /** Every registered project, available or not, most recently active first. */
  listProjects: () => call<ProjectRow[]>("list_projects", {}, "/project-api/projects"),

  getProject: (id: string) =>
    call<Project>("get_project", { id }, `/project-api/projects/${enc(id)}`),

  listWorklogs: (id: string) =>
    call<WorklogSummary[]>(
      "list_worklogs",
      { id },
      `/project-api/projects/${enc(id)}/worklogs`
    ),

  getWorklog: (id: string, record: string) =>
    call<WorklogDetail>(
      "get_worklog",
      { id, record },
      `/project-api/projects/${enc(id)}/worklogs/${enc(record)}`
    ),

  listBugs: (id: string) =>
    call<BugSummary[]>("list_bugs", { id }, `/project-api/projects/${enc(id)}/bugs`),

  getBug: (id: string, record: string) =>
    call<BugDetail>(
      "get_bug",
      { id, record },
      `/project-api/projects/${enc(id)}/bugs/${enc(record)}`
    ),

  listNotes: (id: string) =>
    call<NoteSummary[]>("list_notes", { id }, `/project-api/projects/${enc(id)}/notes`),

  getNote: (id: string, record: string) =>
    call<NoteDetail>(
      "get_note",
      { id, record },
      `/project-api/projects/${enc(id)}/notes/${enc(record)}`
    ),

  listEvents: (id: string, limit?: number) =>
    call<VaultEvent[]>(
      "list_events",
      { id, limit: limit ?? null },
      `/project-api/projects/${enc(id)}/events${limit ? `?limit=${limit}` : ""}`
    ),

  getStatus: (id: string) =>
    call<ProjectStatusSnapshot>(
      "get_status",
      { id },
      `/project-api/projects/${enc(id)}/status`
    ),

  /**
   * A source `<img>` can load for a file a record body references
   * (`![alt](assets/diagram.svg)` → a file inside the project's AgentMonitoring folder).
   *
   * The transports answer differently on purpose. Browser mode gets a URL the dev
   * middleware serves the bytes at, and the tag streams it like any image. The desktop
   * has no HTTP: the bytes come over IPC (`get_record_asset`, a raw `ipc::Response` so a
   * PNG is not base64'd through serde) and become a blob URL — which the caller must
   * revoke, and which is why this returns a pair and not a string. Path safety is
   * agentmon-core's `Store::asset` on both sides: relative, inside the folder after
   * symlinks, image extensions only.
   */
  recordAssetSrc: async (
    id: string,
    path: string
  ): Promise<{ url: string; revoke: () => void }> => {
    if (!isTauri()) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      return {
        url: withDirs(`/project-api/projects/${enc(id)}/files/${encoded}`),
        revoke: () => {},
      };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    let bytes: ArrayBuffer;
    try {
      bytes = (await invoke("get_record_asset", { id, path })) as ArrayBuffer;
    } catch (err) {
      throw new ApiError(typeof err === "string" ? err : String(err));
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: assetMime(path) }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  },

  /**
   * The location picker for the New project dialog (desktop only): the folder the human
   * chose — typically a code repo root — or null when the dialog was dismissed. Nothing
   * is written until {@link api.createProject}.
   */
  pickProjectLocation: async (): Promise<string | null> => {
    if (!isTauri()) throw new ApiError(t("err.desktopOnlyPicker"));
    return invokeCommand<string | null>("pick_project_location", {});
  },

  /**
   * Create a project: an `AgentMonitoring` folder inside `location`. Both transports end
   * in the same `agentmon-core` code: the desktop app calls it in-process, and the dev
   * middleware runs the `agentmon` binary, so there is one implementation of a write and
   * browser mode cannot drift from it.
   */
  createProject: (input: {
    location: string;
    name: string;
    description?: string;
    tags?: string[];
    agent?: string;
    /** Also write agent instructions to `<location>/CLAUDE.md`, in this language. */
    claudeMd?: "ko" | "en";
    /** Also write `<location>/.mcp.json` registering the agentmon MCP server. */
    mcpJson?: boolean;
    /** Default agent handle inside that registration; a call can override it. */
    mcpAgent?: string;
  }): Promise<Project> =>
    isTauri()
      ? invokeCommand<Project>("create_project", {
          location: input.location,
          name: input.name,
          description: input.description ?? "",
          tags: input.tags ?? [],
          agent: input.agent ?? DEFAULT_ACTOR,
          claudeMd: input.claudeMd ?? null,
          mcpJson: input.mcpJson ?? false,
          mcpAgent: input.mcpAgent ?? null,
        })
      : fetchJson<Project>("/project-api/projects", {
          method: "POST",
          body: JSON.stringify({ ...input, agent: input.agent ?? DEFAULT_ACTOR }),
        }),

  /**
   * The App feedback board: bugs and wishes agents filed about this app itself.
   * Machine-level (`~/.AgentMonitoring/feedback`), so no project id anywhere — the
   * browser transport shells the same CLI the desktop calls in-process.
   */
  listAppFeedback: (): Promise<FeedbackItem[]> =>
    isTauri()
      ? invokeCommand<FeedbackItem[]>("list_app_feedback", {})
      : fetchJson<FeedbackItem[]>("/project-api/app-feedback"),

  /** The human working the board: mark an item handled, or put it back. */
  setAppFeedbackStatus: (id: string, status: FeedbackStatus): Promise<FeedbackItem> =>
    isTauri()
      ? invokeCommand<FeedbackItem>("set_app_feedback_status", { id, status })
      : fetchJson<FeedbackItem>(`/project-api/app-feedback/${encodeURIComponent(id)}/status`, {
          method: "POST",
          body: JSON.stringify({ status }),
        }),

  /**
   * Delete a **done** item for good — clearing a worked board. The backend refuses
   * while the item is still open: the path is always done-then-delete, so a complaint
   * can never vanish unread. Agents get the same verb (`agentmon app-feedback delete`)
   * because the owner delegates the cleanup.
   */
  deleteAppFeedback: (id: string): Promise<FeedbackItem> =>
    isTauri()
      ? invokeCommand<FeedbackItem>("delete_app_feedback", { id })
      : fetchJson<FeedbackItem>(`/project-api/app-feedback/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),

  /**
   * Open an existing project: the native picker, then register + show it (desktop only).
   * Null means the dialog was dismissed.
   */
  openProject: async (): Promise<Project | null> => {
    if (!isTauri()) throw new ApiError(t("err.desktopOnlyOpen"));
    return invokeCommand<Project | null>("open_project", {});
  },

  /**
   * Take a project off this machine's list. Touches no files — the undoable half of
   * "get this out of my sidebar"; {@link api.deleteProject} is the other half. Keyed by
   * path, because the row most in need of removing is the unavailable one, whose folder
   * — and therefore whose id — cannot be read any more.
   */
  removeProject: async (path: string): Promise<boolean> => {
    if (!isTauri()) throw new ApiError(t("err.desktopOnlyRemove"));
    return invokeCommand<boolean>("remove_project", { path });
  },

  /**
   * Delete a project — its AgentMonitoring folder, its records, its event log — from the
   * disk.
   *
   * **The only call in this file that takes something away, and the only one no agent can
   * make.** There is no `agentmon project delete` and no MCP tool: an agent appends. This
   * is reachable from one place in the product, the confirm dialog that will not enable
   * its button until a human has typed the project's name (components/DeleteProject.tsx).
   *
   * It answers with what was there a moment before rather than with a record re-read from
   * disk — there is nothing left to read — so the window can name what it removed.
   */
  deleteProject: (id: string, agent = DEFAULT_ACTOR): Promise<DeletedProject> =>
    isTauri()
      ? invokeCommand<DeletedProject>("delete_project", { id, agent })
      : fetchJson<DeletedProject>(
          `/project-api/projects/${enc(id)}?agent=${enc(agent)}`,
          { method: "DELETE" }
        ),

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
   * project-api middleware in `scripts/vite-project-api.mjs`, running from the repo root,
   * and the manual is checked in next to it.
   */
  manualPath: async (): Promise<string | null> => {
    if (!isTauri()) return "docs/AGENT_MANUAL.md";
    return invokeCommand<string | null>("manual_path", {});
  },

  /**
   * The language the human last chose, out of the desktop app's `settings.json`.
   *
   * A preference the app asks for once is a preference it must still have tomorrow.
   * Browser mode answers null — there the choice lives in localStorage, which is the
   * browser's own equivalent and needs no round trip (src/lib/i18n/index.ts).
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
   * Is a newer release of this app on GitHub? Desktop only — the browser dev server *is*
   * the source tree, so there is nothing to update — and `null` on any failure (offline,
   * nothing published yet): the sidebar card simply does not appear.
   */
  checkAppUpdate: async (): Promise<UpdateInfo | null> => {
    if (!isTauri()) return null;
    try {
      return await invokeCommand<UpdateInfo>("check_app_update", {});
    } catch {
      return null;
    }
  },

  /**
   * Run the update: a visible PowerShell window downloads the installer and reinstalls,
   * and this app exits underneath it (src-tauri/src/update.rs). Resolving means the
   * window is up and the exit is scheduled — the card's last words, not its next state.
   */
  installAppUpdate: (url: string, version: string): Promise<void> =>
    invokeCommand<null>("install_app_update", { url, version }).then(() => undefined),
};

/** What `check_app_update` answers — src-tauri/src/update.rs `UpdateInfo`. */
export type UpdateInfo = {
  current: string;
  latest: string;
  hasUpdate: boolean;
  notes: string;
  installerUrl: string | null;
  installerSize: number | null;
  pageUrl: string;
};

/**
 * Who the app records as the actor when a human — not an agent — writes something.
 *
 * Every event carries an actor, and pretending a person clicking "Create project" is one
 * of the agents would put a name in the feed that never touched the records.
 */
export const DEFAULT_ACTOR = "app";

/* --------------------------------------------------------------------------
   What a failure was
   ----------------------------------------------------------------------- */

/**
 * What a failed read *was* — one classification, read off the message, not the transport.
 *
 * `no_project` / `no_record` are stale links: the folders are fine and the address is not.
 * `not_here` is the same thing said less precisely (a 404 whose sentence this list has not
 * learned). `unreadable` is a folder actually failing.
 */
export type FailureKind = "no_project" | "no_record" | "bad_address" | "not_here" | "unreadable";

/** The two ways a project can be missing: an unregistered id, or a folder with nothing in it. */
const NO_PROJECT_ID = /^no project with id '([^']+)' is registered\b/;
const NO_PROJECT_AT = /^no project found at (.+?): /;
/** `record 'BUG-9999' not found in this project …` — the shape both backends produce. */
const NO_RECORD = /^record '([^']+)' not found in this project\b/;
/** `invalid id 'NOTANID' …` — an unusable address. */
const BAD_ADDRESS = /^invalid id '/;

/**
 * Classify a failure. **The message decides**, and the status only breaks ties.
 *
 * An earlier shape of this function asked `status !== 404` first, and that one line made
 * the desktop app — the product — answer every stale link with "could not read the data",
 * because {@link invokeCommand} has no status to give it and never had: Tauri commands
 * return `Result<T, String>`. Browser mode, whose `fetchJson` attaches `res.status`, said
 * "this project has no BUG-9999" for the identical condition. One condition, two sentences,
 * one app — and the gate that walks the screens drives the dev server, so it could only
 * ever see the half that was right.
 *
 * The message is the half both transports share. `agentmon-core` (desktop, in-process) and
 * `scripts/project-fs.mjs` (browser dev server) are separate implementations that print the
 * same sentence for the same condition, deliberately, and {@link projectErrorMessage} below
 * already relies on exactly that to say those sentences in Korean. So the headline is read
 * off the same place, the two transports cannot disagree, and `npm run check:errors` proves
 * it against the strings the real `agentmon` binary emits.
 */
export function failureKind(error: string, status?: number): FailureKind {
  const text = error.trim();
  if (NO_PROJECT_ID.test(text) || NO_PROJECT_AT.test(text)) return "no_project";
  if (NO_RECORD.test(text)) return "no_record";
  if (BAD_ADDRESS.test(text)) return "bad_address";
  return status === 404 ? "not_here" : "unreadable";
}

/**
 * What a failed read actually was, in the reader's words rather than the transport's.
 *
 * A missing record is not "could not read the data", it is "that is not here": a reader who
 * follows a link to `BUG-9999` and is told the folder is unreadable goes and checks their
 * disk, when the truth is that the link is stale.
 */
export function failureTitle(error: string, status: number | undefined, id?: string): string {
  const text = error.trim();
  switch (failureKind(error, status)) {
    case "no_project": {
      /* Two shapes: an id that is not on this machine's list (a stale route — name it),
         and a folder with no project in it (a disk fact — there is no id to name). */
      const m = NO_PROJECT_ID.exec(text);
      if (m) return t("proj.notRegistered", m[1]);
      return id ? t("proj.notRegistered", id) : t("proj.readFailed");
    }
    case "no_record":
      /* The id in the message is the record that was asked for, which is the record the
         reader clicked; `id` is the route's own copy of it, and only the list screens
         (which are not looking up a record) lack one. */
      return t("proj.noRecord", id ?? NO_RECORD.exec(text)![1]);
    case "bad_address":
      /* Nothing was missing: the address cannot name a record at all. Saying "could not
         read the data" over a body that says which form an id takes blames the disk for a
         typo. */
      return t("proj.badAddress");
    case "not_here":
      return id ? t("proj.noRecord", id) : t("proj.notHere");
    default:
      return t("proj.readFailed");
  }
}

/**
 * True when a retry could not possibly help — so the screen offers no retry button.
 *
 * The record is not there, or the address could never have named one: the button would
 * re-ask a question that has been answered, and offering it tells the reader the app is
 * unsure. False for an unreadable folder, which a second later often is not.
 */
export function nothingToRetry(error: string, status?: number): boolean {
  return failureKind(error, status) !== "unreadable";
}

/**
 * The one failed *background* refresh a project-scoped screen may not sit through: the
 * project itself is gone (deleted, unregistered, its drive unplugged).
 *
 * Everything else a refresh can fail with — a dev server restarting, a record caught
 * mid-write — leaves the last good screen exactly where it was, because the reader is
 * reading and one missed poll is not news. This is different in kind: a work list, a bug
 * board and a dashboard are lists *of a project*, and when that folder leaves the disk
 * every row on them names a file that is not there. So the three list screens turn this
 * one into the screen the app already draws for a stale project link, and a *record* page
 * keeps its copy with `StaleRecordBar` over it: there the reader still has the thing they
 * came to read.
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
 * `agentmon-core` in Rust (desktop) or `scripts/project-fs.mjs` (browser dev server), both
 * written in English. Translating it *there* would mean two more copies of the dictionary,
 * in two more languages of implementation, kept in step by nothing.
 *
 * So the shapes are matched here — all authored in this repository — and the parts that
 * are data (paths, ids, command lines) are carried across untouched. Anything unrecognised
 * is returned exactly as it came: a true sentence in the wrong language is worth more than
 * a confident guess in the right one, and an English string that reaches a Korean screen
 * this way is a message this list has not learned yet.
 *
 * Two gates say that out loud, and it takes both. `npm run check:i18n` reads the rendered
 * screens, which is the only way to catch a string that never reaches this function — but
 * it drives the dev server, so every clause `agentmon-core` adds and the middleware does
 * not is invisible to it. `npm run check:errors` closes that half: it runs the real
 * `agentmon` binary, takes the sentences it actually prints, and reads them through this
 * list.
 */
export function projectErrorMessage(message: string): string {
  const text = message.trim();
  for (const [pattern, say] of MESSAGES) {
    const m = pattern.exec(text);
    if (m) return say(m);
  }
  return message;
}

const MESSAGES: [RegExp, (m: RegExpExecArray) => string][] = [
  /* both transports: a folder that is not (or no longer) a project */
  [
    /^no project found at (.+?): no AgentMonitoring\/project\.json in that directory\.(.*)$/s,
    (m) => t("err.noProjectAt", code(m[1])),
  ],
  [/^no project found at (.+?): (.+)$/s, (m) => t("err.noProjectAtHint", code(m[1]), m[2])],
  /* desktop: store_for() in src-tauri/src/lib.rs; browser: the same sentence from the
     middleware — the id in a route that is not on this machine's list */
  [
    /^no project with id '([^']+)' is registered on this machine\b.*$/s,
    (m) => t("err.projectNotRegistered", m[1]),
  ],
  /* …and its cautious sibling: a folder that cannot be read *might* be the one asked
     for, so neither backend claims the project is gone (same two files). */
  [
    /^cannot tell whether project '([^']+)' is here — (\d+) registered folder\(s\) cannot be read right now: (.+)$/s,
    (m) => t("err.foldersUnreachable", m[1], Number(m[2]), code(m[3])),
  ],
  /* both transports: the record that is not there, with the hint each one adds */
  [
    /^record '([^']+)' not found in this project(?: \(expected file (.+?)\))?\.?$/s,
    (m) => t("err.recordNotFound", m[1], m[2] ? t("err.expectedFile", code(m[2])) : ""),
  ],
  /* both transports: an address that cannot be a record at all */
  [
    /^invalid id '([^']*)': expected (?:the form )?(.+?) \(e\.g\. (.+?)\)\.?$/s,
    (m) => t("err.badId", m[1], m[2], m[3]),
  ],
  /* desktop: the folder pickers in src-tauri/src/lib.rs */
  [/^that folder cannot be read: (.+)$/s, (m) => t("err.folderUnreadable", code(m[1]))],
  [/^that folder cannot be used: (.+)$/s, (m) => t("err.folderUnreadable", code(m[1]))],
  /* browser: scripts/project-fs.mjs — no project folders to serve at all */
  [
    /^no AgentMonitoring folder to serve — (.+)$/s,
    (m) => t("err.noDirsToServe", code(m[1])),
  ],
  [/^no project-api (?:write )?route for (.+)$/s, (m) => t("err.noRoute", code(m[1]))],
];

/**
 * How often browser mode asks the dev server whether any project changed. The endpoint is
 * a stat walk over a few dozen files, so this is cheap; it is also skipped entirely while
 * the tab is hidden, and asked once immediately when it comes back.
 */
export const POLL_MS = 2_000;

/** Slowest the poll backs off to while the server keeps failing to answer. */
export const POLL_MAX_MS = 30_000;

/**
 * How often the desktop app checks, from this side, that the backend is still answering.
 *
 * The Rust watchdog (src-tauri/src/lib.rs) is the primary tell: it probes every project
 * folder every five seconds, re-arms watchers when a folder comes back, and emits
 * `projects-changed` on any availability shift. This slower beat is the backstop for the
 * case that watchdog cannot report on: the event channel itself. One list read a
 * quarter-minute is a rounding error, and between the two of them the desktop app can
 * never sit silently on numbers that stopped moving.
 */
export const DESKTOP_HEALTH_MS = 15_000;

/** Whether the data layer is answering, and what it said when it stopped. */
export type DataHealth = { ok: true } | { ok: false; error: string };

/**
 * Subscribe to project changes. Returns an unsubscribe function.
 *
 * Desktop: the `project-changed` events the per-folder Rust watchers emit, plus
 * `projects-changed` when the roster itself shifts (a create, an open, a remove, a drive
 * coming back). Browser: a poll of `/project-api/cursor`, which returns one string
 * summarising every record file's size and mtime across every served folder. Both end in
 * the same callback, so nothing above this file knows which one it is on — and every
 * screen in the app hangs off that one signal, rather than the sidebar refreshing while
 * the dashboard beside it goes on printing yesterday.
 *
 * `onHealth` is the other half of that signal: a poll that fails is the app finding out
 * the backend it is showing can no longer be read, and a reader looking at numbers from
 * four minutes ago is owed that sentence (AppContext turns it into the banner in the
 * shell). Repeated failures also back the poll off towards {@link POLL_MAX_MS}.
 */
export function subscribeProjectChanges(
  onChange: () => void,
  onHealth?: (health: DataHealth) => void
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
        register(await listen("project-changed", () => onChange()));
        register(await listen("projects-changed", () => onChange()));
      })
      .catch(() => {});

    /* The honesty half, desktop side (see DESKTOP_HEALTH_MS): a heartbeat read of the
       project list, so an event channel that has quietly stopped is a sentence on screen
       rather than numbers that never move again. Same rule as the browser poll — one miss
       is noise, two is the backend not being there — and coming back re-reads everything. */
    let fails = 0;
    const beat = setInterval(async () => {
      try {
        await api.listProjects();
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
        const next = (await fetchJson<{ cursor: string }>("/project-api/cursor")).cursor;
        // The first answer only establishes the baseline: the screen was drawn from those
        // same folders a moment ago, and reloading it would be a refresh nobody asked for.
        if (cursor !== null && next !== cursor) onChange();
        cursor = next;
        if (fails > 0) {
          // Back from the dead: re-read everything, because whatever happened while the
          // server was unreachable did not reach this window.
          onChange();
        }
        fails = 0;
        onHealth?.({ ok: true });
      } catch (err) {
        // One miss is a dev server restarting or a record caught mid-write, and saying so
        // would be noise. A second is the backend not being there.
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
