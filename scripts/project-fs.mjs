// Browser-mode project reader (schema v2).
//
// This is the JS twin of crates/agentmon-core: it reads the same plain files and
// produces byte-for-byte the same JSON the Tauri commands return, so the React app
// cannot tell which transport it is on. The desktop app is the product; this exists so
// critics (and `npm run screenshot`) can drive the UI in a plain browser.
//
// v2: there is no vault. The server is pointed at one or more AgentMonitoring folders
// (or the folders containing them) and serves them all — the browser twin of the desktop
// app's registry.
//
// Parity rules that must not drift from agentmon-core:
//   * camelCase JSON keys (frontmatter `resolved_by` -> `resolvedBy`);
//   * worklogs sorted by lastActivity desc, then id desc;
//   * bugs sorted open-first, then severity, then lastActivity desc;
//   * events newest first (ties break on append order, reversed), malformed lines skipped;
//   * ids validated before touching the filesystem;
//   * the error sentences match the Rust ones — src/lib/api.ts matches them by shape.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const DATA_DIR = "AgentMonitoring";

export class ProjectError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- which folders this server serves ----------------------------------------

/**
 * The folders to serve, and how that was decided.
 *
 * **An explicit set is authoritative.** `?dirs=<a;b>` (the browser-mode twin of the
 * desktop app's registry, carried on every call by src/lib/api.ts) and `AGENTMON_DIRS`
 * name specific folders: an entry that cannot be opened stays on the list as an
 * unavailable row, exactly as it would in the app — never silently replaced with this
 * repo's own data. Falling back to `<repo>/AgentMonitoring` happens only when nobody has
 * said which folders they mean.
 */
export function resolveDirs(repoRoot, override = null) {
  const entries = (raw) =>
    String(raw)
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolve(s));

  if (override) return { dirs: entries(override), source: "?dirs=" };
  if (process.env.AGENTMON_DIRS) {
    return { dirs: entries(process.env.AGENTMON_DIRS), source: "env" };
  }
  const own = join(repoRoot, DATA_DIR);
  if (existsSync(join(own, "project.json"))) return { dirs: [own], source: "repo" };
  throw new ProjectError(
    500,
    `no ${DATA_DIR} folder to serve — set AGENTMON_DIRS=<folder;folder>, pass ?dirs=, or ` +
      `create one with \`agentmon init --name "<project name>"\` in this repo`
  );
}

/** The AgentMonitoring directory for an entry (the entry itself, or its child), or null. */
function rootOf(entry) {
  if (existsSync(join(entry, "project.json"))) return entry;
  const child = join(entry, DATA_DIR);
  if (existsSync(join(child, "project.json"))) return child;
  return null;
}

// --- path safety ------------------------------------------------------------

const idRe = (prefix) => new RegExp(`^${prefix}-\\d{1,8}$`);

function checkId(id, prefix) {
  const upper = String(id).trim().toUpperCase();
  if (!idRe(prefix).test(upper)) {
    throw new ProjectError(400, `invalid id '${id}': expected ${prefix}-NNNN (e.g. ${prefix}-0001)`);
  }
  return upper;
}

// Twin of validate_note_name() in agentmon-core/src/store.rs, error sentence included:
// kebab-case, 2–64 chars, not a Windows device name, not a WORK-/BUG-number shape.
const RESERVED_NOTE_NAMES = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

function checkNoteName(name) {
  const lower = String(name).trim().toLowerCase();
  const shapeOk =
    lower.length >= 2 && lower.length <= 64 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(lower);
  if (!shapeOk || RESERVED_NOTE_NAMES.has(lower)) {
    throw new ProjectError(
      400,
      `invalid id '${name}': expected the form a kebab-case name of 2–64 letters, digits ` +
        `and hyphens (e.g. registry-gate-gotcha)`
    );
  }
  if (/^(work|bug)-\d+$/.test(lower)) {
    throw new ProjectError(
      400,
      `invalid id '${name}': expected the form a name that cannot be mistaken for a record ` +
        `id — WORK-/BUG-number shapes are reserved for work logs and bugs`
    );
  }
  return lower;
}

// --- YAML frontmatter (the subset SPEC.md uses) -----------------------------

function parseScalar(raw) {
  const v = raw.trim();
  if (v === "" || v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((x) => parseScalar(x));
  }
  return v;
}

// Split "a, \"b, c\", d" on commas that are not inside quotes.
function splitTopLevel(text) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim());
}

function parseFrontmatter(text) {
  const out = {};
  const lines = text.split("\n");
  let listKey = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && listKey) {
      out[listKey].push(parseScalar(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === "") {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = parseScalar(rest);
    }
  }
  return out;
}

