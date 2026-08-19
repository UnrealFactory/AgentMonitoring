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
 * Flags (each also readable from the environment, for harnesses that cannot pass argv):
 *   --port <n>       $SHOT_PORT     dev-server port to boot on / shoot against (default 5173)
 *   --only a,b       $SHOT_ONLY     comma list of screen keys, e.g. dashboard,bug-detail
 *   --out <dir>      $SHOT_OUT      where the PNGs go (default progress/shots)
 *   --project <slug> $SHOT_PROJECT  which project to shoot (default: the richest one)
 *   --record <ids>   $SHOT_RECORD   WORK-/BUG- ids the detail screens should open
 *   --keep-server    leave the dev server running afterwards
 *   --url <origin>   shoot against an already-running server (implies --keep-server)
 *
 * Two critics can therefore run at the same time without fighting over port 5173 or
 * overwriting each other's files:
 *
 *   SHOT_PORT=5180 SHOT_ONLY=dashboard SHOT_OUT=/tmp/a npm run screenshot
 *   SHOT_PORT=5181 SHOT_ONLY=bug-detail SHOT_OUT=/tmp/b npm run screenshot
 *
 * Detail screens are shot twice: `work-detail.png` at the window size (what a human sees)
 * and `work-detail-full.png` with the whole record in one image (what a reviewer reads).
 */
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { chromium } from "playwright";
import { ensureServer, repoRoot as root, stopServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const widthArg = Number(
  (process.argv.includes("--width") ? process.argv[process.argv.indexOf("--width") + 1] : null) ||
    process.env.SHOT_WIDTH ||
    1600,
);
const VIEWPORT = { width: Number.isFinite(widthArg) && widthArg >= 320 ? widthArg : 1600, height: 1000 };
const SCALE = 1.5;
const VIEWPORT_TEXT = `${VIEWPORT.width}x${VIEWPORT.height}`;

if (flag("--help") || flag("-h")) {
  console.log(`Capture the app's screens to PNG.

  npm run screenshot                                every screen -> progress/shots/
  npm run screenshot -- --only bugs                 one screen
  npm run screenshot -- --project relay             a specific project
  npm run screenshot -- --record WORK-0009,BUG-0004 specific records on the detail screens
  SHOT_PORT=5180 SHOT_ONLY=dashboard SHOT_OUT=/tmp/a npm run screenshot

Options (flag, or environment variable):
  --port <n>       $SHOT_PORT     dev-server port to boot on / shoot against (default 5173)
  --width <n>      $SHOT_WIDTH    viewport width (default 1600; the shell is judged at 1152 too)
  --only a,b       $SHOT_ONLY     screens: dashboard, work-list, work-detail, bugs, bug-detail,
                                  projects, palette, palette-vault
  --out <dir>      $SHOT_OUT      output directory (default progress/shots)
  --project <slug> $SHOT_PROJECT  project to shoot (default: the one with the most records)
  --record <ids>   $SHOT_RECORD   record ids for the detail screens, e.g. WORK-0009 or
                                  WORK-0009,BUG-0004 (default: a finished work log and a
                                  resolved bug, so Outcome and Resolution are on screen)
  --url <origin>                  shoot an already-running server (implies --keep-server)
  --keep-server                   leave the dev server running afterwards

Detail screens produce two files: work-detail.png at ${VIEWPORT_TEXT} (what a human sees on
screen) and work-detail-full.png with the entire record in one tall image.

Two runs with different --port and --out are safe at the same time.`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[screenshot] FAILED: --port/$SHOT_PORT must be a port number, got "${PORT}"`);
  process.exit(1);
}
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const ONLY = (value("--only", process.env.SHOT_ONLY) || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const outArg = value("--out", process.env.SHOT_OUT);
const shotsDir = outArg
  ? isAbsolute(outArg)
    ? outArg
    : join(root, outArg)
  : join(root, "progress", "shots");
const KEEP = flag("--keep-server") || args.includes("--url");
const WANT_PROJECT = (value("--project", process.env.SHOT_PROJECT) || "").trim();
const WANT_RECORDS = (value("--record", process.env.SHOT_RECORD) || "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/**
 * The app scrolls inside `.main`, so the document is always exactly one viewport tall and
 * Playwright's fullPage would capture nothing extra. For the tall shot we hand scrolling
 * back to the document; the sticky rail is pinned in place so it cannot smear.
 */
const FULL_PAGE_CSS = `
  html, body, #root { height: auto; }
  .app { height: auto; min-height: 100vh; }
  .main, .sidebar { overflow: visible; }
  .sidebar-foot { margin-top: var(--space-6); }
  .detail-side { position: static; }
`;

const log = (...m) => console.log("[screenshot]", ...m);

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET /vault-api${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

async function shoot(page, { name, path, waitFor, prepare, full }) {
  const url = `${ORIGIN}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (prepare) await prepare(page);
  await page.waitForSelector(waitFor, { state: "visible", timeout: 30_000 });
  // Skeletons must be gone, and the bundled font must be applied, before we shoot.
  await page.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const el = document.querySelector(".page-title, .record-title");
    return !!el && el.getBoundingClientRect().width > 0;
  });
  // Charts are drawn at the measured pixel width of their container, so they appear one
  // frame after the data does. Shooting between the two photographs empty cards.
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
  );
  const file = join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  log(`${name.padEnd(12)} ${path}`);

  // Detail screens also get the whole record in one image, for reading rather than judging
  // the window. The injected stylesheet dies with the navigation to the next screen.
  if (full) {
    const style = await page.addStyleTag({ content: FULL_PAGE_CSS });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.screenshot({ path: join(shotsDir, `${name}-full.png`), fullPage: true });
    await style.evaluate((el) => el.remove());
    log(`${`${name}-full`.padEnd(12)} ${path} (full page)`);
  }
  return file;
}

