// Browser-mode vault reader.
//
// This is the JS twin of crates/agentmon-core: it reads the same plain files and
// produces byte-for-byte the same JSON the Tauri commands return, so the React app
// cannot tell which transport it is on. The desktop app is the product; this exists so
// critics (and `npm run screenshot`) can drive the UI in a plain browser.
//
// Parity rules that must not drift from agentmon-core:
//   * camelCase JSON keys (frontmatter `resolved_by` -> `resolvedBy`);
//   * worklogs sorted by lastActivity desc, then id desc;
//   * bugs sorted open-first, then severity, then lastActivity desc;
//   * events newest first (ties break on append order, reversed), malformed lines skipped;
//   * ids/slugs validated before touching the filesystem.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- vault resolution -------------------------------------------------------

export function resolveVaultDir(repoRoot) {
  const candidates = [
    process.env.AGENTMON_VAULT ? resolve(process.env.AGENTMON_VAULT) : null,
    join(repoRoot, "vault"),
    repoRoot,
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, "vault.json"))) return dir;
  }
  throw new VaultError(
    500,
    `no vault.json found in ${candidates.join(" or ")} — set AGENTMON_VAULT or create ./vault`
  );
}

// --- path safety ------------------------------------------------------------

const SLUG_RE = /^[a-z0-9_-]{1,64}$/;
const idRe = (prefix) => new RegExp(`^${prefix}-\\d{1,8}$`);

function checkSlug(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new VaultError(400, `invalid project slug '${slug}': expected lowercase letters, digits, '-' or '_'`);
  }
  return slug;
}