export function splitFrontmatter(text) {
  // Belt and braces with readText(): this one is exported, so it can be handed a string
  // that never went through the reader, and a stray \r changes what the parsers below see.
  const noCr = text.includes("\r") ? text.replace(/\r\n/g, "\n") : text;
  const src = noCr.charCodeAt(0) === 0xfeff ? noCr.slice(1) : noCr;
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return null;
  return { frontmatter: m[1], body: src.slice(m[0].length) };
}

// --- markdown sections ------------------------------------------------------

function headingOf(line) {
  const t = line.replace(/\s+$/, "");
  if (!t.startsWith("#")) return null;
  const hashes = t.match(/^#+/)[0].length;
  const rest = t.slice(hashes);
  if (rest && !rest.startsWith(" ")) return null;
  return { level: hashes, title: rest.trim() };
}

const isFence = (line) => /^\s*(```|~~~)/.test(line);

export function sections(body) {
  const out = [];
  let current = { title: "", body: "" };
  let inFence = false;
  for (const line of body.split("\n")) {
    if (isFence(line)) inFence = !inFence;
    if (!inFence) {
      const h = headingOf(line);
      if (h && h.level === 2) {
        if (current.title || current.body.trim()) out.push({ title: current.title, body: current.body.trim() });
        current = { title: h.title, body: "" };
        continue;
      }
    }
    current.body += line + "\n";
  }
  if (current.title || current.body.trim()) out.push({ title: current.title, body: current.body.trim() });
  return out;
}

function takeSection(secs, name) {
  const want = name.toLowerCase();
  const i = secs.findIndex((s) => s.title.trim().replace(/:$/, "").toLowerCase() === want);
  if (i < 0) return null;
  return secs.splice(i, 1)[0].body;
}

// Twin of starts_with_date() in agentmon-core/src/body.rs: a `###` heading opens an
// Updates/Comments entry only when it opens with a date, the way every stamp the CLI
// writes does. An agent's own `### R7 builder — …` subheading inside its message is not
// an entry — as one it had no timestamp to print ("—" in the app) and, being
// string-greater than any ISO stamp, hijacked lastActivity.
function startsWithDate(text) {
  return /^\d{4}-\d{2}-\d{2}/.test(text.trimStart());
}

function entries(body) {
  const out = [];
  let current = null;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (isFence(line)) inFence = !inFence;
    if (!inFence) {
      const h = headingOf(line);
      if (h && h.level === 3 && startsWithDate(h.title)) {
        if (current) out.push({ head: current.head, body: current.body.trim() });
        current = { head: h.title, body: "" };
        continue;
      }
    }
    if (current) current.body += line + "\n";
  }
  if (current) out.push({ head: current.head, body: current.body.trim() });
  return out;
}

// Twin of strip_inline() in agentmon-core/src/body.rs: drop `code` spans, **bold**
// markers and [label](href) links, but leave single * and _ alone so identifiers like
// resolved_by survive.
function stripInline(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");
}

// Twin of search_text() in agentmon-core/src/body.rs: every word a reader can read in the
// record, flattened to one line. Section headings are left out — "## Report" is furniture,
// and a search where "report" matches every bug is no search at all.
function searchText(parts) {
  return parts
    .filter(Boolean)
    .map((p) => stripInline(String(p)))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function excerpt(text, maxChars = 180) {
  const para =
    (text || "")
      .split("\n\n")
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith("```")) || "";
  const flat = stripInline(para).split(/\s+/).filter(Boolean).join(" ");
  if ([...flat].length <= maxChars) return flat;
  let cut = [...flat].slice(0, maxChars).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp > 0) cut = cut.slice(0, sp);
  return cut.replace(/\s+$/, "") + "…";
}

// --- records ----------------------------------------------------------------

/**
 * Every byte this reader takes off disk comes through here, with CRLF normalised to LF.
 *
 * Parity, and not a cosmetic kind: `agentmon-core` parses with `str::lines()`, which
 * drops the `\r` — so the Rust side of the app never sees one. CRLF is not exotic: it is
 * what `git clone` writes on Windows with core.autocrlf=true, and what Notepad saves.
 */
function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function readJson(path, what) {
  try {
    return JSON.parse(readText(path));
  } catch (e) {
    throw new ProjectError(500, `${path}: invalid ${what}: ${e.message}`);
  }
}

const str = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)]);
const nullable = (v) => (v === null || v === undefined || v === "" ? null : String(v));

