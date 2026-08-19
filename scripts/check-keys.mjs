#!/usr/bin/env node
/**
 * Prove the app can be driven — and escaped — from the keyboard.
 *
 *   npm run check:keys
 *   node scripts/check-keys.mjs [--port 5173] [--url ORIGIN]
 *
 * This is the gate for the P5 round-2 design verdict, which was lost on the command palette.
 * The palette printed "↑ ↓ move · ↵ open · esc close" along its bottom edge while binding
 * those keys to its <input> alone, and its result rows were <button>s — real tab stops
 * inside an aria-modal dialog. One Tab was enough to reach a state where esc did nothing,
 * the arrows moved nothing, and on /work and /bugs the arrows drove the *list behind the
 * scrim* while ↵ navigated it, leaving the palette open over a page nobody asked for.
 *
 * So every claim the footer makes is checked from a focus position that used to break it:
 *
 *   1. esc closes the palette from the input, from a Tab-moved focus, and from a click that
 *      dumped focus on <body> — on a list screen, a detail screen and /projects.
 *   2. Tab does not leave the dialog, and the options are not tab stops.
 *   3. The arrows move the palette's own highlight wherever the focus is, and never the
 *      list underneath: the board's cursor and the URL are both unchanged.
 *   4. ↵ opens what the palette highlights, not what the page behind it highlights.
 *   5. The reader is never told they are in two places at once: exactly one element carries
 *      aria-current="page", on every screen, including a vault with more projects than the
 *      sidebar lists (the "<N> more…" row used to be a NavLink to /projects).
 *
 * A scratch 12-project vault is built in a temp directory for (5); ./vault is never written.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { ensureServer, repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const MANY_PORT = Number(value("--many-port", PORT + 61));
const log = (...m) => console.log("[check-keys]", ...m);

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

const ready = async (page) => {
  await page.waitForSelector(".page-title, .record-title", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
  // The sidebar has its own loader (the project list is the slowest read in the app), and
  // half of what this gate measures lives in it.
  await page.waitForSelector(".nav-sub", { state: "attached" });
};

/** What has the keyboard, in a form a failure message can print. */
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "body";
    return `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0] || "(no class)"}`;
  });

const paletteOpen = (page) => page.locator(".palette").isVisible();
const highlight = (page) =>
  page.locator(".palette-item.is-active .palette-label").first().textContent();

/**
 * Open the palette and wait for it to be usable — including its records, which are fetched
 * on the first open of a page load. Without that wait this gate measures a three-row menu
 * and the arrows appear not to move (they wrapped).
 */
async function openPalette(page) {
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette-item.is-active", { state: "visible" });
  await page.waitForSelector(".palette-item .palette-kind", { state: "visible" });
}

let browser = null;
let server = null;
let manyServer = null;
const temps = [];

