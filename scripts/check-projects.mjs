#!/usr/bin/env node
/**
 * Prove the app serves the folders it was told to serve — and only those.
 *
 *   npm run check:projects
 *   node scripts/check-projects.mjs [--port 5201] [--keep]
 *
 * The v2 successor to the vault-portability gate (P5 round 1). The claims, updated for a
 * world of one `AgentMonitoring` folder per project:
 *
 *   1. **The configured set is authoritative.** A broken entry in `AGENTMON_DIRS` is an
 *      *unavailable row*, never silently replaced with this repo's own records; a record
 *      route into it says "cannot tell", not "does not exist" — and nothing ever serves a
 *      folder that was not configured.
 *   2. **`?dirs=` is an explicit choice** and works even while the environment's entry is
 *      broken.
 *   3. **Delete is contained.** A DELETE of an id that is not served is refused; deleting
 *      a real project (in a temp copy) removes exactly its folder, leaves the list
 *      agreeing with itself, and a stale link lands on the designed screen with no retry.
 *   4. **A folder is portable.** The same records copied under a name with spaces and
 *      parentheses serve identical payloads (the machine-local `path`/`source` fields
 *      aside, which are the two fields that *should* differ).
 *   5. **Line endings are not data.** The same records written with CRLF — what
 *      `git clone` produces on Windows with core.autocrlf=true — serve the same payloads,
 *      with no `\r` anywhere in them.
 *
 * The window-level half of "a folder vanishes under an open screen" lives in
 * check-keys.mjs; this gate covers the transport. It never writes to ./AgentMonitoring:
 * the folder is hashed before and after to prove it.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Prove the folders the app serves are the folders it was configured with.

  npm run check:projects
  node scripts/check-projects.mjs [--port 5201] [--keep]

  --port <n>   dev-server port (default 5201, its own so it never fights another run)
  --keep       leave the temp copies behind for inspection

Never writes to ./AgentMonitoring (and proves it: the folder is hashed before and after).`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.VAULT_PORT || 5201));
const ORIGIN = `http://localhost:${PORT}`;
const KEEP = args.includes("--keep");
const LOCALE = value("--locale", process.env.SHOT_LOCALE || "ko");
const T = (key, ...args) => t(LOCALE, key, ...args);
const log = (...m) => console.log("[check:projects]", ...m);

let failures = 0;
let checks = 0;
const check = (name, ok, detail) => {
  checks += 1;
  if (ok) {
    console.log(`  ok    ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
};

/** Every file in a directory tree, with its sha1 — for "this folder was not touched". */
function fingerprint(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash("sha1").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

const diffFingerprints = (a, b) => {
  const changed = [];
  for (const [k, v] of a) if (b.get(k) !== v) changed.push(k);
  for (const k of b.keys()) if (!a.has(k)) changed.push(`+${k}`);
  return changed;
};

const raw = async (path) => {
  const res = await fetch(`${ORIGIN}${path}`);
  return { status: res.status, text: await res.text() };
};

const json = async (path) => {
  const r = await raw(path);
  try {
    return { status: r.status, body: JSON.parse(r.text) };
  } catch {
    return { status: r.status, body: r.text };
  }
};

/**
 * The one destructive route. Only ever aimed at a **temp copy** in this file — every call
 * below runs against a server whose `AGENTMON_DIRS` is a temp directory, and the repo's
 * own folder is hashed before and after to prove it.
 */
const del = async (path) => {
  const res = await fetch(`${ORIGIN}${path}`, { method: "DELETE" });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
};

/**
 * A payload with its machine-local fields blanked, for cross-copy comparison. `path` and
 * `source` are reader-filled facts about *where* the folder is (src/lib/types.ts), which
 * is exactly what moving a folder changes; everything else must not.
 */
const scrub = (v) => {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = k === "path" || k === "source" ? "<local>" : scrub(val);
    }
    return out;
  }
  return v;
};
const scrubbed = async (path) => {
  const { status, body } = await json(path);
  return `${status} ${JSON.stringify(scrub(body))}`;
};

const REPO_DATA = join(repoRoot, "AgentMonitoring");
const enc = encodeURIComponent;