function parseWorklog(path) {
  const raw = readText(path);
  const split = splitFrontmatter(raw);
  if (!split) throw new ProjectError(500, `${path}: missing YAML frontmatter (see SPEC.md)`);
  const fm = parseFrontmatter(split.frontmatter);
  const secs = sections(split.body).filter((s) => s.title || s.body.trim());
  const what = takeSection(secs, "What") ?? "";
  const why = takeSection(secs, "Why") ?? "";
  const how = takeSection(secs, "How") ?? "";
  const updatesRaw = takeSection(secs, "Updates");
  const updates = updatesRaw ? entries(updatesRaw).map((e) => ({ ts: e.head.trim(), body: e.body })) : [];
  const outcomeRaw = takeSection(secs, "Outcome");
  const outcome = outcomeRaw && outcomeRaw.trim() ? outcomeRaw : null;

  const meta = {
    id: str(fm.id),
    title: str(fm.title),
    agent: str(fm.agent),
    status: str(fm.status),
    started: str(fm.started),
    finished: nullable(fm.finished),
    tags: list(fm.tags),
    refs: list(fm.refs),
    files: list(fm.files),
  };
  let lastActivity = meta.started;
  if (meta.finished && meta.finished > lastActivity) lastActivity = meta.finished;
  for (const u of updates) if (u.ts > lastActivity) lastActivity = u.ts;

  return {
    ...meta,
    what,
    why,
    how,
    updates,
    outcome,
    extraSections: secs,
    body: split.body.trim(),
    lastActivity,
  };
}

function parseBug(path) {
  const raw = readText(path);
  const split = splitFrontmatter(raw);
  if (!split) throw new ProjectError(500, `${path}: missing YAML frontmatter (see SPEC.md)`);
  const fm = parseFrontmatter(split.frontmatter);
  const secs = sections(split.body).filter((s) => s.title || s.body.trim());
  const report = takeSection(secs, "Report") ?? "";
  const commentsRaw = takeSection(secs, "Comments");
  const comments = commentsRaw
    ? entries(commentsRaw).map((e) => {
        const m = e.head.split(/\s+[—–|]\s+|\s+-\s+/);
        return { ts: (m[0] || "").trim(), agent: (m[1] || "").trim(), body: e.body };
      })
    : [];
  const resolutionRaw = takeSection(secs, "Resolution");
  const resolution = resolutionRaw && resolutionRaw.trim() ? resolutionRaw : null;

  const meta = {
    id: str(fm.id),
    title: str(fm.title),
    reporter: str(fm.reporter),
    assignee: nullable(fm.assignee),
    severity: str(fm.severity),
    status: str(fm.status),
    labels: list(fm.labels),
    created: str(fm.created),
    claimed: nullable(fm.claimed),
    resolved: nullable(fm.resolved),
    resolvedBy: nullable(fm.resolved_by ?? fm.resolvedBy),
    refs: list(fm.refs),
  };
  let lastActivity = meta.created;
  for (const t of [meta.claimed, meta.resolved]) if (t && t > lastActivity) lastActivity = t;
  for (const c of comments) if (c.ts > lastActivity) lastActivity = c.ts;

  return { ...meta, report, comments, resolution, extraSections: secs, body: split.body.trim(), lastActivity };
}

function parseNote(path) {
  const raw = readText(path);
  const split = splitFrontmatter(raw);
  if (!split) throw new ProjectError(500, `${path}: missing YAML frontmatter (see SPEC.md)`);
  const fm = parseFrontmatter(split.frontmatter);
  const meta = {
    name: str(fm.name),
    title: str(fm.title),
    type: str(fm.type),
    description: str(fm.description),
    agent: str(fm.agent),
    updatedBy: nullable(fm.updated_by ?? fm.updatedBy),
    created: str(fm.created),
    updated: str(fm.updated),
    tags: list(fm.tags),
    refs: list(fm.refs),
  };
  const lastActivity = meta.updated > meta.created ? meta.updated : meta.created;
  return { ...meta, body: split.body.trim(), lastActivity };
}

// --- one store (one AgentMonitoring folder) ----------------------------------

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const isOpen = (status) => status === "open" || status === "in_progress";

/**
 * `~/.AgentMonitoring/feedback` — agentmon-core's `feedback_dir()` in JS: beside the
 * registry, honoring the same `AGENTMON_REGISTRY_DIR` override, so the check scripts'
 * sandboxes cover both.
 */
function feedbackDir() {
  const home = process.env.AGENTMON_REGISTRY_DIR ?? join(homedir(), ".AgentMonitoring");
  return join(home, "feedback");
}

