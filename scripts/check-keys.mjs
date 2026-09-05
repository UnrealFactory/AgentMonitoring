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
 * Since P8 it also gates the **right button**, which was reported leaking WebView2's own
 * menu ("새 창에서 링크 열기 / 링크 복사 / 검사") over a project row in the shipped desktop
 * app. Browser and webview run the same suppression, so it is measurable here:
 *
 *   6. On a row and on empty page background the contextmenu event comes back
 *      `defaultPrevented` — no browser menu — and inside the search box it does NOT, because
 *      copy/paste/spellcheck there belong to the browser and cannot be rebuilt honestly.
 *   7. The app's own menu takes the keyboard: the first item is focused on open, ↑ ↓ Home End
 *      move it, ↵ runs it, esc and a click away close it, and the focus goes back to the row
 *      it came from. Shift+F10 opens it without a mouse at all — and so does the **Menu key**
 *      (VK_APPS), which this gate claimed for a round without ever pressing, while in the
 *      shipped desktop build it opened the menu and Chromium's own synthesized contextmenu
 *      closed it a millisecond later.
 *   8. Every surface that draws a record or a project row offers it. Each round has lost one
 *      by enumerating them instead of following the rule (every link to a record opens the
 *      record menu; every link to a project opens the project menu), so each round's misses
 *      are nailed down here: the **dashboard** (the default landing route: the hero "working
 *      right now" row, the unresolved-bug row, the activity feed) and the **project
 *      switcher**; then **"Across the vault"** on /projects — twelve record rows, the same
 *      class and layout as the dashboard's, the only feed whose rows name another project —
 *      plus the **breadcrumb** at the head of every record and an **id written into prose**.
 *   9. **Nothing about a record deletes**, and the one thing that does is hard to do by
 *      accident. Work logs and bugs are append-only by SPEC, so no menu over one offers a
 *      delete. A *project* can be deleted — by the human, in this app — and every guard
 *      around that is measured here: the item says what it costs before the click, the
 *      dialog will not arm its button until the slug is typed exactly, ↵ on an empty field
 *      deletes nothing, esc and the scrim delete nothing, and when it does run the project
 *      leaves the disk, the row leaves an *already-open second window* with no reload, and
 *      a reader standing inside the deleted project is moved to /projects rather than left
 *      on a screen whose vault entry is gone. A second window parked *inside* the project —
 *      on the work list, the bug board and the dashboard in turn, each with real rows on it —
 *      lands on the app's no-such-project screen from the poll alone, with no reload and no
 *      navigation; parking that window on /projects, which this gate did for a round, could
 *      only ever see the list that updates itself (P12 round 2 critic). Parked on a *record*
 *      of that project it keeps the copy it has instead, and offers **no retry** beside the
 *      sentence promising to keep it: a retry is a manual reload, and a manual reload that
 *      fails trades the reader's last copy of a permanently deleted record for an error card
 *      (P12 round 3 critic). Both mirrors are checked too, because neither claim may be
 *      bought by breaking the other: the whole vault directory going away leaves those rows
 *      and that record exactly where they are under the shell's one line, and a record whose
 *      *file* stops parsing keeps its retry, because a vault that is briefly unreadable is
 *      not a project that was deleted and a record that could not be re-read is not a record
 *      that is gone. And it **owns the window** while it is up:
 *      Alt+Left does not navigate the page out from under it, Ctrl+K opens no palette over
 *      it, and a right-click raises no menu below its scrim — the three ways an armed
 *      confirmation came to be floating over a screen about a *different* project, one of
 *      which took a directory off the disk from a screen about Relay (P12 round 2 critic).
 *
 * Two scratch vaults are built in temp directories — a 12-project one for (5) and the same
 * copy for the writes and the deletes in (8). ./vault is read, never written.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { ensureServer, repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const MANY_PORT = Number(value("--many-port", PORT + 61));
/* Menus and nav rows are words. `--locale en` walks the same 126 checks in English. */
const LOCALE = value("--locale", process.env.SHOT_LOCALE || "ko");
const T = (key, ...args) => t(LOCALE, key, ...args);
/* "There is deliberately no Delete over a record" is a claim about meaning, not about
   English: an item reading 삭제 would break the same promise. Records are append-only by
   SPEC; the project menu is the one place this word is allowed to appear. */
const DESTRUCTIVE = /delete|remove|discard|삭제|제거|지우기/i;
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

/**
 * Press one half of the Agent / Human toggle and wait for the swap — by `data-value`, never
 * by the segment's word, because this gate runs in two languages.
 *
 * The reader's choice is a session value (src/lib/recordView.ts) and follows the window from
 * record to record, so anything here that reads a record body says which half it means.
 */
const showView = async (page, mode) => {
  const segment = page.locator(`.view-toggle [role="tab"][data-value="${mode}"]`).first();
  if (!(await segment.count())) return;
  await segment.click();
  await page.waitForFunction(
    (want) =>
      document
        .querySelector(`.view-toggle [role="tab"][data-value="${want}"]`)
        ?.getAttribute("aria-selected") === "true",
    mode,
    { timeout: 5_000 },
  );
};

/** Which half the toggle says is on screen, as the app itself reports it. */
const shownView = (page) =>
  page.evaluate(
    () =>
      document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.dataset.value ?? null,
  );

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

/* -- the right button ------------------------------------------------------- */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const menuOpen = (page) => page.locator(".ctx-menu").count().then((n) => n > 0);
/** The menu's items by id, in screen order. */
const menuItems = (page) =>
  page.locator(".ctx-item").evaluateAll((els) => els.map((el) => el.dataset.item));
/** Which item has the keyboard. */
const menuFocus = (page) => page.evaluate(() => document.activeElement?.dataset?.item ?? null);

/**
 * Watch every contextmenu event that reaches the document — *after* the app has had it.
 *
 * This is the measurement the P8 defect is really about: `defaultPrevented` is the whole
 * difference between the app's menu and WebView2's. The listener is added last, so it sees
 * the final state of each event; it has to be re-armed after every navigation.
 */
const watchContextMenu = (page) =>
  page.evaluate(() => {
    window.__ctx = [];
    document.addEventListener("contextmenu", (e) =>
      window.__ctx.push({ prevented: e.defaultPrevented, tag: e.target?.tagName ?? "?" }),
    );
  });
const ctxSeen = (page) => page.evaluate(() => window.__ctx ?? []);
const armContextMenu = async (page) => {
  await page.evaluate(() => (window.__ctx = []));
};

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

  const mainRows = await (await fetch(`${ORIGIN}/project-api/projects`)).json();
  const projects = mainRows.filter((r) => r.available && r.project).map((r) => r.project);
  const slug = projects[0].id;
  const someWork = (await (await fetch(`${ORIGIN}/project-api/projects/${slug}/worklogs`)).json())[0];
  /* A note is addressed by its kebab name — the third shape a record id takes. */
  const someNote = (await (await fetch(`${ORIGIN}/project-api/projects/${slug}/notes`)).json())[0];

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await useLocale(page, LOCALE);
  log(`language: ${LOCALE}`);

  const screens = [
    { name: "bug board", url: `${ORIGIN}/p/${slug}/bugs?tab=all` },
    { name: "work detail", url: `${ORIGIN}/p/${slug}/work/${someWork.id}` },
    { name: "notes list", url: `${ORIGIN}/p/${slug}/notes` },
    { name: "note detail", url: `${ORIGIN}/p/${slug}/notes/${someNote.name}` },
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

  /* The rows stopped being <button>s this round, so the mouse has to be checked with the
     keyboard: an option that only the arrows can reach is a different regression. */
  await openPalette(page);
  const clickTarget = (await page.locator(".palette-item").nth(2).locator(".palette-hint").textContent())?.trim();
  await page.locator(".palette-item").nth(2).click();
  await ready(page);
  check(
    "a result row still opens on a click",
    page.url().includes(String(clickTarget ?? "")),
    `clicked ${clickTarget}; landed on ${page.url()}`,
  );
  await openPalette(page);
  await page.locator(".palette-scrim").click({ position: { x: 10, y: 10 } });
  check("a click on the scrim closes it", !(await paletteOpen(page)));

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
  /* The nav rows are named in the reader's language, so the expectation is read from the
     same dictionary the window is (scripts/i18n.mjs) rather than spelled in English. */
  const expected = [
    { path: "/projects", page: T("nav.projects"), location: 0 },
    { path: `/p/${slug}`, page: T("nav.dashboard"), location: 1 },
    { path: `/p/${slug}/work`, page: T("nav.work"), location: 1 },
    { path: `/p/${slug}/bugs`, page: T("nav.bugs"), location: 1 },
    { path: `/p/${slug}/notes`, page: T("nav.notes"), location: 1 },
  ];
  for (const e of expected) {
    await page.goto(`${ORIGIN}${e.path}`, { waitUntil: "domcontentloaded" });
    await ready(page);
    const marked = await currents(page, "page");
    const places = await currents(page, "location");
    check(
      `exactly one row is the current page on ${e.path}, and it is the right one`,
      marked.length === 1 && marked[0].startsWith(e.page),
      `page: ${JSON.stringify(marked)}`,
    );
    check(
      `…and ${e.location === 1 ? "one project row says where you are" : "no project row claims anything"}`,
      places.length === e.location,
      `location: ${JSON.stringify(places)}`,
    );
  }

  /* 6-7. The right button, on a screen full of rows.

     The reported defect is a *browser* menu appearing over a project row in the desktop
     app. Browser mode runs the same suppression, so what is measured here is exactly what
     the webview does: whether the contextmenu event comes back prevented. */
  log("--- the context menu");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await page.goto(`${ORIGIN}/p/${slug}/work`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await watchContextMenu(page);

  const firstRow = page.locator(".work-row").first();
  const firstId = (await firstRow.locator(".work-row-id").textContent())?.trim();
  await firstRow.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check("a work row opens the app's own menu", await menuOpen(page));
  check(
    "…and the browser's menu is suppressed on it",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page)).every((e) => e.prevented),
    JSON.stringify(await ctxSeen(page)),
  );
  check(
    "…named for the record it is about",
    (await page.getAttribute(".ctx-menu", "aria-label")) === firstId,
    `aria-label ${await page.getAttribute(".ctx-menu", "aria-label")}, row ${firstId}`,
  );
  const rowItems = await menuItems(page);
  check(
    "…offering Open and the three copies",
    same(rowItems, ["open", "copy-id", "copy-title", "copy-link"]),
    JSON.stringify(rowItems),
  );
  check(
    "…and nothing that deletes (the vault is append-only)",
    !DESTRUCTIVE.test((await page.locator(".ctx-menu").textContent()) ?? ""),
  );
  check(
    "an open menu declares the modal lock, so the list keyboard stands down",
    (await page.getAttribute("html", "data-modal")) === "open",
  );

  // The keyboard contract, from the item the menu put the focus on.
  check("the first item takes the keyboard", (await menuFocus(page)) === "open");
  await page.keyboard.press("ArrowDown");
  check("↓ moves to the next item", (await menuFocus(page)) === "copy-id");
  await page.keyboard.press("ArrowUp");
  check("↑ moves back", (await menuFocus(page)) === "open");
  await page.keyboard.press("ArrowUp");
  check("↑ from the first item wraps to the last", (await menuFocus(page)) === "copy-link");
  await page.keyboard.press("Home");
  check("Home returns to the first", (await menuFocus(page)) === "open");
  await page.keyboard.press("End");
  check("End jumps to the last", (await menuFocus(page)) === "copy-link");
  const urlWithMenu = page.url();
  check("…and the page behind it did not navigate", page.url() === urlWithMenu);
  await page.keyboard.press("Escape");
  check("esc closes it", !(await menuOpen(page)));
  check(
    "…and the row it came from has the keyboard back",
    await page.evaluate(() => !!document.activeElement?.closest?.(".work-row")),
    `focus is ${await focused(page)}`,
  );
  check("…and the modal lock is released", (await page.getAttribute("html", "data-modal")) === null);

  /* The Menu key — VK_APPS, beside the right Ctrl — which this gate used to claim without
     ever pressing.

     Chromium answers it with a keydown *and* a synthesized contextmenu a millisecond later,
     so the shipped P8 build opened the menu and killed it on the spot: keydown at t+0, menu
     in the DOM at t+1, Chromium's own contextmenu at t+2 landing on .ctx-item inside the
     layer, whose handler read it as a click elsewhere and closed. The key did nothing, on
     every row in the app, in the real desktop window (P8 round 2 critic). What follows is
     that exact sequence, so it cannot come back. */
  const thirdRow = page.locator(".work-row").nth(2);
  const thirdId = (await thirdRow.locator(".work-row-id").textContent())?.trim();
  await thirdRow.focus();
  await armContextMenu(page);
  await page.keyboard.press("ContextMenu");
  await page.waitForTimeout(250); // long enough for the echo, which arrives in about 1ms
  check("the Menu key opens the menu on a focused row", await menuOpen(page));
  check(
    "…and it is still there after the browser's own contextmenu echo arrives",
    (await menuOpen(page)) && (await page.getAttribute(".ctx-menu", "aria-label")) === thirdId,
    `label ${await page.getAttribute(".ctx-menu", "aria-label")}, row ${thirdId}`,
  );
  check(
    "…the echo is swallowed rather than shown as the browser's menu",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page)).every((e) => e.prevented),
    JSON.stringify(await ctxSeen(page)),
  );
  check("…and the keyboard is on its first item", (await menuFocus(page)) === "open");
  // Pressing it a second time is the desktop's own way to dismiss a menu.
  await page.keyboard.press("ContextMenu");
  await page.waitForTimeout(250);
  check("the Menu key pressed again closes it", !(await menuOpen(page)));

  /* Ctrl+K over an open menu. Two modals on screen at once, one of them straddling the
     other's scrim, cost two Escapes to get back to the page — and the first of them closed
     the menu the reader had already stopped looking at. A menu stands down for anything
     that takes the keyboard over it. */
  await firstRow.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  await page.keyboard.press("Control+k");
  await page.waitForSelector(".palette", { state: "visible", timeout: 5_000 });
  /* The menu stands down on the render *after* the palette takes the lock — one frame, which
     no hand can press a second key inside, but which a gate reading in the same millisecond
     can catch mid-flight. Waiting for it to settle is what a reader would see. */
  await page.waitForSelector(".ctx-menu", { state: "detached", timeout: 2_000 }).catch(() => {});
  check(
    "Ctrl+K over an open menu leaves only the palette on screen",
    !(await menuOpen(page)),
    `menus ${await page.locator(".ctx-menu").count()}, palettes ${await page.locator(".palette").count()}, modal ${await page.getAttribute("html", "data-modal")}, focus ${await focused(page)}`,
  );
  await page.keyboard.press("Escape");
  check("…and one esc puts the reader back on the page", !(await paletteOpen(page)));
  check(
    "…with no modal lock left behind",
    (await page.getAttribute("html", "data-modal")) === null,
  );

  // Shift+F10: the same menu, no mouse anywhere in it.
  const secondRow = page.locator(".work-row").nth(1);
  const secondId = (await secondRow.locator(".work-row-id").textContent())?.trim();
  await secondRow.focus();
  const rowBox = await secondRow.boundingBox();
  await page.keyboard.press("Shift+F10");
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "Shift+F10 on a focused row opens the menu for that row",
    (await page.getAttribute(".ctx-menu", "aria-label")) === secondId,
  );
  // Measured against the row, not against `:focus` — by now the focus is in the menu, which
  // is the other half of the promise.
  const menuBox = await page.locator(".ctx-menu").boundingBox();
  const anchored = { dx: menuBox.x - rowBox.x, dy: menuBox.y - (rowBox.y + rowBox.height) };
  check(
    "…anchored to the row rather than to the corner of the window",
    anchored.dx > 0 && anchored.dx < 80 && Math.abs(anchored.dy) < 40,
    JSON.stringify(anchored),
  );
  check(
    "…and the keyboard is inside it, not still on the row",
    (await menuFocus(page)) === "open",
  );
  // ↵ on a copy item: the id lands on the clipboard and the app says so.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".toast", { state: "visible", timeout: 5_000 });
  check("↵ runs the item it highlights", !(await menuOpen(page)));
  check(
    "…Copy id really writes the clipboard",
    (await page.evaluate(() => navigator.clipboard.readText())) === secondId,
  );
  check(
    "…and one line says so",
    ((await page.locator(".toast-text").textContent()) ?? "").includes(secondId),
    await page.locator(".toast-text").textContent(),
  );

  // Open, from the menu, on the row it was opened over.
  await firstRow.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible" });
  await page.keyboard.press("Enter");
  await ready(page);
  check("Open goes to the record the menu was about", page.url().endsWith(`/work/${firstId}`), page.url());

  // A click anywhere else closes it, the way every menu in this app already does.
  await page.goto(`${ORIGIN}/p/${slug}/work`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await watchContextMenu(page);
  await firstRow.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible" });
  await page.mouse.click(12, 12);
  check("a click away closes it", !(await menuOpen(page)));

  /* Empty background: nothing at all — not the app's menu, and not the browser's. This is
     the half of the fix that has no visible result, which is why it is measured. */
  await armContextMenu(page);
  const empty = await page.evaluate(() => {
    const head = document.querySelector(".page-head")?.getBoundingClientRect();
    return head ? { x: Math.round(head.right - 8), y: Math.round(head.top + 6) } : null;
  });
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  check("the page background opens no menu", !(await menuOpen(page)));
  check(
    "…and the browser's is suppressed there too",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page))[0].prevented,
    JSON.stringify(await ctxSeen(page)),
  );

  /* …except in a text field, where the native menu carries paste, undo and the spell
     checker, and the app has nothing better to offer. */
  await armContextMenu(page);
  await page.locator(".search-input").click({ button: "right" });
  check("a search box keeps the browser's own menu", !(await ctxSeen(page))[0]?.prevented, JSON.stringify(await ctxSeen(page)));
  check("…and the app does not put one over it", !(await menuOpen(page)));

  // A record's head carries the same menu as its row, minus the Open it does not need.
  await page.goto(`${ORIGIN}/p/${slug}/work/${someWork.id}`, { waitUntil: "domcontentloaded" });
  await ready(page);
  /* …read in the agent half, which is where the prose with the ids in it is. A record that
     carries a retelling opens on the other half (SPEC, "The human area"), and the two checks
     below are about a chip inside a record body. */
  await showView(page, "agent");
  // The watcher does not survive a navigation, and half of what is measured below is what
  // the document did with an event that raised no menu.
  await watchContextMenu(page);
  await page.locator(".record-head").click({ button: "right", position: { x: 12, y: 10 } });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  const headItems = await menuItems(page);
  check(
    "the record head offers the copies and no Open — the reader is already on it",
    same(headItems, ["copy-id", "copy-title", "copy-link"]),
    JSON.stringify(headItems),
  );
  await page.keyboard.press("Escape");

  /* The breadcrumb above it. It is a link to the project, on every work log and every bug
     in the vault, and for two rounds it was the one project link in the app that opened
     nothing (P8 round 3 critic, recorded not charged). */
  const crumb = page.locator(".breadcrumb a").first();
  const crumbName = (await crumb.textContent())?.trim();
  await crumb.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "the breadcrumb at the head of a record opens its project's menu",
    (await page.getAttribute(".ctx-menu", "aria-label")) === crumbName &&
      same(await menuItems(page), ["open", "work", "bugs", "notes", "copy-path", "claude-md", "agents-md", "mcp-json", "delete"]),
    `label ${await page.getAttribute(".ctx-menu", "aria-label")} vs ${crumbName}, items ${JSON.stringify(await menuItems(page))}`,
  );
  await page.keyboard.press("Escape");
  // The list crumb beside it is not a record and not a project: still nothing, still no Edge.
  await armContextMenu(page);
  await page.locator(".breadcrumb a").nth(1).click({ button: "right" });
  await page.waitForTimeout(150);
  check("…while the Work crumb beside it opens no menu", !(await menuOpen(page)));
  check(
    "…and no browser menu either",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page))[0].prevented,
    JSON.stringify(await ctxSeen(page)),
  );

  /* An id written into a sentence. It is a link to a record — the same record the Related
     row a few hundred pixels below names — so it answers the same way. */
  const chip = page.locator("a.ref-inline:not(.is-unknown)").first();
  if (await chip.count()) {
    const chipId = (await chip.textContent())?.trim();
    await chip.click({ button: "right" });
    await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
    check(
      "a record id written into prose opens that record's menu",
      (await page.getAttribute(".ctx-menu", "aria-label")) === chipId &&
        same(await menuItems(page), ["open", "copy-id", "copy-title", "copy-link"]),
      `label ${await page.getAttribute(".ctx-menu", "aria-label")} vs ${chipId}, items ${JSON.stringify(await menuItems(page))}`,
    );
    await page.keyboard.press("Escape");
  }

  /* The Related block, on the same page: those rows are other records, so Open comes back. */
  const relRow = page.locator(".rel-row:not(.is-missing)").first();
  if (await relRow.count()) {
    const relId = (await relRow.locator(".rel-id").textContent())?.trim();
    await relRow.click({ button: "right" });
    await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
    check(
      "a Related row opens the menu for the record it points at",
      (await page.getAttribute(".ctx-menu", "aria-label")) === relId &&
        same(await menuItems(page), ["open", "copy-id", "copy-title", "copy-link"]),
      `${await page.getAttribute(".ctx-menu", "aria-label")} vs ${relId}`,
    );
    await page.keyboard.press("Escape");
  }

  /* 10. The Agent / Human toggle — the one control this app has that changes what a record
     *says*, rather than where the reader is (SPEC, "The human area").
     *
     Three promises are measured, and all three are keyboard promises. It is **reachable**:
     a control that only a mouse can find hides half of every record from anybody driving
     this app from the keyboard, and it sits in a header full of links, so the only honest
     test is to Tab there from the top of the page. It **works from the keyboard**: a
     `<button>` answers ↵ and Space by being one, which is exactly why it is one and not a
     div. And it is **visible when it has the focus**: `:focus-visible` in tokens.css draws
     the ring, and a segment that took the ring off would be a control the keyboard can hold
     and nobody can see it holding.

     Then the fourth promise, which is not about the keyboard: the choice **persists across
     records**. It is a session value, so a reader who asked for plain language once is not
     asked again on the next record — including a record that has none, where the answer is
     the box saying so rather than a silent flip back to the agent half.

     …and the fifth, which is the fourth read strictly: the **only** thing that changes that
     choice is the toggle. Two other controls reach into the other half — the empty box's way
     out and the correction line over a retelling — and both are about one record, so both
     are measured here for what they leave behind, not just for what they draw. */
  log("--- the Agent / Human toggle");
  const humanWork = (await (await fetch(`${ORIGIN}/project-api/projects/${slug}/worklogs`)).json())
    .find((w) => w.human && w.human.trim());
  if (!humanWork) {
    check("a record with a human area to read the toggle on", false, "no work log in this project carries one");
  } else {
    await page.goto(`${ORIGIN}/p/${slug}/work/${humanWork.id}`, { waitUntil: "domcontentloaded" });
    /* A window in which nobody has chosen yet — which is what the *default* is a claim
       about. This page has been pressing Agent since the context-menu section above, and
       that choice is a session value that outlives a navigation by design, so it is cleared
       here rather than assumed away. (That it survives one is measured further down.) */
    await page.evaluate(() => window.sessionStorage.removeItem("agentmon.recordView"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    check(
      "a record with a human area opens on it",
      (await shownView(page)) === "human" && (await page.locator(".human-view").count()) === 1,
      `toggle says ${await shownView(page)}`,
    );
    /* The two areas never share a page (SPEC): the agent's sections are not drawn under the
       retelling. `관련 항목` is not one of them — what a record is wired to is the record's
       own shape and is drawn in both halves — so the agent area is named by its sections'
       own anchors rather than by "every heading on the page". */
    check(
      "…and the agent's sections are not on the page under it",
      (await page.locator("#what, #why, #how, #outcome, #updates, #report, #thread, #body").count()) === 0,
      `${await page.locator("#what, #why, #how, #outcome, #updates, #report, #thread, #body").count()} agent sections drawn`,
    );

    // Reachable: Tab from the top of the document until something is focused inside it.
    await page.locator(".breadcrumb a").first().focus();
    let hops = 0;
    let onToggle = false;
    while (hops < 12 && !onToggle) {
      await page.keyboard.press("Tab");
      hops += 1;
      onToggle = await page.evaluate(() => !!document.activeElement?.closest(".view-toggle"));
    }
    check("Tab from the breadcrumb reaches the toggle", onToggle, `${hops} tab stops and still ${await focused(page)}`);
    check(
      "…and the ring is drawn on it, so the reader can see where they are",
      await page.evaluate(() => document.activeElement?.matches(":focus-visible") === true),
    );

    /* ↵ on the Agent segment. Tab lands on the first segment; the reader presses ↵ on the
       one they want, which is the one the app is not already showing. */
    while (!(await page.evaluate(() => document.activeElement?.dataset.value === "agent"))) {
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    await page.waitForSelector(".record-section .section-title", { state: "visible", timeout: 5_000 });
    check(
      "↵ on the Agent segment swaps the record to the agent's half",
      (await shownView(page)) === "agent" && (await page.locator(".human-view").count()) === 0,
      `toggle says ${await shownView(page)}`,
    );
    check(
      "…and the record's identity is still on screen — the head is the same in both halves",
      (await page.locator(".record-title").count()) === 1 &&
        (await page.locator(".rec-byline .pill").count()) > 0,
    );
    check(
      "…and the address did not change: this is one record, read another way",
      page.url().endsWith(`/work/${humanWork.id}`),
      page.url(),
    );

    // Space, on the other segment, from the keyboard alone. Each segment is its own tab
    // stop, so the reader moves between them with Tab and presses the one they want.
    await page.keyboard.press("Tab");
    check(
      "the other segment is the next tab stop",
      await page.evaluate(() => document.activeElement?.dataset.value === "human"),
      await focused(page),
    );
    await page.keyboard.press(" ");
    await page.waitForSelector(".human-view", { state: "visible", timeout: 5_000 });
    check("Space on the Human segment swaps it back", (await shownView(page)) === "human");

    /* …and the arrows, which `role="tablist"` promises and which none of this app's six
       segmented controls kept for six rounds (lib/tablist.ts). ← from the Human segment
       moves *and* presses — automatic activation, so what is selected is what is focused —
       and ← again wraps rather than dead-ending, which is what makes a two-segment control
       usable with one key. */
    await page.keyboard.press("ArrowLeft");
    await page.waitForSelector(".record-section .section-title", { state: "visible", timeout: 5_000 });
    check(
      "← moves along the toggle and swaps the half with it",
      (await shownView(page)) === "agent" &&
        (await page.evaluate(() => document.activeElement?.dataset.value === "agent")),
      `toggle says ${await shownView(page)}, focus on ${await focused(page)}`,
    );
    await page.keyboard.press("ArrowLeft");
    await page.waitForSelector(".human-view", { state: "visible", timeout: 5_000 });
    check(
      "…and wraps at the end rather than stopping",
      (await shownView(page)) === "human" &&
        (await page.evaluate(() => document.activeElement?.dataset.value === "human")),
      `toggle says ${await shownView(page)}, focus on ${await focused(page)}`,
    );
    await page.keyboard.press("Home");
    check(
      "Home jumps to the first segment",
      await page.evaluate(() => document.activeElement?.dataset.value === "agent"),
      await focused(page),
    );
    await page.keyboard.press("End");
    check(
      "End jumps to the last one",
      await page.evaluate(() => document.activeElement?.dataset.value === "human"),
      await focused(page),
    );

    /* The same handler is on the other five `.segmented` tablists, so one of them is read
       here too: a rule kept by one control and not by its five siblings is the difference a
       reader feels as "this app was built by two people". The bug board's status tabs drive
       the URL, which is how this one says it worked. */
    await page.goto(`${ORIGIN}/p/${slug}/bugs`, { waitUntil: "domcontentloaded" });
    await ready(page);
    await page.locator('.segmented [role="tab"][aria-selected="true"]').first().focus();
    const beforeTab = await page.evaluate(
      () => document.querySelector('.segmented [role="tab"][aria-selected="true"]')?.dataset.value,
    );
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(
      (was) =>
        document.querySelector('.segmented [role="tab"][aria-selected="true"]')?.dataset.value !== was,
      beforeTab,
      { timeout: 5_000 },
    );
    check(
      "→ moves the bug board's own tabs too, and the board follows",
      (await page.evaluate(
        () => document.querySelector('.segmented [role="tab"][aria-selected="true"]')?.dataset.value,
      )) !== beforeTab,
      `still ${beforeTab}`,
    );
    await page.goto(`${ORIGIN}/p/${slug}/work/${humanWork.id}`, { waitUntil: "domcontentloaded" });
    await ready(page);

    /* The choice follows the reader. A second record, opened by navigating rather than by
       reloading, and then one that has no human area at all. */
    const otherWork = (await (await fetch(`${ORIGIN}/project-api/projects/${slug}/worklogs`)).json())
      .find((w) => w.id !== humanWork.id && w.human && w.human.trim());
    if (otherWork) {
      await page.goto(`${ORIGIN}/p/${slug}/work/${otherWork.id}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      check(
        "the choice carries onto the next record",
        (await shownView(page)) === "human" && (await page.locator(".human-view").count()) === 1,
        `toggle says ${await shownView(page)}`,
      );
    }
    /* A record written before human areas existed — the designed empty state.

       Looked for across all three kinds, not just bugs: this used to read `bugs` alone
       because on this machine no bug had a retelling, and the day the backfill (D4) finished
       those four checks stopped running without a word. A gate that goes quiet when its
       material is gone is worse than one that says so, so the miss is printed. A project
       whose every record has been retold is the *goal*; the empty state is then measured
       where legacy records still exist — a fixture, or a project mid-migration. */
    const kinds = [
      ["bugs", "bugs", (r) => r.id],
      ["worklogs", "work", (r) => r.id],
      ["notes", "notes", (r) => r.name],
    ];
    let noHuman = null;
    for (const [endpoint, route, idOf] of kinds) {
      const found = (await (await fetch(`${ORIGIN}/project-api/projects/${slug}/${endpoint}`)).json())
        .find((r) => !r.human || !r.human.trim());
      if (found) {
        noHuman = { id: idOf(found), path: `${route}/${idOf(found)}` };
        break;
      }
    }
    if (!noHuman) {
      log("    (no record on this project lacks a human area — the empty state is not measured here)");
    }
    if (noHuman) {
      await page.goto(`${ORIGIN}/p/${slug}/${noHuman.path}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      check(
        "a record with no human area answers the same choice with the box that says so",
        (await shownView(page)) === "human" && (await page.locator(".human-empty").count()) === 1,
        `toggle says ${await shownView(page)}, ${await page.locator(".human-empty").count()} boxes`,
      );
      check(
        "…naming the command that would add one, with this record's own id in it",
        ((await page.locator(".human-empty .command-text").textContent()) ?? "").includes(noHuman.id),
        await page.locator(".human-empty .command-text").textContent(),
      );
      check(
        "…and offering the way back to the half that does exist",
        (await page.locator(".human-empty-action .button").count()) === 1,
      );
      await page.locator(".human-empty-action .button").click();
      /* By the toggle rather than by a section heading: a note's agent half is one untitled
         `#body`, so waiting for `.section-title` would hang on the one kind whose empty
         state this now also reaches. */
      await page.waitForFunction(
        () =>
          document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.dataset.value ===
          "agent",
        undefined,
        { timeout: 5_000 },
      );
      check("…which shows it", (await shownView(page)) === "agent");

      /* …and the price of taking that offer, which for a round was the reader's whole
         session. The button sits inside the box that exists to say "this record has none",
         its label names one record, and it called the session-wide setter: a reader walking
         a week of work in plain language lost plain language at the first legacy record and
         never learned why (D3 round 2 critic). The three checks below are that bug, in the
         order it happened — what the store holds, what the screen admits, and what the next
         record opens on, which is the one the reader actually feels. */
      check(
        "…without rewriting the reader's choice: the button's label names one record",
        (await page.evaluate(() => window.sessionStorage.getItem("agentmon.recordView"))) === "human",
        `sessionStorage = ${await page.evaluate(() => window.sessionStorage.getItem("agentmon.recordView"))}`,
      );
      check(
        "…and the screen says so while it lasts, naming the record it is about",
        (await page.locator(".view-peek").count()) === 1 &&
          (await page.locator(".view-peek").innerText()).includes(noHuman.id),
        await page.locator(".view-peek").innerText().catch(() => "(no line)"),
      );
      await page.goto(`${ORIGIN}/p/${slug}/work/${humanWork.id}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      check(
        "…so the record after it still opens in plain language",
        (await shownView(page)) === "human" && (await page.locator(".human-view").count()) === 1,
        `toggle says ${await shownView(page)}`,
      );
    }

    /* A corrected record, read on the half that is not where the correction was posted.

       The vault is append-only, so a record that turns out to state something false keeps
       the false sentence and gains a note; the line at the top of the record is the only
       thing that reaches the reader before the sentence does. The retelling is the same
       events told again and `work update --message` does not rewrite it, so a retelling of a
       corrected record is a story the record itself says is wrong — and for one round the
       human half drew no line at all, which is precisely the reader that line exists for
       (D3 round 1 critic). It is on both halves now, and on the half that is not drawing the
       trail it has to carry the reader across rather than jump to an anchor that is not on
       the page. */
    /* The list projection carries `updateCount`, not the notes themselves, so the flag is
       read off the records that could possibly have one. `Correction:` is the whole rule
       (src/lib/updates.ts) and the CLI's `_Update by X._` byline sits in front of it. */
    const isCorrection = (body) =>
      /^[*_\s]*correction[*_\s]*:/i.test(String(body ?? "").replace(/^_Update by ([^_\n]+)\._\s*/, ""));
    let corrected = null;
    for (const meta of (await (await fetch(`${ORIGIN}/project-api/projects/${slug}/worklogs`)).json())
      .filter((w) => w.human?.trim() && w.updateCount > 0)) {
      const full = await (
        await fetch(`${ORIGIN}/project-api/projects/${slug}/worklogs/${meta.id}`)
      ).json();
      if ((full.updates ?? []).some((u) => isCorrection(u.body))) {
        corrected = full;
        break;
      }
    }
    if (corrected) {
      await page.goto(`${ORIGIN}/p/${slug}/work/${corrected.id}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      await showView(page, "agent");
      check(
        "a corrected record says so at the top of the agent's half",
        (await page.locator(".correction-notice").count()) === 1,
        corrected.id,
      );
      await showView(page, "human");
      check(
        "…and at the top of the retelling too, where the trail is not on the page",
        (await page.locator(".correction-notice").count()) === 1 &&
          (await page.locator(".human-view").count()) === 1,
        `${await page.locator(".correction-notice").count()} notices, ${await page.locator(".human-view").count()} sheets`,
      );
      /* And it is a way in, not a dead anchor: `#updates` does not exist on this half. */
      await page.locator(".correction-notice").click();
      await page.waitForSelector("#updates", { state: "visible", timeout: 5_000 });
      check(
        "…and following it swaps to the half the correction is on, at the notes",
        (await shownView(page)) === "agent" &&
          (await page.evaluate(() => {
            const el = document.getElementById("updates");
            const box = el?.getBoundingClientRect();
            return !!box && box.top >= 0 && box.top < window.innerHeight;
          })),
        `toggle says ${await shownView(page)}`,
      );
      /* The same rule as the empty box's button: it carried the reader across for this
         record, not for the rest of the window. `showView(page, "human")` above is what
         chose, so that is what the store must still say. */
      check(
        "…for this record, leaving the reader's choice where the toggle put it",
        (await page.evaluate(() => window.sessionStorage.getItem("agentmon.recordView"))) === "human" &&
          (await page.locator(".view-peek").count()) === 1,
        `sessionStorage = ${await page.evaluate(() => window.sessionStorage.getItem("agentmon.recordView"))}, ${await page.locator(".view-peek").count()} lines`,
      );
    }
  }

  /* 6b. The dashboard — /p/<slug>, the route the app lands on.

     Every screen with record rows on it had this menu except the first one a reader sees:
     right-clicking the hero "working right now" row, the unresolved-bug row beside it or any
     row of the activity feed gave nothing, while the identical row on /work gave four items
     (P8 round 2 critic). Each of the three is checked by the id it names, because a menu
     that opens on the wrong record is worse than no menu. */
  log("--- the dashboard's own rows");
  await page.goto(`${ORIGIN}/p/${slug}`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.waitForSelector(".now-row, .feed-row", { state: "visible" });
  await watchContextMenu(page);

  const dashRows = [
    ["the hero row under Working right now", "a.now-row", ".now-row-id"],
    ["a row of the activity feed", "a.feed-row", ".feed-ref"],
  ];
  for (const [what, sel, idSel] of dashRows) {
    const row = page.locator(sel).first();
    const id = (await row.locator(idSel).first().textContent())?.trim();
    await row.click({ button: "right" });
    await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
    check(
      `${what} opens the record menu`,
      (await page.getAttribute(".ctx-menu", "aria-label")) === id,
      `label ${await page.getAttribute(".ctx-menu", "aria-label")}, row ${id}`,
    );
    check(
      `…with the same four items the row on the list screen has`,
      same(await menuItems(page), ["open", "copy-id", "copy-title", "copy-link"]),
      JSON.stringify(await menuItems(page)),
    );
    await page.keyboard.press("Escape");
  }

  /* The unresolved-bug row is the second panel of the strip: a bug, from a screen whose
     other rows are work logs, so the menu has to be about the row and not about the strip. */
  const bugRow = page.locator(".now-panel").nth(1).locator("a.now-row").first();
  if (await bugRow.count()) {
    const bugId = (await bugRow.locator(".now-row-id").textContent())?.trim();
    await bugRow.click({ button: "right" });
    await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
    check(
      "the unresolved-bug row opens that bug's menu",
      (await page.getAttribute(".ctx-menu", "aria-label")) === bugId,
      `label ${await page.getAttribute(".ctx-menu", "aria-label")}, row ${bugId}`,
    );
    check(
      "…and Copy link offers the bug's route, not the dashboard's",
      (await page.locator('.ctx-item[data-item="copy-link"] .ctx-hint').textContent()) ===
        `/p/${slug}/bugs/${bugId}`,
    );
    await page.keyboard.press("Escape");
  }

  // A feed row's Copy title has to carry the record's real title — the feed only knows an id.
  const feedRow = page.locator("a.feed-row").first();
  const feedId = (await feedRow.locator(".feed-ref").first().textContent())?.trim();
  await feedRow.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  await page.locator('.ctx-item[data-item="copy-title"]').click();
  await page.waitForSelector(".toast", { state: "visible", timeout: 5_000 });
  const feedTitle = await page.evaluate(() => navigator.clipboard.readText());
  // A feed ref is one of three shapes — BUG-NNNN, WORK-NNNN, or a note's kebab name (the
  // feed links all three). Asking worklogs/ for a note name got a 400 and compared the
  // clipboard against `undefined`, which failed the moment an agent's newest event was a
  // note rewrite. The shape decides the collection, exactly as the app's own router does.
  const collection = feedId.startsWith("BUG-")
    ? "bugs"
    : feedId.startsWith("WORK-")
      ? "worklogs"
      : "notes";
  const realTitle = await (
    await fetch(`${ORIGIN}/project-api/projects/${slug}/${collection}/${feedId}`)
  ).json();
  check(
    "Copy title on a feed row copies the record's title, which the feed line does not print",
    feedTitle === realTitle.title && feedTitle.length > 0,
    `clipboard ${JSON.stringify(feedTitle)} vs vault ${JSON.stringify(realTitle.title)}`,
  );

  // And the parts of the dashboard that are not records still show nothing at all.
  await armContextMenu(page);
  const chartAt = await page.evaluate(() => {
    const b = document.querySelector(".chart-card .card-body")?.getBoundingClientRect();
    return b ? { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + 8) } : null;
  });
  await page.mouse.click(chartAt.x, chartAt.y, { button: "right" });
  await page.waitForTimeout(150);
  check("a chart on the dashboard opens no menu", !(await menuOpen(page)));
  check(
    "…and no browser menu either",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page))[0].prevented,
    JSON.stringify(await ctxSeen(page)),
  );

  /* 6c. The project switcher — the card at the top of the shell that names the project you
     are standing in. Its dropdown items and the vault list below it both carried this menu;
     the card itself did not, so the same project answered 300px lower down and not where a
     reader points first (P8 round 2 critic). */
  await armContextMenu(page);
  const switcher = page.locator(".switcher-button");
  const switcherName = (await switcher.locator(".switcher-name").textContent())?.trim();
  await switcher.click({ button: "right", position: { x: 60, y: 20 } });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "the sidebar's project switcher opens the project menu",
    (await page.getAttribute(".ctx-menu", "aria-label")) === switcherName,
    `label ${await page.getAttribute(".ctx-menu", "aria-label")}, card ${switcherName}`,
  );
  check(
    "…the same items the small copy of that project below it opens",
    same(await menuItems(page), ["open", "work", "bugs", "notes", "copy-path", "claude-md", "agents-md", "mcp-json", "delete"]),
    JSON.stringify(await menuItems(page)),
  );
  check(
    "…with Delete last, marked destructive rather than drawn like the other four",
    (await page.locator('.ctx-item[data-item="delete"].is-danger').count()) === 1 &&
      (await page.locator(".ctx-item").last().getAttribute("data-item")) === "delete",
    JSON.stringify(await menuItems(page)),
  );
  check(
    "…and right-clicking it did not also drop its dropdown open",
    (await page.locator(".switcher-menu").count()) === 0,
  );
  await page.keyboard.press("Escape");
  check(
    "…and esc gives the switcher its focus back",
    await page.evaluate(() => document.activeElement?.classList?.contains("switcher-button")),
    `focus is ${await focused(page)}`,
  );

  // Off a project there is no one project to act on, so there is no menu — and no Edge one.
  await page.goto(`${ORIGIN}/projects`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await watchContextMenu(page);
  await page.locator(".switcher-button").click({ button: "right", position: { x: 60, y: 20 } });
  await page.waitForTimeout(150);
  check("on /projects the switcher names no project, so it opens no menu", !(await menuOpen(page)));
  check(
    "…and the browser's is suppressed there too",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page))[0].prevented,
    JSON.stringify(await ctxSeen(page)),
  );

  /* 6d. "Across the vault" — the twelve rows at the foot of /projects.

     Same class string, same layout, same refHref destination as the dashboard feed rows one
     screen over, every one of them pointing at a real record, and for two rounds not one of
     them answered the right button or Shift+F10 (P8 round 3 critic). Silently: the document
     suppressor eats the event either way, so the gesture a reader learned on the dashboard
     just stopped working here. This is also the only feed in the app whose rows can name
     another project, which is what the Copy link check below is really about. */
  log("--- across the vault");
  await page.waitForSelector(".vault-feed a.feed-row", { state: "visible", timeout: 10_000 });
  /* Which rows are records is read off the destination, not off the `.feed-ref` chip: a
     project event carries a ref too (it is the slug), and a gate that took the chip as the
     tell would silently measure the wrong row on a vault whose newest event is a rename. */
  const RECORD_ROW = '.vault-feed a.feed-row[href*="/work/"], .vault-feed a.feed-row[href*="/bugs/"]';
  const PROJECT_ROW = '.vault-feed a.feed-row:not([href*="/work/"]):not([href*="/bugs/"])';
  const recordRow = page.locator(RECORD_ROW).first();
  check(
    "the vault feed draws rows that point at records",
    (await recordRow.count()) > 0,
    `${await page.locator(".vault-feed a.feed-row").count()} rows, ${await page.locator(RECORD_ROW).count()} of them records`,
  );
  const feedRef = (await recordRow.locator(".feed-ref").textContent())?.trim();
  const feedHref = await recordRow.getAttribute("href");
  const feedProjectName = (await recordRow.locator(".feed-project").textContent())?.trim();
  const feedSlug = feedHref.split("/")[2];
  await armContextMenu(page);
  await recordRow.click({ button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "a row of the vault-wide feed opens the record menu",
    (await page.getAttribute(".ctx-menu", "aria-label")) === feedRef,
    `label ${await page.getAttribute(".ctx-menu", "aria-label")}, row ${feedRef}`,
  );
  check(
    "…with the same four items the identical row on the dashboard has",
    same(await menuItems(page), ["open", "copy-id", "copy-title", "copy-link"]),
    JSON.stringify(await menuItems(page)),
  );
  check(
    "…and the browser's menu is suppressed on it",
    (await ctxSeen(page)).length === 1 && (await ctxSeen(page)).every((e) => e.prevented),
    JSON.stringify(await ctxSeen(page)),
  );
  /* The cross-project claim: this screen has no project in its URL, so the link the menu
     offers has to come from the row — the project the row itself names. */
  check(
    "…and Copy link carries the row's own project, which this screen's URL does not name",
    (await page.locator('.ctx-item[data-item="copy-link"] .ctx-hint').textContent()) === feedHref &&
      projects.find((p) => p.id === feedSlug)?.name === feedProjectName,
    `hint ${await page.locator('.ctx-item[data-item="copy-link"] .ctx-hint').textContent()}, href ${feedHref}, row names ${feedProjectName}`,
  );
  // The item this screen cannot answer from what it read: the feed loads events, which
  // carry a summary and never a title, so Copy title has to go and get one.
  await page.locator('.ctx-item[data-item="copy-title"]').click();
  await page.waitForSelector(".toast", { state: "visible", timeout: 5_000 });
  const feedCopied = await page.evaluate(() => navigator.clipboard.readText());
  const feedRecord = await (
    await fetch(
      `${ORIGIN}/project-api/projects/${feedSlug}/${feedRef.startsWith("BUG") ? "bugs" : "worklogs"}/${feedRef}`,
    )
  ).json();
  check(
    "…and Copy title fetches the title the vault feed never read",
    feedCopied === feedRecord.title && feedCopied.length > 0,
    `clipboard ${JSON.stringify(feedCopied)} vs vault ${JSON.stringify(feedRecord.title)}`,
  );

  /* Shift+F10 on the same row: the critic's second half — the mouse gesture was dead here
     and so was the keyboard one, on a screen that is the permanent sidebar destination and
     the recovery screen when a vault will not open. */
  await recordRow.focus();
  await page.keyboard.press("Shift+F10");
  await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "Shift+F10 on a focused vault-feed row opens the same menu",
    (await page.getAttribute(".ctx-menu", "aria-label")) === feedRef &&
      (await menuFocus(page)) === "open",
    `label ${await page.getAttribute(".ctx-menu", "aria-label")}, focus ${await menuFocus(page)}`,
  );
  await page.keyboard.press("Escape");
  check(
    "…and esc hands the keyboard back to the row",
    await page.evaluate(() => !!document.activeElement?.classList?.contains("feed-row")),
    `focus is ${await focused(page)}`,
  );

  /* Edge flipping. A menu that clips at the window edge is a menu with items nobody can
     reach, and the narrow window is where it happens. */
  await page.setViewportSize({ width: 960, height: 700 });
  await page.goto(`${ORIGIN}/p/${slug}/work`, { waitUntil: "domcontentloaded" });
  await ready(page);
  const nearRight = await page.evaluate(() => {
    const b = document.querySelector(".work-row").getBoundingClientRect();
    return { x: Math.round(b.right - 6), y: Math.round(b.top + 6) };
  });
  await page.mouse.click(nearRight.x, nearRight.y, { button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible" });
  const rightBox = await page.locator(".ctx-menu").boundingBox();
  check(
    "a menu opened at the right edge flips and stays inside the window",
    rightBox.x >= 0 && rightBox.x + rightBox.width <= 960,
    `x ${rightBox.x} + w ${rightBox.width} in 960`,
  );
  await page.keyboard.press("Escape");
  const nearBottom = await page.evaluate(() => {
    const y = innerHeight - 6;
    for (const row of document.querySelectorAll(".work-row")) {
      const b = row.getBoundingClientRect();
      if (b.top < y && b.bottom > y) return { x: Math.round(b.left + 40), y };
    }
    return null;
  });
  /* A project with fewer work logs than a 700px window holds has no row on that edge, and
     there is nothing to measure. That is a skip with a line, the way every other check here
     handles missing material — it used to be a `TypeError` on `null.x`, which killed the
     run and took 120 unrelated checks with it. The D3 loop meets exactly that project: the
     empty-state block above can only be measured on a project that still has a record
     written before human areas existed, which the live one no longer does. */
  if (!nearBottom) {
    log("    (no work row on the bottom edge at 960x700 — the upward flip is not measured here)");
  } else {
    await page.mouse.click(nearBottom.x, nearBottom.y, { button: "right" });
    await page.waitForSelector(".ctx-menu", { state: "visible" });
    const bottomBox = await page.locator(".ctx-menu").boundingBox();
    check(
      "…and one opened at the bottom edge grows upward instead of off the screen",
      bottomBox.y >= 0 && bottomBox.y + bottomBox.height <= 700,
      `y ${bottomBox.y} + h ${bottomBox.height} in 700`,
    );
  }
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // The same claim in the roster shape that broke it: more projects than the sidebar lists.
  log("--- 13 registered projects");
  const many = mkdtempSync(join(tmpdir(), "agentmon-many-"));
  temps.push(many);
  const bin = join(repoRoot, "target", "release", process.platform === "win32" ? "agentmon.exe" : "agentmon");
  const scratchEnv = { ...process.env, AGENTMON_REGISTRY_DIR: join(many, ".registry") };
  /** Where each scratch project's records live: <many>/<slug>/AgentMonitoring. */
  const locOf = (s) => join(many, s);
  const dataOf = (s) => join(locOf(s), "AgentMonitoring");
  cpSync(join(repoRoot, "AgentMonitoring"), dataOf("agent-monitoring"), { recursive: true });
  const manyDirs = [dataOf("agent-monitoring")];
  /* 12 scratch projects: 1–10 as before, 11 for the notes list parked under a delete and
     12 for the note record parked under one — each probe destroys its own project, so the
     third record kind gets its own two rather than re-using a survivor. */
  for (let i = 1; i <= 12; i += 1) {
    execFileSync(bin, [
      "--dir", locOf(`scratch-${i}`), "--json",
      "init",
      "--name", `Scratch project ${i}`,
      "--description", "A scratch project, created by scripts/check-keys.mjs to fill the sidebar.",
      "--agent", "check-keys",
    ], { env: scratchEnv });
    manyDirs.push(dataOf(`scratch-${i}`));
  }
  manyServer = startServer(MANY_PORT, {
    env: { AGENTMON_DIRS: manyDirs.join(";"), AGENTMON_REGISTRY_DIR: join(many, ".registry") },
  });
  const manyOrigin = `http://localhost:${MANY_PORT}`;
  await waitForServer(manyServer, manyOrigin);
  const wide = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
  await useLocale(wide, LOCALE);
  await wide.goto(`${manyOrigin}/projects`, { waitUntil: "domcontentloaded" });
  await ready(wide);
  const navRows = await wide.locator(".nav-sub").count();
  const overflow = await wide.locator(".nav-more").count();
  check(
    "the sidebar overflows to a '<N> more…' row with 13 projects",
    overflow === 1 && navRows === 9,
    `${navRows} sub rows, ${overflow} overflow rows`,
  );
  const markedMany = await currents(wide, "page");
  check(
    "on /projects with an overflow row, exactly one element is the current page",
    markedMany.length === 1 && markedMany[0].startsWith(T("nav.projects")),
    `marked: ${JSON.stringify(markedMany)}`,
  );
  check(
    "…and the overflow row is not styled as active either",
    (await wide.locator(".nav-more.active").count()) === 0,
  );

  /* The feed's *other* kind of row, in the roster shape that guarantees one: ten
     projects created a moment ago, so the newest events here are about projects and not
     about records. Those lines link to the project, so they open the project's menu — the
     rule is a menu about whatever the row points at, and no row in that list is dead. */
  await wide.waitForSelector(".vault-feed a.feed-row", { state: "visible", timeout: 10_000 });
  const evRow = wide.locator(PROJECT_ROW).first();
  const evName = (await evRow.locator(".feed-project").textContent())?.trim();
  await evRow.click({ button: "right" });
  await wide.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "a vault-feed row about the project itself opens the project menu",
    (await wide.getAttribute(".ctx-menu", "aria-label")) === evName &&
      same(await menuItems(wide), ["open", "work", "bugs", "notes", "copy-path", "claude-md", "agents-md", "mcp-json", "delete"]),
    `label ${await wide.getAttribute(".ctx-menu", "aria-label")} vs ${evName}, items ${JSON.stringify(await menuItems(wide))}`,
  );
  await wide.keyboard.press("Escape");

  /* 8. Delete, from the menu — the one action in this app that destroys anything, and the
     only one no agent can perform (no CLI verb, no MCP tool).

     Everything below runs against the **scratch copy**, on its own server, and only ever on
     the `scratch-N` projects this file created a hundred lines above; ./vault is never
     opened by this page. The four cancels are checked before the one delete, because a
     dialog that deletes on esc has already cost somebody their records by the time the
     happy path passes. */
  log("--- delete, and the four ways out of it");
  const manyRows = async () => (await (await fetch(`${manyOrigin}/project-api/projects`)).json());
  const manyProjects = async () =>
    (await manyRows()).filter((r) => r.available && r.project).map((r) => r.project);
  /** Scratch projects are identified by name — v2 has no slug. */
  const nameOf = (s) => (s === "agent-monitoring" ? "AgentMonitoring" : `Scratch project ${s.slice("scratch-".length)}`);
  const exists = async (s) => (await manyProjects()).some((p) => p.name === nameOf(s));
  const idOf = async (s) => (await manyProjects()).find((p) => p.name === nameOf(s))?.id;
  const goneFromVault = async (s, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!(await exists(s))) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };
  const dialogOpen = (page) => page.locator(".modal.is-danger").isVisible();
  const armed = async (page) =>
    !(await page.locator(".modal .button-danger").isDisabled());
  /** Open the menu on the /projects row of `name` and click its Delete item. */
  const openDialogFromRow = async (page, name) => {
    const row = page
      .locator(".project-row")
      .filter({ has: page.locator(`.project-name:text-is(${JSON.stringify(name)})`) })
      .first();
    await row.click({ button: "right", position: { x: 24, y: 18 } });
    await page.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
    /* This row can be below the fold in a 12-project vault, so reaching it scrolls the
       page — and a scroll still settling as the menu opens used to dismiss it on the spot. */
    await page.waitForTimeout(300);
    check(
      "a menu opened on a row that had to be scrolled to is still there a moment later",
      await page.locator(".ctx-menu").isVisible(),
    );
    await page.locator('.ctx-item[data-item="delete"]').click();
    await page.waitForSelector(".modal.is-danger", { state: "visible", timeout: 5_000 });
  };

  const victim = "scratch-9";
  const victimName = nameOf(victim);
  await wide.goto(`${manyOrigin}/projects`, { waitUntil: "domcontentloaded" });
  await ready(wide);

  const victimRow = wide
    .locator(".project-row")
    .filter({ has: wide.locator(`.project-name:text-is(${JSON.stringify(victimName)})`) })
    .first();
  await victimRow.click({ button: "right", position: { x: 24, y: 18 } });
  await wide.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "the project menu says what Delete costs before the click",
    ((await wide.locator('.ctx-item[data-item="delete"] .ctx-hint').textContent()) ?? "").trim() ===
      T("menu.deleteHint"),
  );
  await wide.keyboard.press("Escape");

  // esc, from the field the dialog put the keyboard in.
  await openDialogFromRow(wide, victimName);
  check(
    "the dialog takes the keyboard, in the box that has to be typed into",
    await wide.evaluate(() => !!document.activeElement?.closest?.(".modal")),
    `focus is ${await focused(wide)}`,
  );
  check("…and its button starts disabled", !(await armed(wide)));
  check(
    "…and the modal lock is declared, so the screen behind stands down",
    (await wide.getAttribute("html", "data-modal")) === "open",
  );
  // ↵ on an empty field: the browser's implicit submit, over a dialog about deleting.
  await wide.keyboard.press("Enter");
  await wide.waitForTimeout(400);
  check("↵ in the empty field deletes nothing", await exists(victim));
  check("…and leaves the dialog up rather than closing it", await dialogOpen(wide));
  await wide.keyboard.press("Escape");
  check("esc closes it", !(await wide.locator(".modal").count()));
  check("…and deletes nothing", await exists(victim));

  // The wrong name, and a near miss.
  await openDialogFromRow(wide, victimName);
  await wide.locator(".modal .input").fill("Scratch project");
  check("a name that is only a prefix does not arm the button", !(await armed(wide)));
  await wide.locator(".modal .input").fill(`${victimName}x`);
  check("…nor one with a character too many", !(await armed(wide)));
  await wide.keyboard.press("Enter");
  await wide.waitForTimeout(400);
  check("…and ↵ on a wrong name deletes nothing", await exists(victim));
  // The scrim.
  await wide.locator(".modal-scrim").click({ position: { x: 8, y: 8 } });
  check("a click on the scrim closes it", !(await wide.locator(".modal").count()));
  check("…and deletes nothing", await exists(victim));

  /* 9b. The dialog owns the window while it is up.

     Everything above measures the dialog answering its own keys. This measures the keys that
     move the app *around* it, and every one of them was a way for an armed confirmation to
     end up floating over a screen about a different project:

       * **Alt+Left**, the desktop app's only Back gesture (src/App.tsx), was a bare `window`
         listener with no modal check at all. One press navigated the page behind the scrim
         and left the dialog on top of it, still armed, still about the project the reader
         had left — and ↵ from there deleted it, off the disk, from a screen about Relay
         (P12 round 2 critic).
       * **Ctrl+K** opened the palette on top, and the first Escape then closed the *dialog
         underneath* rather than the palette the reader was looking at.
       * **A right-click** on the `projects/<slug>` printed in the dialog's own warning
         raised the copy menu *under* the scrim (z-index 70 against 80): nothing visible
         changed, the keyboard left the dialog for a menu nobody could see, and the next
         Escape closed the dialog and left the menu.

     The victim here is a different scratch project from the one above, and it is expected to
     be on disk at the end of all three. */
  log("--- the dialog owns the window");
  const owned = "scratch-7";
  const ownedName = nameOf(owned);
  /* In-app history, so Alt+Left is a route change inside the running app rather than a
     document load — which is the case that keeps the dialog mounted, and the reported one. */
  await wide.locator(".nav-sub").first().click();
  await ready(wide);
  await wide.locator('.nav-item[href="/projects"]').first().click();
  await ready(wide);
  const backTo = await wide.evaluate(() => history.length > 1);
  check("the gate has in-app history to go back to", backTo);

  await openDialogFromRow(wide, ownedName);
  await wide.locator(".modal .input").fill(ownedName);
  check("the dialog is armed before the keys that used to move the page", await armed(wide));
  const heldUrl = wide.url();
  await wide.keyboard.press("Alt+ArrowLeft");
  await wide.waitForTimeout(600);
  check(
    "Alt+Left does not navigate the page behind an open dialog",
    wide.url() === heldUrl,
    `went to ${wide.url()} from ${heldUrl}`,
  );
  check(
    "…and the dialog is still there, still armed, still holding the keyboard",
    (await dialogOpen(wide)) &&
      (await armed(wide)) &&
      (await wide.evaluate(() => !!document.activeElement?.closest?.(".modal"))),
    `dialog ${await wide.locator(".modal").count()}, focus ${await focused(wide)}`,
  );

  await wide.keyboard.press("Control+k");
  await wide.waitForTimeout(600);
  check(
    "Ctrl+K opens no palette over a dialog",
    (await wide.locator(".palette").count()) === 0,
    `palettes ${await wide.locator(".palette").count()}`,
  );
  check(
    "…and the dialog still has the window to itself",
    (await dialogOpen(wide)) && (await armed(wide)),
  );

  /* The right button, inside the dialog, on a selection: the app's own menu draws below the
     scrim, so it may not open here at all. The keyboard has to stay in the dialog. */
  const onSlug = await wide.evaluate(() => {
    const code = document.querySelector(".modal-warn code");
    if (!code) return null;
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const b = code.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  check("the dialog prints the folder it is about, in its warning", !!onSlug);
  await wide.mouse.click(onSlug.x, onSlug.y, { button: "right" });
  await wide.waitForTimeout(400);
  check(
    "a right-click inside the dialog raises no menu under its scrim",
    !(await menuOpen(wide)),
    `menus ${await wide.locator(".ctx-menu").count()}, focus ${await focused(wide)}`,
  );
  check("…and the dialog is still up", await dialogOpen(wide));
  /* That click landed on prose, which is not focusable, so the browser dropped the focus on
     <body> — and the box this dialog exists to have typed into must still get the typing. */
  await wide.locator(".modal .input").fill("");
  await wide.evaluate(() => document.activeElement?.blur?.());
  await wide.keyboard.type(ownedName);
  check(
    "typing with the focus dropped goes into the confirm box",
    (await wide.locator(".modal .input").inputValue()) === ownedName && (await armed(wide)),
    `box reads ${JSON.stringify(await wide.locator(".modal .input").inputValue())}`,
  );
  // One esc, on the layer the reader is looking at, and nothing was deleted by any of it.
  await wide.keyboard.press("Escape");
  await wide.waitForTimeout(300);
  check("one esc closes the dialog", !(await wide.locator(".modal").count()));
  check("…with no modal lock left behind", (await wide.getAttribute("html", "data-modal")) === null);
  check(`…and ${owned} is still on the disk after all of it`, await exists(owned));

  /* The other half of every stand-down in this app: it must not be a mute. With nothing
     open, the same Alt+Left is the Back gesture the desktop shell added it for. */
  const beforeBack = wide.url();
  await wide.keyboard.press("Alt+ArrowLeft");
  await wide.waitForTimeout(600);
  check(
    "…and with no dialog open Alt+Left still goes back",
    wide.url() !== beforeBack,
    `stayed on ${wide.url()}`,
  );
  await wide.locator('.nav-item[href="/projects"]').first().click();
  await ready(wide);

  /* The delete itself — and a second window, already open on the same vault, which finds
     out about it the way any other window would: from the watcher, with no reload. */
  log("--- delete, for real");
  const watcher = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await useLocale(watcher, LOCALE);
  let watcherLoads = 0;
  watcher.on("load", () => (watcherLoads += 1));
  await watcher.goto(`${manyOrigin}/projects`, { waitUntil: "domcontentloaded" });
  await ready(watcher);
  watcherLoads = 0;
  const rowsBefore = await watcher.locator(".project-row").count();

  await openDialogFromRow(wide, victimName);
  check(
    "the dialog counts what will be lost rather than asking 'are you sure?'",
    ((await wide.locator(".modal-facts dd").textContent()) ?? "").includes("·"),
    await wide.locator(".modal-facts dd").textContent(),
  );
  await wide.locator(".modal .input").fill(victimName);
  check("typing the name exactly arms the button", await armed(wide));
  await wide.locator(".modal .button-danger").click();
  check(`${victim} is gone from the disk`, await goneFromVault(victim));
  await wide.waitForSelector(".toast", { state: "visible", timeout: 10_000 });
  check(
    "…and one line says so, naming the project",
    ((await wide.locator(".toast-text").textContent()) ?? "").includes(victimName),
    await wide.locator(".toast-text").textContent(),
  );
  await wide.waitForFunction(
    (n) => document.querySelectorAll(".project-row").length === n,
    rowsBefore - 1,
    { timeout: 10_000 },
  );
  check("…and the row leaves the list it was deleted from", true);

  await watcher.waitForFunction(
    (n) => document.querySelectorAll(".project-row").length === n,
    rowsBefore - 1,
    { timeout: 20_000 },
  );
  check("a second window already open on the vault loses the row too", true);
  check("…without reloading the page", watcherLoads === 0, `${watcherLoads} load events`);
  await watcher.close();

  /* 9c. The second window parked *inside* the project — the half the check above cannot see.

     A list of projects updates when one leaves, because the thing it lists is projects. The
     three screens *scoped to* a project are the ones with something to lose, and they used
     to lose nothing: `useAsync` carries `refreshError` precisely so an open screen can
     notice its data went away, and the work list, the bug board and the dashboard destructured
     around it. Measured: a window parked on /p/<slug>/work went on printing "작업 로그 12개 ·
     진행 중 2개" and all twelve rows, indefinitely, while its own sidebar had already dropped
     the project — one window contradicting itself — and the dashboard kept flying its 실시간
     flag over a folder that is not on the disk (P12 round 2 critic, both transports). The
     dialog's own warning promises otherwise: "링크는 볼트에 없는 주소가 되고, 앱은 그 화면에서
     없는 프로젝트라고 알려 줍니다".

     So: one parked window per project-scoped list screen, each with real rows on it, each
     deleted from the other window, each expected to land on the app's designed
     no-such-project screen — from the poll, with no reload and no navigation. */
  log("--- a window parked inside the project it loses");

  /** Give a scratch project something to have on screen: an empty list losing nothing proves nothing. */
  const stock = (slug) => {
    execFileSync(bin, [
      "--dir", locOf(slug), "--json", "work", "start", "--agent", "check-keys",
      "--title", "Work that is on the screen when the folder leaves the disk",
      "--human",
      "A made-up task, written so a window sitting on this project's list has a row to lose when the folder is deleted.",
      "--body",
      "## What\nA work log, written by scripts/check-keys.mjs.\n\n" +
        "## Why\nSo a window parked on this project's work list has a row to lose.\n\n" +
        "## How\nThe CLI, into a scratch folder in a temp directory.",
    ], { env: scratchEnv });
    execFileSync(bin, [
      "--dir", locOf(slug), "--json", "bug", "create", "--agent", "check-keys",
      "--severity", "high",
      "--title", "A bug that is on the board when the folder leaves the disk",
      "--human",
      "A made-up problem, filed so a bug board somebody is looking at has a row to lose when the folder is deleted.",
      "--body", "Filed by scripts/check-keys.mjs so a parked bug board has a row to lose.",
    ], { env: scratchEnv });
    execFileSync(bin, [
      "--dir", locOf(slug), "--json", "note", "add", "--agent", "check-keys",
      "--type", "handoff",
      "--name", "note-on-screen-when-the-folder-leaves",
      "--title", "A note that is on the screen when the folder leaves the disk",
      "--description", "Left by scripts/check-keys.mjs so a parked notes screen has a row to lose.",
      "--human",
      "A made-up note, left so a notes screen somebody is looking at has a row to lose when the folder is deleted.",
      "--body", "A parked note page keeps this copy under the bar that says the note is gone.",
    ], { env: scratchEnv });
  };

  /* Each case: where the window parks, and what proves it was full before the delete. The
     dashboard's tell is its live flag — the loudest claim to be current in the app. */
  const parkedCases = [
    { slug: "scratch-1", path: "/work", screen: "the work list", full: ".work-row" },
    { slug: "scratch-2", path: "/bugs", screen: "the bug board", full: ".bug-row" },
    { slug: "scratch-3", path: "", screen: "the dashboard", full: ".live-flag" },
    { slug: "scratch-11", path: "/notes", screen: "the notes list", full: ".note-row" },
  ];

  for (const { slug, path, screen, full } of parkedCases) {
    stock(slug);
    const name = nameOf(slug);
    const pid = await idOf(slug);
    const parked = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    await useLocale(parked, LOCALE);
    let parkedLoads = 0;
    parked.on("load", () => (parkedLoads += 1));
    await parked.goto(`${manyOrigin}/p/${pid}${path}`, { waitUntil: "domcontentloaded" });
    await ready(parked);
    parkedLoads = 0;
    const parkedUrl = parked.url();
    check(
      `${screen}, parked inside ${slug}, has something on it before the delete`,
      (await parked.locator(full).count()) > 0,
      `no ${full} on ${parkedUrl}`,
    );

    await wide.goto(`${manyOrigin}/projects`, { waitUntil: "domcontentloaded" });
    await ready(wide);
    await openDialogFromRow(wide, name);
    await wide.locator(".modal .input").fill(name);
    await wide.locator(".modal .button-danger").click();
    check(`${slug} is gone from the disk`, await goneFromVault(slug));

    /* The whole point: the parked window finds out on its own, from the same poll that
       updates its sidebar, and says the one true thing about the address it is on. */
    await parked.waitForSelector(".error-state", { state: "visible", timeout: 25_000 });
    check(
      `…and ${screen} lands on the app's no-such-project screen without being told`,
      ((await parked.locator(".error-title").textContent()) ?? "").trim() ===
        T("proj.notRegistered", pid),
      `title reads "${await parked.locator(".error-title").textContent()}"`,
    );
    check(
      "…with nothing of the deleted project still drawn beside it",
      (await parked.locator(full).count()) === 0 &&
        (await parked.locator(".page-head-meta").count()) === 0,
      `${await parked.locator(full).count()} × ${full}`,
    );
    /* The defect was a window contradicting itself, so both halves have to be true at once.
       Waited for rather than sampled: the sidebar's read walks every project and the page's
       404s immediately, so the pane can honestly be first — which is the harmless order. */
    const agrees = await parked
      .waitForFunction(
        (n) =>
          ![...document.querySelectorAll(".nav-sub-name")].some((el) => el.textContent.trim() === n),
        name,
        { timeout: 20_000 },
      )
      .then(() => true, () => false);
    check("…and the window agrees with itself: the sidebar drops it too", agrees);
    check(
      "…with the screen still saying so once both halves have caught up",
      (await parked.locator(".error-state").count()) === 1 &&
        (await parked.locator(full).count()) === 0,
    );
    check(
      "…offering the way out the screen is designed with",
      ((await parked.locator(".error-actions .button").textContent()) ?? "").trim() ===
        T("nav.allProjects"),
      await parked.locator(".error-actions .button").textContent(),
    );
    check("…without reloading the page", parkedLoads === 0, `${parkedLoads} load events`);
    check(
      "…and without navigating anywhere: the state is the screen's, not a redirect",
      parked.url() === parkedUrl,
      `went to ${parked.url()} from ${parkedUrl}`,
    );
    await parked.close();
  }

  /* 9d. The same delete under a window parked on a *record* of that project.

     A record page is the one screen that does not turn into the no-such-project card, and
     for a good reason: the reader still has the thing they came for, and the vault has no
     undo and no recycle bin to get it back from. So it keeps its copy and says so in a bar
     over the top — "WORK-0001 — 이 볼트에 더 이상 없습니다. 아래는 마지막으로 읽었을 때 화면에
     있던 내용입니다."

     What it must not put beside that sentence is 다시 시도. Retry is a *manual* reload, and
     `useAsync` answers a failed manual reload by dropping `data` for the error card — so one
     click on the button next to the promise threw the promise away, and the last copy of a
     permanently deleted record with it (P12 round 3 critic, photographed in the WebView2
     window and reproduced in both languages). The one button here is the way out, and the
     way out has to lead somewhere that still exists. */
  log("--- a window parked on a record of the project it loses");

  const recordCases = [
    { slug: "scratch-5", screen: "the work log", kind: "worklogs", at: "/work", out: T("wd.workList") },
    { slug: "scratch-6", screen: "the bug", kind: "bugs", at: "/bugs", out: T("bd.bugBoard") },
    /* The third record kind. A note is the one record an agent *can* remove, but the claim
       under test here is the same one as its two siblings': the whole project going away
       under an open page keeps the reader's copy, with no retry, and the way out is the
       notes list. Its identity is its kebab name, which is why `rid` below reads both. */
    { slug: "scratch-12", screen: "the note", kind: "notes", at: "/notes", out: T("nd.notesList") },
  ];

  for (const { slug, screen, kind, at, out } of recordCases) {
    stock(slug);
    const name = nameOf(slug);
    const pid = await idOf(slug);
    const record = (
      await (await fetch(`${manyOrigin}/project-api/projects/${pid}/${kind}`)).json()
    )[0];
    /* A work log and a bug carry `id`; a note's id is its kebab `name`. */
    const rid = record.id ?? record.name;
    const parked = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    await useLocale(parked, LOCALE);
    let parkedLoads = 0;
    parked.on("load", () => (parkedLoads += 1));
    await parked.goto(`${manyOrigin}/p/${pid}${at}/${rid}`, { waitUntil: "domcontentloaded" });
    await ready(parked);
    parkedLoads = 0;
    const parkedUrl = parked.url();
    const sectionsBefore = await parked.locator(".record-section").count();
    const titleBefore = ((await parked.locator(".record-title").textContent()) ?? "").trim();
    check(
      `${screen} ${rid}, parked inside ${slug}, is on screen in full before the delete`,
      sectionsBefore > 0 && titleBefore.includes(record.title) && titleBefore.includes(rid),
      `${sectionsBefore} sections, title "${titleBefore}"`,
    );

    await wide.goto(`${manyOrigin}/projects`, { waitUntil: "domcontentloaded" });
    await ready(wide);
    await openDialogFromRow(wide, name);
    await wide.locator(".modal .input").fill(name);
    await wide.locator(".modal .button-danger").click();
    check(`${slug} is gone from the disk`, await goneFromVault(slug));

    await parked.waitForSelector(".vault-alert-inline", { state: "visible", timeout: 25_000 });
    check(
      `…and ${screen} says so over the copy it kept, without being told`,
      ((await parked.locator(".vault-alert-inline strong").textContent()) ?? "").trim() ===
        T("rec.staleGone", rid),
      `bar reads "${await parked.locator(".vault-alert-inline").textContent()}"`,
    );
    check(
      "…with the record still drawn under it, in full",
      (await parked.locator(".record-section").count()) === sectionsBefore &&
        ((await parked.locator(".record-title").textContent()) ?? "").trim() === titleBefore &&
        (await parked.locator(".error-state").count()) === 0,
      `${await parked.locator(".record-section").count()} sections, was ${sectionsBefore}`,
    );
    /* The fix itself. There is nothing to retry: the record is off the disk, and the button
       would spend the reader's last copy of it on re-asking a question already answered. */
    check(
      "…and offers no retry beside a sentence promising to keep it",
      (await parked.locator(".vault-alert-inline button").count()) === 0,
      `buttons: ${JSON.stringify(await parked.locator(".vault-alert-inline button").allTextContents())}`,
    );
    check(
      "…the one thing it offers being the way out",
      (await parked.locator(".vault-alert-inline a.button").count()) === 1 &&
        ((await parked.locator(".vault-alert-inline a.button").textContent()) ?? "").trim() === out,
      `links: ${JSON.stringify(await parked.locator(".vault-alert-inline a.button").allTextContents())}`,
    );
    check("…without reloading the page", parkedLoads === 0, `${parkedLoads} load events`);
    check(
      "…and without navigating: the reader is still on the record they were reading",
      parked.url() === parkedUrl,
      `went to ${parked.url()} from ${parkedUrl}`,
    );

    /* Leaving is the reader's own decision, and it lands on the screen the round above
       built: the list of a project that is not in this vault any more. */
    await parked.locator(".vault-alert-inline a.button").click();
    await parked.waitForSelector(".error-state", { state: "visible", timeout: 15_000 });
    check(
      "…which, when the reader takes it, lands on the app's no-such-project screen",
      ((await parked.locator(".error-title").textContent()) ?? "").trim() ===
        T("proj.notRegistered", pid),
      `title reads "${await parked.locator(".error-title").textContent()}"`,
    );
    await parked.close();
  }

  /* The mirror of that, which the fix must not have cost: a record that could not be
     *re-read* is not a record that is gone. The file itself is made unreadable here — its
     frontmatter taken away, which both backends answer with a 500 and not a 404 — so the bar
     says "다시 읽지 못했습니다" over the same kept copy, and it does offer the retry, because
     the record is still on the disk and a second read is exactly what is called for. */
  log("--- a record that could not be re-read is not a record that is gone");
  const unread = "scratch-10";
  stock(unread);
  const unreadId = await idOf(unread);
  const unreadRec = (
    await (await fetch(`${manyOrigin}/project-api/projects/${unreadId}/worklogs`)).json()
  )[0];
  const recPath = join(dataOf(unread), "worklogs", `${unreadRec.id}.md`);
  const recBytes = readFileSync(recPath);
  const shaken = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await useLocale(shaken, LOCALE);
  await shaken.goto(`${manyOrigin}/p/${unreadId}/work/${unreadRec.id}`, { waitUntil: "domcontentloaded" });
  await ready(shaken);
  const shakenSections = await shaken.locator(".record-section").count();
  writeFileSync(recPath, "This file lost its frontmatter while somebody was reading it.\n");
  try {
    await shaken.waitForSelector(".vault-alert-inline", { state: "visible", timeout: 25_000 });
    check(
      "a record that stops parsing raises the bar over the copy on screen",
      ((await shaken.locator(".vault-alert-inline strong").textContent()) ?? "").trim() ===
        T("rec.staleUnread", unreadRec.id),
      `bar reads "${await shaken.locator(".vault-alert-inline").textContent()}"`,
    );
    check(
      "…and this is the failure that keeps its retry: the record is still on the disk",
      (await shaken.locator(".vault-alert-inline button").count()) === 1 &&
        ((await shaken.locator(".vault-alert-inline button").textContent()) ?? "").trim() ===
          T("app.retry"),
      `buttons: ${JSON.stringify(await shaken.locator(".vault-alert-inline button").allTextContents())}`,
    );
    check(
      "…over a copy that is still all there",
      (await shaken.locator(".record-section").count()) === shakenSections &&
        (await shaken.locator(".error-state").count()) === 0,
    );
  } finally {
    writeFileSync(recPath, recBytes);
  }
  /* And the file coming back is enough: the poll re-reads it and the bar goes, with no
     reload and nothing for the reader to do. */
  await shaken.waitForSelector(".vault-alert-inline", { state: "detached", timeout: 40_000 });
  check(
    "…and when the file parses again the bar goes, leaving the record current",
    (await shaken.locator(".record-section").count()) === shakenSections &&
      (await shaken.locator(".error-state").count()) === 0,
  );
  await shaken.close();

  /* And the other half of that claim, which matters as much: a vault that is *briefly
     unreadable* is not a project that was deleted. Conflating them would replace a screen
     somebody is reading with an error card every time a dev server restarts. Here the whole
     vault directory goes away under a parked work list — the shell says so in its one line,
     and the rows stay exactly where they were. */
  log("--- a folder that goes quiet is not a project that was deleted");
  const survivor = "scratch-4";
  stock(survivor);
  const survivorId = await idOf(survivor);
  const held = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await useLocale(held, LOCALE);
  await held.goto(`${manyOrigin}/p/${survivorId}/work`, { waitUntil: "domcontentloaded" });
  await ready(held);
  const heldRows = await held.locator(".work-row").count();
  check(`a work list parked on ${survivor} has rows before the folder goes away`, heldRows > 0);

  /* A record of the same project, parked beside it: the screen that keeps a copy is the one
     with the most to lose from "the vault blinked" being read as "this was deleted". */
  const heldRec = (
    await (await fetch(`${manyOrigin}/project-api/projects/${survivorId}/worklogs`)).json()
  )[0];
  const heldRecord = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await useLocale(heldRecord, LOCALE);
  await heldRecord.goto(`${manyOrigin}/p/${survivorId}/work/${heldRec.id}`, { waitUntil: "domcontentloaded" });
  await ready(heldRecord);
  const heldSections = await heldRecord.locator(".record-section").count();
  check(`…and ${heldRec.id} is open beside it, in full`, heldSections > 0);

  /* Windows refuses a directory rename while anything inside it is open, and the cursor poll
     reads every record file twice a second — so ask again rather than fail the gate on a
     collision that has nothing to do with what is being measured. */
  const moveDir = async (from, to) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        renameSync(from, to);
        return;
      } catch (err) {
        if (Date.now() > deadline) throw err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  };

  /* v2: one folder going away is that folder's business — the app's list keeps serving
     the other eleven, so there is no shell-wide banner to wait for. What must hold is the
     conservative half: the parked screens keep what they had, with no error card, because
     "cannot read the folder right now" is not "this project was deleted". */
  const survivorData = dataOf(survivor);
  const away = `${survivorData}-away`;
  await moveDir(survivorData, away);
  try {
    await held.waitForTimeout(6_000);
    check(
      "a folder that stops answering leaves the parked list every row it had",
      (await held.locator(".work-row").count()) === heldRows,
      `${await held.locator(".work-row").count()} rows, was ${heldRows}`,
    );
    check(
      "…rather than the screen for a project that is not on this machine",
      (await held.locator(".error-state").count()) === 0,
      `error title "${await held.locator(".error-title").textContent().catch(() => "")}"`,
    );
    check(
      "…and the record open beside it keeps every word, with no error card",
      (await heldRecord.locator(".record-section").count()) === heldSections &&
        (await heldRecord.locator(".error-state").count()) === 0,
      `${await heldRecord.locator(".record-section").count()} sections, was ${heldSections}`,
    );
    check(
      "…and is not told the record was deleted, because it was not",
      !((await heldRecord.locator(".vault-alert-inline").textContent().catch(() => "")) ?? "").includes(
        T("rec.staleGone", heldRec.id),
      ),
      `inline bar reads "${await heldRecord.locator(".vault-alert-inline").textContent().catch(() => "")}"`,
    );
  } finally {
    await moveDir(away, survivorData);
  }
  await held.waitForTimeout(4_000);
  check(
    "…and when the folder comes back the rows are still there with no error card",
    (await held.locator(".work-row").count()) === heldRows &&
      (await held.locator(".error-state").count()) === 0,
  );
  check(
    "…and the record beside it is whole",
    (await heldRecord.locator(".record-section").count()) === heldSections &&
      (await heldRecord.locator(".error-state").count()) === 0,
  );
  await held.close();
  await heldRecord.close();

  /* Deleting the project the reader is standing *inside*. Left where they were, the next
     read would answer with "this vault has no project called …" — an error card in place of
     the thing they just asked for. */
  const inside = "scratch-8";
  const insideName = nameOf(inside);
  const insideId = await idOf(inside);
  await wide.goto(`${manyOrigin}/p/${insideId}/work`, { waitUntil: "domcontentloaded" });
  await ready(wide);
  await wide.locator(".switcher-button").click({ button: "right", position: { x: 60, y: 20 } });
  await wide.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  await wide.locator('.ctx-item[data-item="delete"]').click();
  await wide.waitForSelector(".modal.is-danger", { state: "visible", timeout: 5_000 });
  check(
    "the switcher's own menu opens the same dialog, about the project it names",
    ((await wide.locator(".modal-project-slug").textContent()) ?? "").includes(inside),
    await wide.locator(".modal-project-slug").textContent(),
  );
  await wide.locator(".modal .input").fill(insideName);
  await wide.locator(".modal .button-danger").click();
  check(`${inside} is gone from the disk`, await goneFromVault(inside));
  await wide.waitForURL(`${manyOrigin}/projects`, { timeout: 10_000 });
  await ready(wide);
  check("…and the reader who was standing in it is moved to /projects", true);
  check(
    "…rather than being left on an error card about the vault",
    (await wide.locator(".error-state").count()) === 0 &&
      ((await wide.locator(".page-title").textContent()) ?? "").trim() === T("proj.title"),
    `title reads "${await wide.locator(".page-title").textContent()}"`,
  );
  check(
    "…and the deleted project is not in the sidebar any more",
    !(await wide.locator(".nav-sub-name").allTextContents()).includes(insideName),
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
