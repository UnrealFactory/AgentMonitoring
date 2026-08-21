#!/usr/bin/env node
/**
 * Capture every screen of the app to progress/shots/.
 *
 *   npm run screenshot
 *
 * Boots the Vite dev server itself (browser mode, so no Tauri build is needed), waits for
 * the project API to actually answer, discovers which records exist instead of hard-coding
 * ids, and waits for a content selector on each screen before shooting. There is not a
 * single fixed sleep in here: on a slow machine the script waits longer, it does not
 * photograph a half-painted page.
 *
 * Flags (each also readable from the environment, for harnesses that cannot pass argv):
 *   --port <n>       $SHOT_PORT     dev-server port to boot on / shoot against (default 5173)
 *   --only a,b       $SHOT_ONLY     comma list of screen keys, e.g. dashboard,bug-detail
 *   --out <dir>      $SHOT_OUT      where the PNGs go (default progress/shots)
 *   --project <name> $SHOT_PROJECT  which project to shoot, by name or id (default: the richest one)
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
import { useLocale } from "./i18n.mjs";

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
                                  notes-list, note-detail, projects, palette, palette-vault,
                                  menu-project, menu-record, menu-dashboard, menu-switcher,
                                  menu-vault-feed
  --out <dir>      $SHOT_OUT      output directory (default progress/shots)
  --locale <ko|en> $SHOT_LOCALE   language to photograph the app in (default ko)
  --project <name> $SHOT_PROJECT  project to shoot, by name or id (default: the one with the most records)
  --suffix <s>     $SHOT_SUFFIX   append to every file name, so a second project's screens
                                  sit beside the first: --project relay --suffix -relay
  --record <ids>   $SHOT_RECORD   record ids for the detail screens, e.g. WORK-0009 or
                                  WORK-0009,BUG-0004,some-note-name (default: a finished
                                  work log, a resolved bug and the note with the most refs,
                                  so Outcome, Resolution and Related are on screen)
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
/* The canonical set is shot for every project on the list, and two projects cannot both
   be "dashboard.png". A suffix keeps them in one directory, in one alphabetical list, on
   the progress page. */
const SUFFIX = (value("--suffix", process.env.SHOT_SUFFIX) || "").trim();
/* Which language the screens are photographed in. The app defaults to Korean, and a shot
   run is pinned rather than inheriting whatever the last human clicked. */
const LOCALE = (value("--locale", process.env.SHOT_LOCALE) || "ko").trim();
if (SUFFIX && !/^[A-Za-z0-9._-]+$/.test(SUFFIX)) {
  console.error(`[screenshot] FAILED: --suffix/$SHOT_SUFFIX must be a file-name fragment, got "${SUFFIX}"`);
  process.exit(1);
}
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
  .detail-side, .detail-side .side-card { position: static; }