function recordFiles(dir, prefix) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".md") && !f.startsWith("."))
    .sort()
    .map((f) => join(dir, f));
}

/** One project folder, opened. `source` mirrors the Rust side's resolution label. */
export function openStore(root, source = "registry") {
  const store = {
    root,

    project() {
      const path = join(root, "project.json");
      const raw = readJson(path, "project.json");
      const version = typeof raw.version === "number" ? raw.version : 1;
      if (version !== 2) {
        throw new ProjectError(
          500,
          `${path}: schema version is ${version} but this build of agentmon speaks v2. ` +
            `Old vault data is moved forward with \`agentmon migrate --from <vault> ` +
            `--project <slug> --to <folder>\``
        );
      }
      const works = store.listWorklogs();
      const bugs = store.listBugs();
      const notes = store.listNotes();
      const events = store.listEvents();
      let last = "";
      for (const w of works) if (w.lastActivity > last) last = w.lastActivity;
      for (const b of bugs) if (b.lastActivity > last) last = b.lastActivity;
      for (const n of notes) if (n.lastActivity > last) last = n.lastActivity;
      if (events[0] && events[0].ts > last) last = events[0].ts;
      return {
        version,
        id: str(raw.id),
        name: str(raw.name),
        description: str(raw.description ?? ""),
        tags: list(raw.tags),
        createdAt: nullable(raw.createdAt),
        counts: {
          workTotal: works.length,
          workInProgress: works.filter((w) => w.status === "in_progress").length,
          workDone: works.filter((w) => w.status === "done").length,
          bugsTotal: bugs.length,
          bugsOpen: bugs.filter((b) => isOpen(b.status)).length,
          notesTotal: notes.length,
          events: events.length,
          lastActivity: last || null,
        },
        path: root,
        source,
      };
    },

    listWorklogs() {
      const out = recordFiles(join(root, "worklogs"), "WORK-").map((p) => {
        const d = parseWorklog(p);
        const { what, why, how, updates, outcome, extraSections, body, ...meta } = d;
        return {
          ...meta,
          excerpt: excerpt(what),
          searchText: searchText([
            what,
            why,
            how,
            ...updates.map((u) => u.body),
            outcome,
            ...extraSections.map((s) => s.body),
          ]),
          updateCount: updates.length,
        };
      });
      out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity) || b.id.localeCompare(a.id));
      return out;
    },

    getWorklog(id) {
      const wid = checkId(id, "WORK");
      const path = join(root, "worklogs", `${wid}.md`);
      if (!existsSync(path)) throw new ProjectError(404, `record '${wid}' not found in this project`);
      return parseWorklog(path);
    },

    listBugs() {
      const out = recordFiles(join(root, "bugs"), "BUG-").map((p) => {
        const d = parseBug(p);
        const { report, comments, resolution, extraSections, body, ...meta } = d;
        return {
          ...meta,
          excerpt: excerpt(report),
          searchText: searchText([
            report,
            // the commenter's name too: a bug is often remembered by who answered on it
            ...comments.flatMap((c) => [c.agent, c.body]),
            resolution,
            ...extraSections.map((s) => s.body),
          ]),
          commentCount: comments.length,
        };
      });
      out.sort(
        (a, b) =>
          Number(isOpen(b.status)) - Number(isOpen(a.status)) ||
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          b.lastActivity.localeCompare(a.lastActivity)
      );
      return out;
    },

    getBug(id) {
      const bid = checkId(id, "BUG");
      const path = join(root, "bugs", `${bid}.md`);
      if (!existsSync(path)) throw new ProjectError(404, `record '${bid}' not found in this project`);
      return parseBug(path);
    },

    listNotes() {
      const out = recordFiles(join(root, "notes"), "").map((p) => {
        const d = parseNote(p);
        const { body, ...meta } = d;
        return {
          ...meta,
          excerpt: excerpt(body),
          searchText: searchText([d.description, body, d.tags.join(" ")]),
        };
      });
      // Parity: most recently updated first, name asc on ties — the newest handoff is
      // the one addressed to whoever just arrived.
      out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity) || a.name.localeCompare(b.name));
      return out;
    },

    getNote(name) {
      const n = checkNoteName(name);
      const path = join(root, "notes", `${n}.md`);
      if (!existsSync(path)) throw new ProjectError(404, `record '${n}' not found in this project`);
      return parseNote(path);
    },

    listEvents(limit) {
      const path = join(root, "events.jsonl");
      if (!existsSync(path)) return [];
      const events = readText(path)
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            const e = JSON.parse(l);
            return { ts: str(e.ts), actor: str(e.actor), type: str(e.type), ref: nullable(e.ref), summary: str(e.summary) };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .map((e, i) => ({ e, i }));
      // Parity with agentmon-core: timestamps have second precision, so ties break on
      // append order reversed — the last line written is the most recent thing.
      events.sort((a, b) => b.e.ts.localeCompare(a.e.ts) || b.i - a.i);
      const out = events.map(({ e }) => e);
      return limit ? out.slice(0, limit) : out;
    },

    getStatus() {
      const project = store.project();
      const works = store.listWorklogs();
      const bugs = store.listBugs();
      const notes = store.listNotes();
      const agents = new Map();
      const touch = (name) => {
        if (!agents.has(name)) {
          agents.set(name, { agent: name, inProgress: 0, done: 0, bugsReported: 0, bugsResolved: 0, notes: 0, lastActivity: "" });
        }
        return agents.get(name);
      };
      for (const w of works) {
        const a = touch(w.agent);
        if (w.status === "in_progress") a.inProgress += 1;
        if (w.status === "done") a.done += 1;
        if (w.lastActivity > a.lastActivity) a.lastActivity = w.lastActivity;
      }
      for (const b of bugs) {
        const a = touch(b.reporter);
        a.bugsReported += 1;
        if (b.lastActivity > a.lastActivity) a.lastActivity = b.lastActivity;
        if (b.resolvedBy) touch(b.resolvedBy).bugsResolved += 1;
      }
      for (const n of notes) {
        const a = touch(n.agent);
        a.notes += 1;
        if (n.lastActivity > a.lastActivity) a.lastActivity = n.lastActivity;
      }
      return {
        project,
        activeWork: works.filter((w) => w.status === "in_progress"),
        openBugs: bugs.filter((b) => isOpen(b.status)),
        recentNotes: notes.slice(0, 5),
        recentEvents: store.listEvents(50),
        agents: [...agents.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)),
      };
    },
  };
  return store;
}

