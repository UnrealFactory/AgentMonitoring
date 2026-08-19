#!/usr/bin/env node
/**
 * Prove the app serves the vault it was told to serve — or nothing.
 *
 *   npm run check:vault
 *   node scripts/check-vault.mjs [--port 5201] [--keep]
 *
 * This is the gate for the P5 round-1 portability verdict. Browser mode used to treat
 * `AGENTMON_VAULT` as the first *candidate* of a fall-through list, so a configured vault
 * that could not be read was answered with `<repo>/vault` — this project's own live history
 * — for reads and for writes, with nothing on screen saying so. A reader watching a bug
 * board saw two bugs get "resolved" 2.5 seconds after a directory was renamed on another
 * machine's disk. The desktop app never had the bug (`Vault::resolve` in
 * crates/agentmon-core/src/vault.rs makes it a hard error), and the two implementations are
 * supposed to stay in parity, so the gate checks the JS one against the same rule:
 *
 *   1. **A configured vault is authoritative.** A broken `AGENTMON_VAULT` fails every
 *      route, names the directory it was told to open, and never serves another vault —
 *      including on the write path, which is how the app's own "New project" button could
 *      have written into this repo's real history.
 *   2. **A vault that vanishes under an open window is visible.** The window keeps the last
 *      good data (it does not blank), says it is not reading the vault, does not silently
 *      switch to a different one, and recovers on its own when the directory comes back.
 *   3. **`source` is what happened**, not a guess: `?vault=` says `?vault=`, the environment
 *      says `env`, neither says `cwd/vault`. That field is the only place a human can check
 *      which vault they are on.
 *   4. **A vault is portable.** The same directory copied somewhere else — under a name with
 *      spaces and parentheses — serves byte-identical payloads.
 *
 * It never writes to ./vault: the one write it attempts is required to fail, and the vault
 * is hashed before and after to prove it did.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Prove the vault the app serves is the vault it was configured with.

  npm run check:vault
  node scripts/check-vault.mjs [--port 5201] [--keep]

  --port <n>   dev-server port (default 5201, its own so it never fights another run)
  --keep       leave the temp vault copies behind for inspection

Never writes to ./vault (and proves it: the vault is hashed before and after).`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.VAULT_PORT || 5201));
const ORIGIN = `http://localhost:${PORT}`;
const KEEP = args.includes("--keep");
const log = (...m) => console.log("[check:vault]", ...m);

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

/**
 * Rename, with a few attempts.
 *
 * Windows refuses to move a directory while anything inside it is open, and the dev server
 * stat-walks every record file twice a second for the liveness cursor — so a rename issued
 * at the wrong moment fails with EPERM even though nothing is holding the directory open.
 */
async function renameWithRetry(from, to, tries = 40) {
  for (let i = 0; ; i += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

/** Every file in a directory tree, with its sha1 — for "this vault was not touched". */
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

const post = async (path, body) => {
  const res = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
};

const REPO_VAULT = join(repoRoot, "vault");
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
 * Nothing may already be listening on this port.
 *
 * Learned the hard way: a dev server left running by another tool answered this gate's
 * requests from `<repo>/vault`, every "it refuses to serve another vault" check passed for
 * the wrong reason, and the write test — which is supposed to be refused — created a
 * project in this repo's real history through it. A gate that can be answered by somebody
 * else's server is not a gate.
 */
async function requireFreePort() {
  try {
    const res = await fetch(`${ORIGIN}/vault-api/vault`, { signal: AbortSignal.timeout(1500) });
    throw new Error(
      `something is already serving ${ORIGIN} (answered ${res.status}). This gate must own its ` +
        `server — stop that one, or run with --port <n>.`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("something is already serving")) throw err;
    /* nothing there: exactly what we want */
  }
}

/** Wait until *our* child is answering — and give up if it died (a port clash exits it). */
async function waitForOurServer(child, { expectApi = true } = {}) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the dev server exited with code ${child.exitCode} (port ${PORT} taken?)`);
    }
    try {
      const res = await fetch(`${ORIGIN}/vault-api/vault`, { signal: AbortSignal.timeout(1500) });
      // A vault that cannot be opened answers with an error, which still proves the server
      // is up — that is the whole point of the first phase.
      if (!expectApi || res.ok) return;
      if (res.status >= 400) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the dev server did not answer on ${ORIGIN} within 90s`);
}