function checkId(id, prefix) {
  const upper = String(id).trim().toUpperCase();
  if (!idRe(prefix).test(upper)) {
    throw new VaultError(400, `invalid id '${id}': expected ${prefix}-NNNN (e.g. ${prefix}-0001)`);
  }
  return upper;
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
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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

function entries(body) {
  const out = [];
  let current = null;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (isFence(line)) inFence = !inFence;
    if (!inFence) {
      const h = headingOf(line);
      if (h && h.level === 3) {
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

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new VaultError(500, `${path}: invalid ${what}: ${e.message}`);
  }
}

const str = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v.map(String) : v === null || v === undefined ? [] : [String(v)]);
const nullable = (v) => (v === null || v === undefined || v === "" ? null : String(v));

function parseWorklog(path) {
  const raw = readFileSync(path, "utf8");
  const split = splitFrontmatter(raw);
  if (!split) throw new VaultError(500, `${path}: missing YAML frontmatter (see SPEC.md)`);
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
  const raw = readFileSync(path, "utf8");
  const split = splitFrontmatter(raw);
  if (!split) throw new VaultError(500, `${path}: missing YAML frontmatter (see SPEC.md)`);
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

// --- reader -----------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const isOpen = (status) => status === "open" || status === "in_progress";

export function createVaultReader(vaultDir) {
  const projectDir = (slug) => {
    const dir = join(vaultDir, "projects", checkSlug(slug));
    if (!existsSync(join(dir, "project.json"))) {
      throw new VaultError(404, `project '${slug}' not found in vault ${vaultDir}`);
    }
    return dir;
  };

  const recordFiles = (dir, prefix) => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
      .sort()
      .map((f) => join(dir, f));
  };

  const api = {
    vaultDir,

    info() {
      const raw = readJson(join(vaultDir, "vault.json"), "vault.json");
      return {
        version: raw.version,
        name: raw.name,
        createdAt: raw.createdAt ?? null,
        path: vaultDir,
        source: process.env.AGENTMON_VAULT ? "env" : "cwd/vault",
      };
    },

    listProjects() {
      const dir = join(vaultDir, "projects");
      if (!existsSync(dir)) return [];
      const slugs = readdirSync(dir).filter((s) => existsSync(join(dir, s, "project.json")));
      const projects = slugs.map((slug) => api.getProject(slug));
      projects.sort(
        (a, b) =>
          String(b.counts.lastActivity ?? "").localeCompare(String(a.counts.lastActivity ?? "")) ||
          a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
      return projects;
    },

    getProject(slug) {
      const dir = projectDir(slug);
      const raw = readJson(join(dir, "project.json"), "project.json");
      const works = api.listWorklogs(slug);
      const bugs = api.listBugs(slug);
      const events = api.listEvents(slug);
      let last = "";
      for (const w of works) if (w.lastActivity > last) last = w.lastActivity;
      for (const b of bugs) if (b.lastActivity > last) last = b.lastActivity;
      if (events[0] && events[0].ts > last) last = events[0].ts;
      return {
        id: str(raw.id),
        slug: str(raw.slug || slug),
        name: str(raw.name),
        description: str(raw.description ?? ""),
        status: str(raw.status ?? "active"),
        tags: list(raw.tags),
        createdAt: nullable(raw.createdAt),
        counts: {
          workTotal: works.length,
          workInProgress: works.filter((w) => w.status === "in_progress").length,
          workDone: works.filter((w) => w.status === "done").length,
          bugsTotal: bugs.length,
          bugsOpen: bugs.filter((b) => isOpen(b.status)).length,
          events: events.length,
          lastActivity: last || null,
        },
      };
    },

    listWorklogs(slug) {
      const out = recordFiles(join(projectDir(slug), "worklogs"), "WORK-").map((p) => {
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

    getWorklog(slug, id) {
      const wid = checkId(id, "WORK");
      const path = join(projectDir(slug), "worklogs", `${wid}.md`);
      if (!existsSync(path)) throw new VaultError(404, `record '${wid}' not found in project '${slug}'`);
      return parseWorklog(path);
    },

    listBugs(slug) {
      const out = recordFiles(join(projectDir(slug), "bugs"), "BUG-").map((p) => {
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

    getBug(slug, id) {
      const bid = checkId(id, "BUG");
      const path = join(projectDir(slug), "bugs", `${bid}.md`);
      if (!existsSync(path)) throw new VaultError(404, `record '${bid}' not found in project '${slug}'`);
      return parseBug(path);
    },

    listEvents(slug, limit) {
      const path = join(projectDir(slug), "events.jsonl");
      if (!existsSync(path)) return [];
      const events = readFileSync(path, "utf8")
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

    getStatus(slug) {
      const project = api.getProject(slug);
      const works = api.listWorklogs(slug);
      const bugs = api.listBugs(slug);
      const agents = new Map();
      const touch = (name) => {
        if (!agents.has(name)) {
          agents.set(name, { agent: name, inProgress: 0, done: 0, bugsReported: 0, bugsResolved: 0, lastActivity: "" });
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
      return {
        project,
        activeWork: works.filter((w) => w.status === "in_progress"),
        openBugs: bugs.filter((b) => isOpen(b.status)),
        recentEvents: api.listEvents(slug, 50),
        agents: [...agents.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)),
      };
    },
  };

  return api;
}

// --- HTTP routing (shared by the Vite plugin) -------------------------------

/** Handle a `/vault-api/...` path. Returns the JSON payload or throws VaultError. */
export function handleVaultApi(reader, pathname, searchParams) {
  const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
  // parts[0] === "vault-api"
  const [, a, b, c, d] = parts;
  if (a === "vault" && !b) return reader.info();
  if (a === "projects" && !b) return reader.listProjects();
  if (a === "projects" && b && !c) return reader.getProject(b);
  if (a === "projects" && b && c === "worklogs" && !d) return reader.listWorklogs(b);
  if (a === "projects" && b && c === "worklogs" && d) return reader.getWorklog(b, d);
  if (a === "projects" && b && c === "bugs" && !d) return reader.listBugs(b);
  if (a === "projects" && b && c === "bugs" && d) return reader.getBug(b, d);
  if (a === "projects" && b && c === "events") {
    const limit = Number(searchParams?.get("limit") ?? 0);
    return reader.listEvents(b, limit > 0 ? limit : undefined);
  }
  if (a === "projects" && b && c === "status") return reader.getStatus(b);
  throw new VaultError(404, `no vault-api route for ${pathname}`);
}