// --- the reader over every served folder -------------------------------------

/**
 * @param {string[]} dirs the entries to serve — AgentMonitoring folders or their parents
 * @param {string} [source] how they were chosen (`?dirs=`, `env`, `repo`)
 */
export function createProjectsReader(dirs, source = "registry") {
  const reader = {
    dirs,

    /** Every entry as a row — available or not — sorted the way the Tauri command sorts. */
    rows() {
      const out = dirs.map((entry) => {
        const root = rootOf(entry);
        if (!root) {
          return {
            available: false,
            path: entry,
            name: null,
            error:
              `no project found at ${entry}: no ${DATA_DIR}/project.json in that directory. ` +
              `Pick the folder that holds the ${DATA_DIR} folder, or create a project there ` +
              `with \`agentmon init --dir <folder> --name "<project name>"\`.`,
          };
        }
        try {
          const project = openStore(root, source).project();
          return { available: true, path: root, name: project.name, project };
        } catch (e) {
          return { available: false, path: root, name: null, error: e.message };
        }
      });
      out.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        const la = a.project?.counts.lastActivity ?? "";
        const lb = b.project?.counts.lastActivity ?? "";
        return String(lb).localeCompare(String(la));
      });
      return out;
    },

    /** The store whose project.json carries `id`, or the sentence the app translates. */
    byId(id) {
      const unreachable = [];
      for (const entry of dirs) {
        const root = rootOf(entry);
        if (!root) {
          unreachable.push(entry);
          continue;
        }
        try {
          const raw = readJson(join(root, "project.json"), "project.json");
          if (str(raw.id) === id) return openStore(root, source);
        } catch {
          unreachable.push(root);
        }
      }
      if (unreachable.length) {
        /* A folder that cannot be read *might* be the one asked for — an unplugged drive
           is not a deleted project, and saying "not registered" here would replace a
           screen somebody is reading with an error card every time a folder blinks. The
           sentence is deliberately not one src/lib/api.ts classifies as a stale link. */
        throw new ProjectError(
          503,
          `cannot tell whether project '${id}' is here — ${unreachable.length} registered ` +
            `folder(s) cannot be read right now: ${unreachable.join(", ")}`
        );
      }
      throw new ProjectError(
        404,
        `no project with id '${id}' is registered on this machine (the folder may have ` +
          `been removed from the list, or its drive unplugged)`
      );
    },

    /**
     * One string that changes when any served folder does — browser mode's twin of the
     * desktop app's filesystem watchers (src/lib/api.ts polls this).
     *
     * It is a stat walk, not a read: name, size and mtime of every record file, plus the
     * files' count, which covers the three things a write does (append to events.jsonl,
     * rename a record over itself, add a new one). A few dozen `stat` calls every couple
     * of seconds costs nothing, and unlike a filesystem watcher it cannot miss an event
     * because the page was loaded a moment after the write.
     */
    cursor() {
      let files = 0;
      let newest = 0;
      const parts = [];
      const note = (path) => {
        let st;
        try {
          st = statSync(path);
        } catch {
          return;
        }
        files += 1;
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        parts.push(`${st.size}:${Math.round(st.mtimeMs)}`);
      };

      for (const entry of dirs) {
        const root = rootOf(entry);
        parts.push(entry);
        if (!root) continue;
        note(join(root, "project.json"));
        note(join(root, "events.jsonl"));
        for (const [sub, prefix] of [
          ["worklogs", "WORK-"],
          ["bugs", "BUG-"],
          ["notes", ""],
        ]) {
          for (const file of recordFiles(join(root, sub), prefix)) note(file);
        }
      }

      // The machine-level feedback board too (FB-0001): it belongs to no served folder,
      // so without these stats a feedback filed via CLI sat unseen until the next
      // project write. The desktop twin is the dedicated watcher in src-tauri.
      for (const file of recordFiles(feedbackDir(), "FB-")) note(file);

      // Hashed rather than returned whole: the client only ever compares it to the last
      // one, and a 4KB string on a 2s poll is a waste of everybody's time.
      let hash = 2166136261;
      const text = parts.join("|");
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return {
        cursor: `${files}-${(hash >>> 0).toString(36)}`,
        files,
        changedAt: newest ? new Date(newest).toISOString() : null,
      };
    },
  };
  return reader;
}