try {
  if (!existsSync(join(REPO_VAULT, "vault.json"))) {
    throw new Error(`no vault at ${REPO_VAULT} — this gate compares against the repo's own vault`);
  }
  const repoBefore = fingerprint(REPO_VAULT);
  log(`repo vault: ${REPO_VAULT} (${repoBefore.size} files, hashed)`);

  /* ------------------------------------------------------------------ *
     1. a configured vault that cannot be read is an error, not a fallback
     ------------------------------------------------------------------ */

  await requireFreePort();

  const missing = join(temp("agentmon-gone-"), "not-a-vault");
  log(`starting a dev server with AGENTMON_VAULT=${missing} (which does not exist)…`);
  server = startServer(PORT, { env: { AGENTMON_VAULT: missing } });
  await waitForOurServer(server);

  const info = await json("/vault-api/vault");
  check(
    "a broken AGENTMON_VAULT fails the request instead of serving another vault",
    info.status >= 400 && typeof info.body?.error === "string",
    `GET /vault-api/vault -> ${info.status} ${JSON.stringify(info.body).slice(0, 200)}`,
  );
  check(
    "…and the error names the directory it was told to open",
    typeof info.body?.error === "string" && info.body.error.includes(missing),
    String(info.body?.error).slice(0, 300),
  );
  check(
    "…and never mentions the repo's own vault as the thing it served",
    !JSON.stringify(info.body).includes(`"path"`),
    JSON.stringify(info.body).slice(0, 200),
  );

  const projects = await json("/vault-api/projects");
  check(
    "the project list fails the same way (no half-open vault)",
    projects.status >= 400 && !Array.isArray(projects.body),
    `GET /vault-api/projects -> ${projects.status} ${JSON.stringify(projects.body).slice(0, 200)}`,
  );

  const cursor = await json("/vault-api/cursor");
  check(
    "the liveness cursor fails too, so an open window finds out",
    cursor.status >= 400,
    `GET /vault-api/cursor -> ${cursor.status}`,
  );

  /* The write test only runs once the reads have proved this server has no vault open. A
     POST that lands is a project created for real, and the last thing this gate may do is
     be the bug it is testing for. */
  if (info.status < 400) {
    throw new Error(
      `refusing to test the write path: ${ORIGIN} answered /vault-api/vault with 200 ` +
        `(${JSON.stringify(info.body).slice(0, 120)}), so it has a vault open and a POST would ` +
        `write into it`,
    );
  }
  const write = await post("/vault-api/projects", {
    slug: "check-vault-must-not-exist",
    name: "check:vault must never write this",
    agent: "check-vault",
  });
  check(
    "a write against a broken AGENTMON_VAULT is refused",
    write.status >= 400,
    `POST /vault-api/projects -> ${write.status} ${JSON.stringify(write.body).slice(0, 200)}`,
  );
  check(
    "…and nothing was written into the repo's vault",
    !existsSync(join(REPO_VAULT, "projects", "check-vault-must-not-exist")),
    `${join(REPO_VAULT, "projects", "check-vault-must-not-exist")} exists`,
  );

  // The same server, pointed at a real vault by ?vault=: an explicit choice still works.
  const copy = temp("agentmon-vault-");
  cpSync(REPO_VAULT, copy, { recursive: true });
  const override = await json(`/vault-api/vault?vault=${enc(copy)}`);
  check(
    "?vault= still opens a real vault even while the environment's is broken",
    override.status === 200 && override.body.path === copy,
    `${override.status} ${JSON.stringify(override.body).slice(0, 200)}`,
  );
  check(
    "…and reports ?vault= as the source, not the environment",
    override.body?.source === "?vault=",
    `source=${override.body?.source}`,
  );

  await stopServer(server);
  server = null;

  /* ------------------------------------------------------------------ *
     2. the vault vanishes under an open window
     ------------------------------------------------------------------ */

  const live = temp("agentmon-live-");
  cpSync(REPO_VAULT, live, { recursive: true });
  const moved = `${live}-moved`;

  await requireFreePort();
  log(`starting a dev server on ${ORIGIN} against ${live}…`);
  server = startServer(PORT, { env: { AGENTMON_VAULT: live } });
  await waitForServer(server, ORIGIN);

  const served = (await json("/vault-api/vault")).body;
  check("the configured vault is the one served", served.path === live, JSON.stringify(served));
  check("…and it says so: source=env", served.source === "env", `source=${served.source}`);

  const all = (await json("/vault-api/projects")).body;
  const slug = [...all].sort((a, b) => b.counts.events - a.counts.events)[0].slug;

  browser = await chromium.launch();
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })
  ).newPage();
  let loads = 0;
  page.on("load", () => (loads += 1));
  await page.goto(`${ORIGIN}/p/${slug}/work`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".work-rows .work-row", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
  // …and the shell too: a sidebar still reading "resolving…" is a page mid-load, not a
  // baseline to compare against.
  await page.waitForFunction(
    () => !/resolving/.test(document.querySelector(".vault-path-value")?.textContent ?? "x"),
  );

  const board = () =>
    page.evaluate(() => ({
      sub: document.querySelector(".page-sub")?.textContent?.trim() ?? "",
      rows: document.querySelectorAll(".work-rows .work-row").length,
      vault: document.querySelector(".vault-path-value")?.textContent?.trim() ?? "",
      alert: document.querySelector(".vault-alert-text")?.textContent?.trim() ?? null,
    }));
  const before = await board();
  loads = 0;
  log(`board before: ${before.sub} (${before.rows} rows), sidebar "${before.vault}"`);

  await renameWithRetry(live, moved);
  log(`renamed the vault directory out from under the open window`);

  // The banner has to arrive on its own: two failed polls, so ~4-6s.
  const deadline = Date.now() + 20_000;
  let after = await board();
  while (Date.now() < deadline && !after.alert) {
    await page.waitForTimeout(400);
    after = await board();
  }

  check(
    "an open window says it is not reading the vault any more",
    !!after.alert,
    `no .vault-alert after 20s; board reads "${after.sub}"`,
  );
  check(
    "…and the banner names the vault it lost",
    !!after.alert && after.alert.includes(live),
    String(after.alert).slice(0, 300),
  );
  check(
    "…and the page keeps the data it had rather than blanking",
    after.rows === before.rows && after.sub === before.sub,
    `${before.rows} rows / "${before.sub}" -> ${after.rows} rows / "${after.sub}"`,
  );
  check(
    "…and did not quietly switch to the repo's own vault",
    !after.vault.includes("AgentMonitoring\\vault") && !after.vault.includes("AgentMonitoring/vault"),
    `sidebar now reads "${after.vault}"`,
  );
  check("…without reloading the page", loads === 0, `${loads} load events`);

  const stillGone = await json("/vault-api/projects");
  check(
    "the server also refuses to substitute a vault for the one that vanished",
    stillGone.status >= 400 && String(stillGone.body?.error ?? "").includes(live),
    `${stillGone.status} ${JSON.stringify(stillGone.body).slice(0, 200)}`,
  );

  await renameWithRetry(moved, live);
  const recovered = Date.now() + 45_000;
  let back = await board();
  while (Date.now() < recovered && back.alert) {
    await page.waitForTimeout(400);
    back = await board();
  }
  check(
    "when the vault comes back the window recovers on its own",
    !back.alert && back.rows === before.rows,
    `alert=${back.alert}, ${back.rows} rows (expected ${before.rows})`,
  );
  check("…and still without a reload", loads === 0, `${loads} load events`);

  /* ------------------------------------------------------------------ *
     2b. archiving a project is a change the whole app agrees about
     ------------------------------------------------------------------ */

  const archived = all.find((p) => p.slug !== slug) ?? all[0];
  const archiveRes = await post(`/vault-api/projects/${enc(archived.slug)}/status`, {
    status: "archived",
    agent: "check-vault",
  });
  check(
    `archiving ${archived.slug} goes through the same core write path`,
    archiveRes.status === 200 && archiveRes.body.status === "archived",
    `${archiveRes.status} ${JSON.stringify(archiveRes.body).slice(0, 200)}`,
  );

  await page.goto(`${ORIGIN}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".project-row", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
  const counts = await page.evaluate(() => {
    const fact = (label) =>
      [...document.querySelectorAll(".vault-bar-facts div")]
        .find((d) => d.querySelector("dt")?.textContent?.trim() === label)
        ?.querySelector("dd")
        ?.textContent?.trim() ?? null;
    return {
      vaultBar: fact("Active projects"),
      sidebar:
        [...document.querySelectorAll(".nav-item")]
          .find((n) => n.textContent?.trim().startsWith("Projects"))
          ?.querySelector(".nav-count")
          ?.textContent?.trim() ?? null,
      activeRows: document.querySelectorAll(".project-section .project-rows .project-row").length,
    };
  });
  check(
    "the vault bar and the sidebar count the same projects after an archive",
    counts.sidebar === String(all.length - 1) && counts.vaultBar?.startsWith(String(all.length - 1)),
    `vault bar "${counts.vaultBar}", sidebar "${counts.sidebar}", ${all.length} projects in the vault`,
  );
  check(
    "…and the vault bar says how many are archived rather than hiding them",
    (counts.vaultBar ?? "").includes("1 archived"),
    `vault bar reads "${counts.vaultBar}"`,
  );

  await page.goto(`${ORIGIN}/p/${archived.slug}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".page-title", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
  const onArchived = await page.evaluate(() => ({
    head: document.querySelector(".page-head-meta")?.textContent?.trim() ?? "",
    live: !!document.querySelector(".live-flag"),
    archived: !!document.querySelector(".page-head-meta .pill-archived"),
  }));
  check(
    "an archived project's dashboard says archived, not live",
    onArchived.archived && !onArchived.live,
    `head reads "${onArchived.head}"`,
  );

  await page.click(".switcher-button");
  const inSwitcher = await page.evaluate(() =>
    [...document.querySelectorAll(".switcher-item-name")].map((n) => n.textContent?.trim()),
  );
  check(
    "…and the switcher still lists the project the reader is standing on",
    inSwitcher.some((n) => n?.startsWith(archived.name)),
    `switcher offers ${JSON.stringify(inSwitcher)}`,
  );

  const restored = await post(`/vault-api/projects/${enc(archived.slug)}/status`, {
    status: "active",
    agent: "check-vault",
  });
  check(
    "unarchiving puts it back",
    restored.status === 200 && restored.body.status === "active",
    `${restored.status} ${JSON.stringify(restored.body).slice(0, 160)}`,
  );

  await browser.close();
  browser = null;
  await stopServer(server);
  server = null;

  /* ------------------------------------------------------------------ *
     3 + 4. source reporting, and a vault that moved
     ------------------------------------------------------------------ */

  await requireFreePort();
  log("starting a dev server with no AGENTMON_VAULT (the repo's own vault)…");
  server = startServer(PORT, { env: { AGENTMON_VAULT: "" } });
  await waitForServer(server, ORIGIN);

  const plain = (await json("/vault-api/vault")).body;
  check(
    "with nothing configured the vault beside the app is used, and says so",
    plain.path === REPO_VAULT && plain.source === "cwd/vault",
    JSON.stringify(plain),
  );

  // A directory name a human would actually produce, with spaces and parentheses.
  const movedHome = join(temp("agentmon-move-"), "My Agent Vault (moved) 2026");
  mkdirSync(movedHome, { recursive: true });
  cpSync(REPO_VAULT, movedHome, { recursive: true });

  const relocated = (await json(`/vault-api/vault?vault=${enc(movedHome)}`)).body;
  check(
    "a vault copied to a directory with spaces and parentheses opens",
    relocated.path === movedHome && relocated.name === plain.name,
    JSON.stringify(relocated),
  );

  const routes = [
    "/vault-api/projects",
    ...(await json("/vault-api/projects")).body.flatMap((p) => [
      `/vault-api/projects/${enc(p.slug)}`,
      `/vault-api/projects/${enc(p.slug)}/worklogs`,
      `/vault-api/projects/${enc(p.slug)}/bugs`,
      `/vault-api/projects/${enc(p.slug)}/events`,
      `/vault-api/projects/${enc(p.slug)}/status`,
    ]),
  ];
  let identical = 0;
  const differing = [];
  for (const route of routes) {
    const here = await raw(route);
    const there = await raw(`${route}${route.includes("?") ? "&" : "?"}vault=${enc(movedHome)}`);
    if (here.text === there.text) identical += 1;
    else differing.push(route);
  }
  check(
    `every payload is byte-identical from the moved copy (${identical}/${routes.length})`,
    differing.length === 0,
    `differ: ${differing.join(", ")}`,
  );

  const repoAfter = fingerprint(REPO_VAULT);
  const changed = diffFingerprints(repoBefore, repoAfter);
  check("./vault is byte-identical to how this gate found it", changed.length === 0, changed.join(", "));
} catch (err) {
  failures += 1;
  console.error(`[check:vault] FAILED: ${err.message}`);
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
