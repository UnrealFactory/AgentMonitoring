#!/usr/bin/env node
/**
 * Capture every screen of the app to progress/shots/.
 *
 *   npm run screenshot
 *
 * Boots the Vite dev server itself (browser mode, so no Tauri build is needed), waits for
 * the vault API to actually answer, discovers which records exist instead of hard-coding
 * ids, and waits for a content selector on each screen before shooting. There is not a
 * single fixed sleep in here: on a slow machine the script waits longer, it does not
 * photograph a half-painted page.
 *
 * Flags:
 *   --keep-server   leave the dev server running afterwards
 *   --url <origin>  shoot against an already-running server (implies --keep-server)
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsDir = join(root, "progress", "shots");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ORIGIN = value("--url", "http://localhost:5173").replace(/\/$/, "");
const KEEP = flag("--keep-server") || args.includes("--url");
const VIEWPORT = { width: 1600, height: 1000 };
const SCALE = 1.5;
const BOOT_TIMEOUT_MS = 90_000;

const log = (...m) => console.log("[screenshot]", ...m);

/** Is a vault-api server already answering on ORIGIN? */
async function ping() {
  try {
    const res = await fetch(`${ORIGIN}/vault-api/vault`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function waitForServer(child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`dev server exited early with code ${child.exitCode}`);
    }
    const info = await ping();
    if (info) return info;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vault API did not answer on ${ORIGIN} within ${BOOT_TIMEOUT_MS / 1000}s`);
}

function startServer() {
  // Run vite's entry directly: no shell, no .cmd wrapper, one process to kill.
  const child = spawn(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  child.stdout.on("data", (d) => process.env.DEBUG_SERVER && process.stdout.write(`  vite| ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`  vite| ${d}`));
  return child;
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET /vault-api${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

async function shoot(page, { name, path, waitFor }) {
  const url = `${ORIGIN}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(waitFor, { state: "visible", timeout: 30_000 });
  // Skeletons must be gone, and the bundled font must be applied, before we shoot.
  await page.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const el = document.querySelector(".page-title, .record-title");
    return !!el && el.getBoundingClientRect().width > 0;
  });
  const file = join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  log(`${name.padEnd(12)} ${path}`);
  return file;
}

let server = null;
let browser = null;
let failed = false;

try {
  mkdirSync(shotsDir, { recursive: true });

  const running = await ping();
  if (running) {
    log(`using the server already listening on ${ORIGIN}`);
  } else if (args.includes("--url")) {
    throw new Error(`nothing is serving ${ORIGIN}`);
  } else {
    log("starting vite dev server…");
    server = startServer();
  }

  const vault = running ?? (await waitForServer(server));
  log(`vault: ${vault.name} (${vault.path})`);

  const projects = await api("/projects");
  if (!projects.length) throw new Error("the vault has no projects — nothing to screenshot");
  const slug = projects[0].slug;

  const works = await api(`/projects/${slug}/worklogs`);
  const bugs = await api(`/projects/${slug}/bugs`);
  if (!works.length) throw new Error(`project '${slug}' has no worklogs — nothing to screenshot`);
  if (!bugs.length) throw new Error(`project '${slug}' has no bugs — nothing to screenshot`);

  // Prefer records that exercise the full page: a finished work log has an Outcome,
  // a resolved bug has a Resolution.
  const work = works.find((w) => w.status === "done") ?? works[0];
  const bug =
    bugs.find((b) => (b.status === "resolved" || b.status === "closed") && b.commentCount > 0) ??
    bugs.find((b) => b.status === "resolved" || b.status === "closed") ??
    bugs[0];

  const screens = [
    { name: "dashboard", path: `/p/${slug}`, waitFor: ".stat-row .stat-value" },
    { name: "work-list", path: `/p/${slug}/work`, waitFor: "table.table-rows tbody tr" },
    { name: "work-detail", path: `/p/${slug}/work/${work.id}`, waitFor: ".record-title" },
    { name: "bugs", path: `/p/${slug}/bugs`, waitFor: ".issue-list .issue" },
    { name: "bug-detail", path: `/p/${slug}/bugs/${bug.id}`, waitFor: ".record-title" },
    { name: "projects", path: "/projects", waitFor: ".project-card" },
  ];

  for (const s of screens) rmSync(join(shotsDir, `${s.name}.png`), { force: true });

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  page.on("pageerror", (err) => {
    failed = true;
    console.error(`[screenshot] page error: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`[screenshot] console: ${msg.text()}`);
  });

  for (const screen of screens) await shoot(page, screen);

  log(`${screens.length} shots in progress/shots (${VIEWPORT.width}x${VIEWPORT.height} @${SCALE}x)`);
} catch (err) {
  failed = true;
  console.error(`[screenshot] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server && !KEEP) stopServer(server);
  else if (server) log("dev server left running (--keep-server)");
}

process.exit(failed ? 1 : 0);