// --- HTTP routing (shared by the Vite plugin) -------------------------------

/**
 * Machine-level app feedback (`~/.AgentMonitoring/feedback`): the board about the app
 * itself, belonging to no project — so no reader and no dirs. Shells to the CLI like
 * every other write, so validation is agentmon's. Returns null when the path is not its
 * route; `readBody` is called only on the routes that take one.
 */
export async function handleAppFeedback(repoRoot, method, pathname, readBody) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const [, a, b, c] = parts;
  if (a !== "app-feedback") return null;
  if ((method === "GET" || method === "HEAD") && !b) {
    return runAgentmon(repoRoot, ["app-feedback", "list"]);
  }
  if (method === "POST" && b && c === "status" && !parts[4]) {
    const body = await readBody();
    const status = String(body?.status ?? "").trim();
    if (status !== "open" && status !== "done") {
      throw new ProjectError(400, 'status must be "open" or "done"');
    }
    return runAgentmon(repoRoot, ["app-feedback", status === "done" ? "done" : "reopen", b]);
  }
  // Delete is the CLI's own verb (done items only — its refusal names the rule), so the
  // browser transport cannot drift from the desktop's.
  if (method === "DELETE" && b && !c) {
    return runAgentmon(repoRoot, ["app-feedback", "delete", b]);
  }
  throw new ProjectError(404, `no app-feedback route for ${pathname}`);
}

/** Handle a `/project-api/...` path. Returns the JSON payload or throws ProjectError. */
export function handleProjectApi(reader, pathname, searchParams) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  // parts[0] === "project-api"
  const [, a, b, c, d] = parts;
  if (a === "cursor" && !b) return reader.cursor();
  if (a === "projects" && !b) return reader.rows();
  if (a === "projects" && b && !c) return reader.byId(b).project();
  if (a === "projects" && b && c === "worklogs" && !d) return reader.byId(b).listWorklogs();
  if (a === "projects" && b && c === "worklogs" && d) return reader.byId(b).getWorklog(d);
  if (a === "projects" && b && c === "bugs" && !d) return reader.byId(b).listBugs();
  if (a === "projects" && b && c === "bugs" && d) return reader.byId(b).getBug(d);
  if (a === "projects" && b && c === "notes" && !d) return reader.byId(b).listNotes();
  if (a === "projects" && b && c === "notes" && d) return reader.byId(b).getNote(d);
  if (a === "projects" && b && c === "events") {
    const limit = Number(searchParams?.get("limit") ?? 0);
    return reader.byId(b).listEvents(limit > 0 ? limit : undefined);
  }
  if (a === "projects" && b && c === "status") return reader.byId(b).getStatus();
  throw new ProjectError(404, `no project-api route for ${pathname}`);
}

// --- record assets (images referenced from bodies) ---------------------------
//
// The JS twin of `Store::asset` (crates/agentmon-core/src/store.rs): same shape rules,
// same containment check, same extension whitelist, same cap — a body's `![alt](src)`
// must answer identically on both transports, including in how it refuses.