try {
  ({ server } = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  }));

  const projects = await (await fetch(`${ORIGIN}/vault-api/projects`)).json();
  const slug = projects.find((p) => p.slug === "relay")?.slug ?? projects[0].slug;
  const someWork = (await (await fetch(`${ORIGIN}/vault-api/projects/${slug}/worklogs`)).json())[0];

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });

  const screens = [
    { name: "bug board", url: `${ORIGIN}/p/${slug}/bugs?tab=all` },
    { name: "work detail", url: `${ORIGIN}/p/${slug}/work/${someWork.id}` },
    { name: "projects", url: `${ORIGIN}/projects` },
  ];

  for (const screen of screens) {
    log(`--- ${screen.name}`);
    await page.goto(screen.url, { waitUntil: "domcontentloaded" });
    await ready(page);

    // 1a. esc from the input, where it always worked.
    await openPalette(page);
    await page.keyboard.press("Escape");
    check(`${screen.name}: esc closes the palette from the input`, !(await paletteOpen(page)));

    // 1b + 2. One Tab — the exact reproduction from the round-2 verdict.
    await openPalette(page);
    const before = await highlight(page);
    await page.keyboard.press("Tab");
    const afterTab = await focused(page);
    check(
      `${screen.name}: Tab does not leave the dialog`,
      await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && !!el.closest && !!el.closest(".palette");
      }),
      `focus went to ${afterTab}`,
    );
    check(
      `${screen.name}: the result rows are not tab stops`,
      (await page.locator(".palette-item[tabindex], .palette-list button").count()) === 0,
    );

    // 3. Arrows still move the palette's highlight after that Tab…
    const url = page.url();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const moved = await highlight(page);
    check(
      `${screen.name}: ↓ moves the palette highlight after Tab`,
      moved !== before && !!moved,
      `highlight stayed on ${JSON.stringify(before)}`,
    );
    check(
      `${screen.name}: …and the highlight is what aria-activedescendant names`,
      await page.evaluate(() => {
        const id = document.querySelector(".palette-input")?.getAttribute("aria-activedescendant");
        const active = document.querySelector(".palette-item.is-active");
        return !!id && !!active && active.id === id;
      }),
    );

    // …and the page behind the scrim did not move.
    check(`${screen.name}: the page behind did not navigate`, page.url() === url, page.url());
    if (screen.name === "bug board") {
      check(
        "bug board: the list cursor behind the scrim did not move",
        (await page.locator(".work-row.is-cursor").count()) === 0,
      );
    }

    // 1c. The keys from a focus the palette did not choose — the state that used to be a
    // dead end. Focus is put on <body> the way a stray click does it, and the arrows and esc
    // are expected to work from there, because that is what the footer promises.
    await page.evaluate(() => document.activeElement?.blur?.());
    check(
      `${screen.name}: the focus can be dropped on <body>`,
      (await focused(page)) === "body",
      `focus is ${await focused(page)}`,
    );
    const strayBefore = await highlight(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    check(
      `${screen.name}: ↓ still moves the highlight with the focus on <body>`,
      (await highlight(page)) !== strayBefore,
      `highlight stayed on ${JSON.stringify(strayBefore)}`,
    );
    await page.keyboard.press("Escape");
    check(
      `${screen.name}: esc closes it with the focus dumped on <body>`,
      !(await paletteOpen(page)),
      `focus was ${await focused(page)}`,
    );
  }

  // 4. ↵ opens the palette's own highlight, on the screen whose list steals the arrows.
  log("--- enter, over a list screen");
  await page.goto(`${ORIGIN}/p/${slug}/bugs?tab=all`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await openPalette(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  const target = (await highlight(page))?.trim();
  const targetId = await page.locator(".palette-item.is-active .palette-hint").first().textContent();
  await page.keyboard.press("Enter");
  await ready(page);
  check(
    "↵ opens the palette's highlight, not the row under the scrim",
    page.url().includes(String(targetId ?? "").trim()),
    `highlight was ${JSON.stringify(target)} (${targetId}); landed on ${page.url()}`,
  );
  check("…and the palette closed behind it", !(await paletteOpen(page)));

  // The modal lock the list screens read, visible to anything that needs it.
  await openPalette(page);
  check(
    "an open modal is declared on <html data-modal>",
    (await page.getAttribute("html", "data-modal")) === "open",
  );
  await page.keyboard.press("Escape");
  check(
    "…and cleared when it closes",
    (await page.getAttribute("html", "data-modal")) === null,
  );

  // The list keyboard still works when no modal is up — the stand-down must not be a mute.
  await page.goto(`${ORIGIN}/p/${slug}/bugs?tab=all`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.keyboard.press("ArrowDown");
  await page.waitForSelector(".work-row.is-cursor", { state: "visible", timeout: 5_000 });
  check("the list keyboard still drives the board with no modal open", true);

  /* 5. One place at a time, on every screen.

     Exactly one element may claim to be the page you are on. The project row in the
     sidebar's vault list is allowed to say aria-current="location" — where you are in the
     vault is a different fact from which screen you are looking at — but never "page", and
     never more than one of it. */
  log("--- aria-current");
  const currents = async (p, kind) =>
    p.$$eval(
      `[aria-current="${kind}"]`,
      (els) => els.map((el) => (el.textContent || "").replace(/\s+/g, " ").trim()),
    );
  const expected = [
    { path: "/projects", page: /^Projects/, location: 0 },
    { path: `/p/${slug}`, page: /^Dashboard/, location: 1 },
    { path: `/p/${slug}/work`, page: /^Work/, location: 1 },
    { path: `/p/${slug}/bugs`, page: /^Bugs/, location: 1 },
  ];
  for (const e of expected) {
    await page.goto(`${ORIGIN}${e.path}`, { waitUntil: "domcontentloaded" });
    await ready(page);
    const marked = await currents(page, "page");
    const places = await currents(page, "location");
    check(
      `exactly one row is the current page on ${e.path}, and it is the right one`,
      marked.length === 1 && e.page.test(marked[0]),
      `page: ${JSON.stringify(marked)}`,
    );
    check(
      `…and ${e.location === 1 ? "one project row says where you are" : "no project row claims anything"}`,
      places.length === e.location,
      `location: ${JSON.stringify(places)}`,
    );
  }

  // The same claim in the vault shape that broke it: more projects than the sidebar lists.
  log("--- a 12-project vault");
  const many = mkdtempSync(join(tmpdir(), "agentmon-many-"));
  temps.push(many);
  const manyVault = join(many, "vault");
  mkdirSync(manyVault, { recursive: true });
  cpSync(join(repoRoot, "vault"), manyVault, { recursive: true });
  const bin = join(repoRoot, "target", "release", process.platform === "win32" ? "agentmon.exe" : "agentmon");
  for (let i = 1; i <= 10; i += 1) {
    execFileSync(bin, [
      "--vault", manyVault, "--json",
      "project", "create", `scratch-${i}`,
      "--name", `Scratch project ${i}`,
      "--description", "A scratch project, created by scripts/check-keys.mjs to fill the sidebar.",
      "--agent", "check-keys",
    ]);
  }
  manyServer = startServer(MANY_PORT, { env: { AGENTMON_VAULT: manyVault } });
  const manyOrigin = `http://localhost:${MANY_PORT}`;
  await waitForServer(manyServer, manyOrigin);
  const wide = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
  await wide.goto(`${manyOrigin}/projects`, { waitUntil: "domcontentloaded" });
  await ready(wide);
  const navRows = await wide.locator(".nav-sub").count();
  const overflow = await wide.locator(".nav-more").count();
  check(
    "the sidebar overflows to a '<N> more…' row with 12 projects",
    overflow === 1 && navRows === 9,
    `${navRows} sub rows, ${overflow} overflow rows`,
  );
  const markedMany = await currents(wide, "page");
  check(
    "on /projects with an overflow row, exactly one element is the current page",
    markedMany.length === 1 && markedMany[0].startsWith("Projects"),
    `marked: ${JSON.stringify(markedMany)}`,
  );
  check(
    "…and the overflow row is not styled as active either",
    (await wide.locator(".nav-more.active").count()) === 0,
  );
  await wide.close();
} catch (err) {
  failures += 1;
  console.error(`[check-keys] FAILED: ${err.stack || err.message}`);
} finally {
  if (browser) await browser.close();
  if (manyServer) await stopServer(manyServer);
  if (server) await stopServer(server);
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

log(failures === 0 ? `clean: ${checks} checks passed` : `${failures} of ${checks} checks failed`);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