`;

const log = (...m) => console.log("[screenshot]", ...m);

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/project-api${path}`);
  if (!res.ok) throw new Error(`GET /project-api${path} -> ${res.status} ${await res.text()}`);
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
  const file = join(shotsDir, `${name}${SUFFIX}.png`);
  await page.screenshot({ path: file });
  log(`${name.padEnd(12)} ${path}`);

  // Detail screens also get the whole record in one image, for reading rather than judging
  // the window. The injected stylesheet dies with the navigation to the next screen.
  if (full) {
    const style = await page.addStyleTag({ content: FULL_PAGE_CSS });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.screenshot({ path: join(shotsDir, `${name}${SUFFIX}-full.png`), fullPage: true });
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

  const rows = await api("/projects");
  const projects = rows.filter((r) => r.available && r.project).map((r) => r.project);
  if (!projects.length) throw new Error("no readable projects — nothing to screenshot");
  log(`projects: ${projects.map((p) => p.name).join(", ")}`);

  let project;
  if (WANT_PROJECT) {
    project = projects.find((p) => p.name === WANT_PROJECT || p.id === WANT_PROJECT);
    if (!project) {
      throw new Error(
        `no project '${WANT_PROJECT}' on this list (--project/$SHOT_PROJECT). ` +
          `Known projects: ${projects.map((p) => p.name).join(", ")}`,
      );
    }
  } else {
    // Default to the project with the most records: it is the one whose screens are worth
    // judging. `--project` pins a different one.
    project = [...projects].sort(
      (a, b) =>
        b.counts.workTotal + b.counts.bugsTotal - (a.counts.workTotal + a.counts.bugsTotal) ||
        a.name.localeCompare(b.name),
    )[0];
  }
  const slug = project.id;

  const works = await api(`/projects/${slug}/worklogs`);
  const bugs = await api(`/projects/${slug}/bugs`);
  const notes = await api(`/projects/${slug}/notes`);
  if (!works.length) throw new Error(`project '${project.name}' has no worklogs — nothing to screenshot`);
  if (!bugs.length) throw new Error(`project '${project.name}' has no bugs — nothing to screenshot`);

  /** `--record WORK-0009,BUG-0004` pins what the detail screens open; each id must exist. */
  const pick = (ids, prefix) => {
    const wanted = ids.find((id) => id.startsWith(prefix));
    if (!wanted) return null;
    const found = (prefix === "WORK" ? works : bugs).find((r) => r.id === wanted);
    if (!found) {
      throw new Error(
        `no ${wanted} in project '${project.name}' (--record/$SHOT_RECORD). ` +
          `Known ids: ${(prefix === "WORK" ? works : bugs).map((r) => r.id).join(", ")}`,
      );
    }
    return found;
  };
  /* A note's id is its kebab name — the third shape --record accepts. */
  const unknownPrefix = WANT_RECORDS.filter(
    (id) => !/^(WORK|BUG)-\d+$/.test(id) && !/^[A-Z0-9][A-Z0-9-]{1,63}$/.test(id),
  );
  if (unknownPrefix.length) {
    throw new Error(
      `--record/$SHOT_RECORD wants ids like WORK-0009, BUG-0004 or a note's kebab name, got ${unknownPrefix.join(", ")}`,
    );
  }

  // Prefer records that exercise the full page: a finished work log has an Outcome,
  // a resolved bug has a Resolution, and the best note is the most wired-in one.
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
  const wantNote = WANT_RECORDS.map((id) => id.toLowerCase()).find((id) =>
    notes.some((n) => n.name === id),
  );
  const missedNote = WANT_RECORDS.filter(
    (id) => !/^(WORK|BUG)-\d+$/.test(id) && !notes.some((n) => n.name === id.toLowerCase()),
  );
  if (missedNote.length) {
    throw new Error(
      `no note ${missedNote.join(", ")} in project '${project.name}' (--record/$SHOT_RECORD). ` +
        `Known names: ${notes.map((n) => n.name).join(", ") || "(none)"}`,
    );
  }
  const note = wantNote
    ? notes.find((n) => n.name === wantNote)
    : [...notes].sort((a, b) => b.refs.length - a.refs.length)[0] ?? null;
  log(
    `project: ${project.name} · work-detail: ${work.id} · bug-detail: ${bug.id} · ` +
      `note-detail: ${note?.name ?? "(no notes)"} · language: ${LOCALE}`,
  );

  const all = [
    { name: "dashboard", path: `/p/${slug}`, waitFor: ".now-strip .now-hero-value" },
    { name: "work-list", path: `/p/${slug}/work`, waitFor: ".work-rows .work-row" },
    { name: "work-detail", path: `/p/${slug}/work/${work.id}`, waitFor: ".record-title", full: true },
    {
      name: "bugs",
      path: `/p/${slug}/bugs`,
      waitFor: ".work-rows .bug-row, .empty-title",
      // The board opens on "Unresolved", which is the right default for the app and a
      // poor photograph of it: this vault has two unresolved bugs and six resolved ones, so
      // the default tab shows a quarter of the board. Below four rows the shot switches to
      // "All" (every state, every severity) and says so in the log, rather than
      // photographing the emptiest view of a screen whose job is density.
      prepare: async (page) => {
        await page.waitForSelector(".segmented [role=tab]", { state: "visible" });
        await page.waitForFunction(
          () => !!document.querySelector(".work-rows .bug-row, .empty-title"),
        );
        const shown = await page.locator(".work-rows .bug-row").count();
        if (shown < 4) {
          // By `data-value`, not by the tab's words: the app ships in two languages and a
          // gate that reaches for "All" only works in one of them.
          await page.locator('[role="tab"][data-value="all"]').click();
          log(
            `bugs: captured the All tab (${shown} unresolved bug(s) — Unresolved is the default)`,
          );
        }
      },
    },
    { name: "bug-detail", path: `/p/${slug}/bugs/${bug.id}`, waitFor: ".record-title", full: true },
    /* The notes screens exist only when the project has notes; a project without any is
       legal, so the two keys are skipped with a line in the log rather than failed. */
    ...(notes.length
      ? [
          { name: "notes-list", path: `/p/${slug}/notes`, waitFor: ".note-rows .note-row" },
          {
            name: "note-detail",
            path: `/p/${slug}/notes/${note.name}`,
            waitFor: ".record-title",
            full: true,
          },
        ]
      : []),
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
    {
      /* The right button, on the row it was reported broken on: before P8 this was Edge's
         menu — "새 창에서 링크 열기 / 링크 복사 / 검사" — over a project in the sidebar. */
      name: "menu-project",
      path: "/projects",
      waitFor: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".nav-sub", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.locator(".nav-sub").first().click({ button: "right" });
      },
    },
    {
      // …and on a work log, where it is the row's own menu rather than the browser's.
      name: "menu-record",
      path: `/p/${slug}/work`,
      waitFor: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".work-row", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.locator(".work-row").nth(2).click({ button: "right" });
      },
    },
    {
      /* The dashboard is the default landing route, and for one round it was the one screen
         where the right button did nothing: the hero row of "working right now" is a work
         log, and now says so. */
      name: "menu-dashboard",
      path: `/p/${slug}`,
      waitFor: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".now-row", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.locator("a.now-row").first().click({ button: "right" });
      },
    },
    {
      /* "Across the vault", at the foot of /projects: twelve record rows that for two
         rounds were the only rows in the app the right button did not answer — the same
         class and layout as the dashboard feed, on the screen that is both the permanent
         sidebar destination and the recovery screen for a vault that will not open. */
      name: "menu-vault-feed",
      path: "/projects",
      waitFor: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".vault-feed a.feed-row", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page
          .locator('.vault-feed a.feed-row[href*="/work/"], .vault-feed a.feed-row[href*="/bugs/"]')
          .first()
          .click({ button: "right" });
      },
    },
    {
      // The switcher card — the other surface a reader points at before any list.
      name: "menu-switcher",
      path: `/p/${slug}`,
      waitFor: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".nav-sub", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.locator(".switcher-button").click({ button: "right", position: { x: 60, y: 20 } });
      },
    },
  ];

  if (!notes.length) log("no notes in this project — notes-list and note-detail are skipped");
  const unknown = ONLY.filter((k) => !all.some((s) => s.name === k));
  if (unknown.length) {
    throw new Error(
      `unknown screen ${unknown.map((u) => `"${u}"`).join(", ")} in --only/$SHOT_ONLY. ` +
        `Valid keys: ${all.map((s) => s.name).join(", ")}`,
    );
  }
  const screens = ONLY.length ? all.filter((s) => ONLY.includes(s.name)) : all;

  for (const s of screens) {
    rmSync(join(shotsDir, `${s.name}${SUFFIX}.png`), { force: true });
    if (s.full) rmSync(join(shotsDir, `${s.name}${SUFFIX}-full.png`), { force: true });
  }

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await useLocale(context, LOCALE);
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

// One tick for libuv to finish closing the sockets the project-api fetches left behind:
// exiting in the middle of that abandons the process with a UV assertion on Windows,
// which looks like a crash to whoever is reading the log.
await new Promise((r) => setTimeout(r, 60));
process.exit(failed ? 1 : 0);