/** Extension → content-type for the files a body may reference. The whitelist. */
const ASSET_MIME = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const ASSET_MAX_BYTES = 10 * 1024 * 1024;

/** `/project-api/projects/:id/files/<relpath>` — the one binary route. Null if not it. */
export function matchAssetRoute(pathname) {
  const m = pathname.match(/^\/project-api\/projects\/([^/]+)\/files\/(.+)$/);
  if (!m) return null;
  return {
    id: decodeURIComponent(m[1]),
    path: m[2].split("/").map(decodeURIComponent).join("/"),
  };
}

/** Read one referenced image out of a project folder, or refuse the way core refuses. */
export function readProjectAsset(root, rel) {
  const expected =
    `a relative path inside the ${DATA_DIR} folder ending in one of: ` +
    `${Object.keys(ASSET_MIME).join(" ")} (e.g. assets/diagram.svg)`;
  const invalid = () =>
    new ProjectError(400, `invalid image path '${rel}': expected ${expected}`);
  const trimmed = (rel ?? "").trim();
  if (!trimmed || trimmed.length > 512) throw invalid();
  const unified = trimmed.replace(/\\/g, "/");
  if (unified.startsWith("/") || unified.includes(":")) throw invalid();
  const segments = unified.split("/");
  if (segments.some((s) => !s || s === ".." || s.startsWith("."))) throw invalid();
  const ext = unified.includes(".") ? unified.split(".").pop().toLowerCase() : "";
  const mime = ASSET_MIME[ext];
  if (!mime) throw invalid();

  const path = join(root, unified);
  let real;
  try {
    // Symlinks resolved before the containment check, exactly as core does it.
    real = realpathSync(path);
  } catch {
    throw new ProjectError(404, `record '${trimmed}' not found in this project (expected file ${path})`);
  }
  const inside = relative(realpathSync(root), real);
  if (inside.startsWith("..") || isAbsolute(inside)) throw invalid();
  const stat = statSync(real);
  if (!stat.isFile()) {
    throw new ProjectError(404, `record '${trimmed}' not found in this project (expected file ${path})`);
  }
  if (stat.size > ASSET_MAX_BYTES) {
    throw new ProjectError(
      400,
      `invalid image file '${trimmed}': expected a file of at most ${ASSET_MAX_BYTES / (1024 * 1024)} MB`
    );
  }
  return { mime, bytes: readFileSync(real) };
}

// --- writes (browser mode) --------------------------------------------------
//
// The rest of this file is a *reader*: a JS twin of agentmon-core, kept in parity by hand.
// A second implementation of the write path would be a far worse bargain — writes allocate
// ids under a lock, validate bodies, append events and backdate, and a twin that drifted
// there would corrupt a project rather than mis-render one. So browser mode writes by
// running the `agentmon` binary itself: the same core code the desktop app calls
// in-process, and the same code an agent at a terminal runs.
//
// With exactly one exception, at the foot of this file: deleting a project, which has no
// CLI verb to run because it is the human's action in the app and not part of the
// interface agents script against. See handleProjectDelete for the rules it keeps instead.

const BIN = process.env.AGENTMON_BIN;

function agentmonBinary(repoRoot) {
  const exe = process.platform === "win32" ? "agentmon.exe" : "agentmon";
  const candidates = [
    BIN ? resolve(BIN) : null,
    join(repoRoot, "target", "release", exe),
    join(repoRoot, "target", "debug", exe),
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new ProjectError(
      501,
      `the agentmon binary is not built, so browser mode cannot write records — run ` +
        `\`cargo build --release -p agentmon-cli\` (looked in ${candidates.join(", ")}). ` +
        `The desktop app writes in-process and needs none of this.`
    );
  }
  return found;
}

/** Run one `agentmon` command and return its `--json` payload. */
function runAgentmon(repoRoot, args) {
  const bin = agentmonBinary(repoRoot);
  try {
    const out = execFileSync(bin, ["--json", ...args], {
      encoding: "utf8",
      timeout: 20_000,
    });
    return JSON.parse(out);
  } catch (err) {
    // The CLI prints `{"ok":false,"error":{"message":...}}` on stderr and exits non-zero.
    // That message is written for a human to act on, so it is what the app shows.
    const raw = String(err.stdout ?? "") || String(err.stderr ?? "") || err.message;
    let message = raw.trim();
    try {
      const parsed = JSON.parse(raw);
      const e = parsed.error ?? {};
      message = [e.message, e.hint].filter(Boolean).join(" — ") || message;
    } catch {
      /* not JSON: the raw output is the best thing we have */
    }
    throw new ProjectError(400, message);
  }
}