let server = null;
let browser = null;
let failed = false;

try {
  mkdirSync(shotsDir, { recursive: true });

  const started = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  });
  server = started.server;
  log(`vault: ${started.vault.name} (${started.vault.path})`);

  const projects = await api("/projects");
  if (!projects.length) throw new Error("the vault has no projects — nothing to screenshot");

  let project;
  if (WANT_PROJECT) {
    project = projects.find((p) => p.slug === WANT_PROJECT);
    if (!project) {
      throw new Error(
        `no project '${WANT_PROJECT}' in this vault (--project/$SHOT_PROJECT). ` +
          `Known slugs: ${projects.map((p) => p.slug).join(", ")}`,
      );
    }
  } else {
    // Default to the project with the most records: it is the one whose screens are worth
    // judging. `--project` pins a different one.
    project = [...projects].sort(
      (a, b) =>
        b.counts.workTotal + b.counts.bugsTotal - (a.counts.workTotal + a.counts.bugsTotal) ||
        a.slug.localeCompare(b.slug),
    )[0];
  }
  const slug = project.slug;

  const works = await api(`/projects/${slug}/worklogs`);
  const bugs = await api(`/projects/${slug}/bugs`);
  if (!works.length) throw new Error(`project '${slug}' has no worklogs — nothing to screenshot`);
  if (!bugs.length) throw new Error(`project '${slug}' has no bugs — nothing to screenshot`);

  /** `--record WORK-0009,BUG-0004` pins what the detail screens open; each id must exist. */
  const pick = (ids, prefix) => {
    const wanted = ids.find((id) => id.startsWith(prefix));
    if (!wanted) return null;
    const found = (prefix === "WORK" ? works : bugs).find((r) => r.id === wanted);
    if (!found) {
      throw new Error(
        `no ${wanted} in project '${slug}' (--record/$SHOT_RECORD). ` +
          `Known ids: ${(prefix === "WORK" ? works : bugs).map((r) => r.id).join(", ")}`,
      );
    }
    return found;
  };
  const unknownPrefix = WANT_RECORDS.filter((id) => !/^(WORK|BUG)-\d+$/.test(id));
  if (unknownPrefix.length) {
    throw new Error(
      `--record/$SHOT_RECORD wants ids like WORK-0009 or BUG-0004, got ${unknownPrefix.join(", ")}`,
    );
  }

  // Prefer records that exercise the full page: a finished work log has an Outcome,
  // a resolved bug has a Resolution.
  const work =
    pick(WANT_RECORDS, "WORK") ??
    works.find((w) => w.status === "done" && w.updateCount > 0) ??
    works.find((w) => w.status === "done") ??
    works[0];
  const bug =
    pick(WANT_RECORDS, "BUG") ??
    bugs.find((b) => (b.status === "resolved" || b.status === "closed") && b.commentCount > 0) ??
    bugs.find((b) => b.status === "resolved" || b.status === "closed") ??
    bugs[0];
  log(`project: ${slug} · work-detail: ${work.id} · bug-detail: ${bug.id}`);

  const all = [
    { name: "dashboard", path: `/p/${slug}`, waitFor: ".now-strip .now-hero-value" },
    { name: "work-list", path: `/p/${slug}/work`, waitFor: ".work-rows .work-row" },
    { name: "work-detail", path: `/p/${slug}/work/${work.id}`, waitFor: ".record-title", full: true },
    {
      name: "bugs",
      path: `/p/${slug}/bugs`,
      waitFor: ".work-rows .bug-row, .empty-title",
      // The board opens on "Open", which is the right default for the app and a poor
      // photograph of it: this vault has two open bugs and six fixed ones, so the default
      // tab shows a quarter of the board. Below four open rows the shot switches to "All"
      // (every state, every severity) and says so in the log, rather than photographing
      // the emptiest view of a screen whose job is density.
      prepare: async (page) => {
        await page.waitForSelector(".segmented [role=tab]", { state: "visible" });
        await page.waitForFunction(
          () => !!document.querySelector(".work-rows .bug-row, .empty-title"),
        );
        const open = await page.locator(".work-rows .bug-row").count();
        if (open < 4) {
          await page.getByRole("tab", { name: /^All/ }).click();
          log(`bugs: captured the All tab (${open} open bug(s) — the Open tab is the default)`);
        }
      },
    },
    { name: "bug-detail", path: `/p/${slug}/bugs/${bug.id}`, waitFor: ".record-title", full: true },
    { name: "projects", path: "/projects", waitFor: ".project-row" },
    {
      // The command palette is a screen like any other — it is what Ctrl+K opens — so it
      // gets photographed rather than described.
      name: "palette",
      path: `/p/${slug}`,
      waitFor: ".palette-item",
      prepare: async (page) => {
        await page.waitForSelector(".page-title", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.keyboard.press("Control+K");
      },
    },
    {
      // …and again from the vault screen, which is where it used to have nothing to offer:
      // records are loaded for every project, not only for the slug in the URL.
      name: "palette-vault",
      path: "/projects",
      waitFor: ".palette-item",
      prepare: async (page) => {
        await page.waitForSelector(".project-row", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.keyboard.press("Control+K");
        await page.waitForSelector(".palette-input", { state: "visible" });
        await page.waitForFunction(
          () => document.querySelectorAll(".palette-item").length > 3,
          null,
          { timeout: 15_000 },
        );
      },
    },
  ];

  const unknown = ONLY.filter((k) => !all.some((s) => s.name === k));
  if (unknown.length) {
    throw new Error(
      `unknown screen ${unknown.map((u) => `"${u}"`).join(", ")} in --only/$SHOT_ONLY. ` +
        `Valid keys: ${all.map((s) => s.name).join(", ")}`,
    );
  }
  const screens = ONLY.length ? all.filter((s) => ONLY.includes(s.name)) : all;

  for (const s of screens) {
    rmSync(join(shotsDir, `${s.name}.png`), { force: true });
    if (s.full) rmSync(join(shotsDir, `${s.name}-full.png`), { force: true });
  }

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

  log(`${screens.length} shot(s) in ${shotsDir} (${VIEWPORT.width}x${VIEWPORT.height} @${SCALE}x)`);
} catch (err) {
  failed = true;
  console.error(`[screenshot] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server && !KEEP) await stopServer(server);
  else if (server) log(`dev server left running on ${ORIGIN} (--keep-server)`);
}

// One tick for libuv to finish closing the sockets the vault-api fetches left behind:
// exiting in the middle of that abandons the process with a UV assertion on Windows,
// which looks like a crash to whoever is reading the log.
await new Promise((r) => setTimeout(r, 60));
process.exit(failed ? 1 : 0);