let server = null;
let browser = null;
const temps = [];
const temp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

/**
 * Nothing may already be listening on this port: a server left running by another tool
 * would answer every request here from folders this gate did not configure, and the
 * delete below would remove a project from the wrong copy.
 */
async function requireFreePort() {
  try {
    const res = await fetch(`${ORIGIN}/project-api/cursor`, { signal: AbortSignal.timeout(1500) });
    throw new Error(
      `something is already serving ${ORIGIN} (answered ${res.status}). This gate must own its ` +
        `server — stop that one, or run with --port <n>.`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("something is already serving")) throw err;
    /* nothing there: exactly what we want */
  }
}

try {
  if (!existsSync(join(REPO_DATA, "project.json"))) {
    throw new Error(`no project at ${REPO_DATA} — this gate compares against the repo's own records`);
  }
  const repoBefore = fingerprint(REPO_DATA);
  log(`repo records: ${REPO_DATA} (${repoBefore.size} files, hashed)`);

  /* ------------------------------------------------------------------ *
     1. a configured folder that cannot be read is an unavailable row,
        never a silent substitution
     ------------------------------------------------------------------ */

  await requireFreePort();

  const missing = join(temp("agentmon-gone-"), "not-a-project");
  log(`starting a dev server with AGENTMON_DIRS=${missing} (which does not exist)…`);
  const scratchRegistry = join(temp("agentmon-reg-"), "home");
  server = startServer(PORT, {
    env: { AGENTMON_DIRS: missing, AGENTMON_REGISTRY_DIR: scratchRegistry },
  });
  await waitForServer(server, ORIGIN);

  const rows = await json("/project-api/projects");
  check(
    "a broken AGENTMON_DIRS entry is one unavailable row, not another folder's data",
    rows.status === 200 &&
      Array.isArray(rows.body) &&
      rows.body.length === 1 &&
      rows.body[0].available === false,
    `GET /project-api/projects -> ${rows.status} ${JSON.stringify(rows.body).slice(0, 240)}`,
  );
  check(
    "…and the row names the folder it was told to serve",
    rows.body?.[0]?.path === missing && String(rows.body?.[0]?.error ?? "").includes(missing),
    JSON.stringify(rows.body?.[0]).slice(0, 300),
  );
  check(
    "…and the repo's own records are nowhere in the answer",
    !JSON.stringify(rows.body).includes("AgentMonitoring\\\\AgentMonitoring") &&
      !rows.body.some((r) => r.available),
    JSON.stringify(rows.body).slice(0, 240),
  );

  const blindRead = await json("/project-api/projects/prj-agent-monitoring/worklogs");
  check(
    "a record route answers 'cannot tell', because the folder might hold that id",
    blindRead.status >= 400 &&
      String(blindRead.body?.error ?? "").startsWith("cannot tell whether project"),
    `${blindRead.status} ${JSON.stringify(blindRead.body).slice(0, 240)}`,
  );

  // The same server, pointed at a real copy by ?dirs=: an explicit choice still works.
  const copy = join(temp("agentmon-copy-"), "AgentMonitoring");
  cpSync(REPO_DATA, copy, { recursive: true });
  const override = await json(`/project-api/projects?dirs=${enc(copy)}`);
  check(
    "?dirs= still opens a real folder even while the environment's is broken",
    override.status === 200 &&
      override.body.length === 1 &&
      override.body[0].available === true &&
      override.body[0].path === copy,
    `${override.status} ${JSON.stringify(scrub(override.body)).slice(0, 240)}`,
  );

  /* ------------------------------------------------------------------ *
     2. a folder that vanishes under the server, and comes back
     ------------------------------------------------------------------ */

  const moved = `${copy}-moved`;
  renameSync(copy, moved);
  const gone = await json(`/project-api/projects?dirs=${enc(copy)}`);
  check(
    "a folder that vanishes flips to unavailable rather than erroring the list",
    gone.status === 200 && gone.body.length === 1 && gone.body[0].available === false,
    `${gone.status} ${JSON.stringify(gone.body).slice(0, 240)}`,
  );
  const goneRead = await json(`/project-api/projects/prj-agent-monitoring/status?dirs=${enc(copy)}`);
  check(
    "…and a record route into it says 'cannot tell', not 'deleted'",
    goneRead.status >= 400 &&
      String(goneRead.body?.error ?? "").startsWith("cannot tell whether project"),
    `${goneRead.status} ${JSON.stringify(goneRead.body).slice(0, 200)}`,
  );
  renameSync(moved, copy);
  const returned = await json(`/project-api/projects?dirs=${enc(copy)}`);
  check(
    "…and when it comes back it serves again, unchanged",
    returned.status === 200 && returned.body[0]?.available === true,
    `${returned.status} ${JSON.stringify(scrub(returned.body)).slice(0, 200)}`,
  );

  /* ------------------------------------------------------------------ *
     3. delete: contained, counted, and answered by the designed screen
     ------------------------------------------------------------------ */

  const copyRows = (await json(`/project-api/projects?dirs=${enc(copy)}`)).body;
  const target = copyRows[0].project;

  for (const bad of ["..", "%2e%2e%2f%2e%2e", "prj-not-served-here"]) {
    const refused = await del(`/project-api/projects/${enc(bad)}?dirs=${enc(copy)}`);
    check(
      `DELETE of ${JSON.stringify(bad)} is refused rather than resolved`,
      refused.status >= 400,
      `${refused.status} ${JSON.stringify(refused.body).slice(0, 160)}`,
    );
  }
  check("…and the copy still exists after all of them", existsSync(join(copy, "project.json")));

  /* The UI half, briefly: the app on this served set, before and after the delete. */
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await useLocale(context, LOCALE);
  log(`language: ${LOCALE}`);
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/projects?dirs=${enc(copy)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".project-row", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));

  const deleted = await del(`/project-api/projects/${enc(target.id)}?agent=check-projects&dirs=${enc(copy)}`);
  check(
    `deleting ${target.name} answers with what it removed`,
    deleted.status === 200 &&
      deleted.body.id === target.id &&
      deleted.body.name === target.name &&
      deleted.body.counts.workTotal === target.counts.workTotal,
    `${deleted.status} ${JSON.stringify(deleted.body).slice(0, 240)}`,
  );
  check("…and the folder is off the disk, records and all", !existsSync(copy), copy);
  check(
    "…and asking for it again is a missing project, not a second delete",
    (await del(`/project-api/projects/${enc(target.id)}?dirs=${enc(copy)}`)).status >= 400,
  );

  /* A link into the project that is gone: the designed screen, with no retry. */
  await page.goto(`${ORIGIN}/p/${enc(target.id)}?dirs=${enc(copy)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".error-state", { state: "visible", timeout: 15_000 });
  const stale = await page.evaluate(() => ({
    title: document.querySelector(".error-state .error-title")?.textContent?.trim() ?? "",
    retry: !!document.querySelector(".error-actions button"),
    out: document.querySelector(".error-actions a")?.textContent?.trim() ?? null,
  }));
  check(
    "a link into the deleted project lands on the app's designed screen",
    stale.title === T("proj.notRegistered", target.id),
    `headline reads "${stale.title}", expected "${T("proj.notRegistered", target.id)}"`,
  );
  check("…offering no Try again, because a retry cannot help", !stale.retry);
  check(
    "…and a way out instead",
    stale.out === T("nav.allProjects"),
    `the action reads "${stale.out}"`,
  );

  await browser.close();
  browser = null;

  /* ------------------------------------------------------------------ *
     4. a folder that moved — spaces, parentheses, identical payloads
     ------------------------------------------------------------------ */

  const movedHome = join(temp("agentmon-move-"), "My Agent Records (moved) 2026", "AgentMonitoring");
  mkdirSync(movedHome, { recursive: true });
  cpSync(REPO_DATA, movedHome, { recursive: true });

  const here = `?dirs=${enc(REPO_DATA)}`;
  const there = `?dirs=${enc(movedHome)}`;
  const id = "prj-agent-monitoring";
  const routes = [
    "/project-api/projects",
    `/project-api/projects/${id}`,
    `/project-api/projects/${id}/worklogs`,
    `/project-api/projects/${id}/bugs`,
    `/project-api/projects/${id}/notes`,
    `/project-api/projects/${id}/events`,
    `/project-api/projects/${id}/status`,
  ];
  let identical = 0;
  const differing = [];
  for (const route of routes) {
    if ((await scrubbed(`${route}${here}`)) === (await scrubbed(`${route}${there}`))) identical += 1;
    else differing.push(route);
  }
  check(
    `every payload is identical from the moved copy, paths aside (${identical}/${routes.length})`,
    differing.length === 0,
    `differ: ${differing.join(", ")}`,
  );

  /* ------------------------------------------------------------------ *
     5. the same records with Windows line endings
     ------------------------------------------------------------------ */

  const crlfHome = join(temp("agentmon-crlf-"), "AgentMonitoring");
  mkdirSync(crlfHome, { recursive: true });
  cpSync(REPO_DATA, crlfHome, { recursive: true });
  let converted = 0;
  const toCrlf = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        toCrlf(path);
      } else if (/\.(md|jsonl|json)$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        writeFileSync(path, text.replace(/\r?\n/g, "\r\n"));
        converted += 1;
      }
    }
  };
  toCrlf(crlfHome);

  const crlf = `?dirs=${enc(crlfHome)}`;
  let crlfSame = 0;
  const crlfDiffer = [];
  for (const route of routes) {
    if ((await scrubbed(`${route}${here}`)) === (await scrubbed(`${route}${crlf}`))) crlfSame += 1;
    else crlfDiffer.push(route);
  }
  check(
    `CRLF line endings change nothing in the payloads (${crlfSame}/${routes.length}, ${converted} files converted)`,
    crlfDiffer.length === 0 && converted > 0,
    `differ: ${crlfDiffer.join(", ")}`,
  );

  // And the record bodies themselves, which is where dropped sentences lived.
  const works = (await json(`/project-api/projects/${id}/worklogs${here}`)).body;
  const bugs = (await json(`/project-api/projects/${id}/bugs${here}`)).body;
  const notes = (await json(`/project-api/projects/${id}/notes${here}`)).body;
  const details = [
    ...works.slice(0, 3).map((w) => `/project-api/projects/${id}/worklogs/${w.id}`),
    ...bugs.slice(0, 3).map((b) => `/project-api/projects/${id}/bugs/${b.id}`),
    ...notes.slice(0, 3).map((n) => `/project-api/projects/${id}/notes/${n.name}`),
  ];
  const bodyDiffer = [];
  for (const route of details) {
    if ((await scrubbed(`${route}${here}`)) !== (await scrubbed(`${route}${crlf}`))) bodyDiffer.push(route);
  }
  check(
    `…including every record body, carriage returns and all (${details.length - bodyDiffer.length}/${details.length})`,
    bodyDiffer.length === 0,
    `differ: ${bodyDiffer.join(", ")}`,
  );

  /* The claim under all of it: no carriage return ever reaches the app. Checked on the
     *decoded* values, not on the JSON text — several of this repo's own records discuss
     line endings, so the two characters backslash and r appear in the payload as prose. */
  const hasCr = (v) =>
    typeof v === "string"
      ? v.includes("\r")
      : v && typeof v === "object"
        ? Object.values(v).some(hasCr)
        : false;
  const anyCr = [];
  for (const route of [...routes, ...details]) {
    const { body } = await json(`${route}${crlf}`);
    if (hasCr(body)) anyCr.push(route);
  }
  check("no payload from the CRLF copy contains a carriage return", anyCr.length === 0, anyCr.join(", "));

  const repoAfter = fingerprint(REPO_DATA);
  const changed = diffFingerprints(repoBefore, repoAfter);
  check("./AgentMonitoring is byte-identical to how this gate found it", changed.length === 0, changed.join(", "));
} catch (err) {
  failures += 1;
  console.error(`[check:projects] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
  for (const dir of temps) {
    if (KEEP) log(`kept ${dir}`);
    else {
      rmSync(dir, { recursive: true, force: true });
      rmSync(`${dir}-moved`, { recursive: true, force: true });
    }
  }
}

log(failures === 0 ? `clean: ${checks} checks passed` : `${failures} of ${checks} checks failed`);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