const REQUIRED = (body, key) => {
  const value = typeof body?.[key] === "string" ? body[key].trim() : "";
  if (!value) throw new ProjectError(400, `'${key}' is required`);
  return value;
};

/**
 * Handle a write to `/project-api/...`. Returns the project the write produced, so the
 * caller can render it without a second round trip. The new folder joins this server's
 * served set for the session — the browser twin of the app registering it.
 */
export function handleProjectWrite(reader, repoRoot, pathname, body) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const [, a, b, c] = parts;
  const actor = (typeof body?.agent === "string" && body.agent.trim()) || "app";

  // Scaffolding for a project that already exists — the New-project options, reachable
  // later. Shells the CLI verbs (`agentmon project claude-md` / `project mcp-json`), so
  // the conservative write rules are agentmon's own; --dir targets the served folder.
  if (a === "projects" && b && (c === "claude-md" || c === "mcp-json") && !parts[4]) {
    const store = reader.byId(b);
    const args = ["--dir", store.root, "project"];
    if (c === "claude-md") {
      args.push("claude-md", "--lang", REQUIRED(body, "lang"));
    } else {
      args.push("mcp-json");
      const agent = typeof body?.mcpAgent === "string" ? body.mcpAgent.trim() : "";
      if (agent) args.push("--agent", agent);
    }
    return runAgentmon(repoRoot, args);
  }

  if (a === "projects" && !b) {
    const location = REQUIRED(body, "location");
    const name = REQUIRED(body, "name");
    const args = ["init", "--dir", location, "--name", name, "--agent", actor];
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description) args.push("--description", description);
    const tags = Array.isArray(body.tags) ? body.tags.filter(Boolean) : [];
    if (tags.length) args.push("--tags", tags.join(","));
    // Validated by the CLI, like everything else on this path.
    const claudeMd = typeof body.claudeMd === "string" ? body.claudeMd.trim() : "";
    if (claudeMd) args.push("--claude-md", claudeMd);
    // The MCP registration too: the CLI finds mcp/server.mjs from its own location,
    // which in browser mode is this repo's checkout — the right path for a dev machine.
    if (body.mcpJson === true) {
      args.push("--mcp-json");
      const mcpAgent = typeof body.mcpAgent === "string" ? body.mcpAgent.trim() : "";
      if (mcpAgent) args.push("--mcp-agent", mcpAgent);
    }
    const project = runAgentmon(repoRoot, args);
    const root = rootOf(resolve(location));
    if (root && !reader.dirs.includes(root) && !reader.dirs.includes(resolve(location))) {
      reader.dirs.push(root);
    }
    return project;
  }

  throw new ProjectError(404, `no project-api write route for ${pathname}`);
}

/**
 * `DELETE /project-api/projects/<id>` — the browser twin of the desktop app's
 * `delete_project` command (src-tauri/src/lib.rs).
 *
 * **The one write in this file that does not shell out to `agentmon`**, and deliberately
 * so: there is no `agentmon project delete` and there is not going to be one. Deleting a
 * project is the human's action inside the app, not a verb in the interface agents script
 * against, so browser mode — which exists to drive the same UI without building the
 * desktop app — implements it here, with the same rule the Rust side keeps: only a
 * canonicalised folder actually named `AgentMonitoring` with a project.json inside can be
 * removed — never the code around it.
 *
 * Answers with what was there a moment before, because afterwards there is nothing to
 * read: the same `{ ok, id, name, path, counts, deletedBy }` shape the Tauri command
 * returns.
 */
export function handleProjectDelete(reader, pathname, searchParams) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  const [, a, b, c] = parts;
  if (a !== "projects" || !b || c) {
    throw new ProjectError(404, `no project-api delete route for ${pathname}`);
  }
  const store = reader.byId(b);
  const project = store.project();

  const resolved = realpathSync(store.root);
  if (basename(resolved) !== DATA_DIR || !existsSync(join(resolved, "project.json"))) {
    throw new ProjectError(
      400,
      `${resolved} is not an ${DATA_DIR} project folder — this deletes only a folder named ` +
        `${DATA_DIR} that holds a project.json`
    );
  }

  rmSync(resolved, { recursive: true, force: false });
  return {
    ok: true,
    id: project.id,
    name: project.name,
    path: resolved,
    counts: project.counts,
    deletedBy: (searchParams?.get("agent") ?? "").trim() || "app",
  };
}
