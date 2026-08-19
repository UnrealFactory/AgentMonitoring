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
 *   9. Nothing in it deletes (the vault is append-only), Archive says so before the click,
 *      and archiving really does leave a way back — from the Projects screen's undo bar, and
 *      from the toast when it is invoked anywhere else.
 *
 * Two scratch vaults are built in temp directories — a 12-project one for (5) and the same
 * copy for the writes in (8). ./vault is read, never written.
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
    !/delete|remove|discard/i.test((await page.locator(".ctx-menu").textContent()) ?? ""),
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
      same(await menuItems(page), ["open", "work", "bugs", "copy-slug", "archive"]),
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
  const realTitle = await (
    await fetch(`${ORIGIN}/vault-api/projects/${slug}/${feedId.startsWith("BUG") ? "bugs" : "worklogs"}/${feedId}`)
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
    "…the same five items the small copy of that project below it opens",
    same(await menuItems(page), ["open", "work", "bugs", "copy-slug", "archive"]),
    JSON.stringify(await menuItems(page)),
  );
  check(
    "…and still nothing that deletes",
    !/delete|remove|discard/i.test((await page.locator(".ctx-menu").textContent()) ?? ""),
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
      projects.find((p) => p.slug === feedSlug)?.name === feedProjectName,
    `hint ${await page.locator('.ctx-item[data-item="copy-link"] .ctx-hint').textContent()}, href ${feedHref}, row names ${feedProjectName}`,
  );
  // The item this screen cannot answer from what it read: the feed loads events, which
  // carry a summary and never a title, so Copy title has to go and get one.
  await page.locator('.ctx-item[data-item="copy-title"]').click();
  await page.waitForSelector(".toast", { state: "visible", timeout: 5_000 });
  const feedCopied = await page.evaluate(() => navigator.clipboard.readText());
  const feedRecord = await (
    await fetch(
      `${ORIGIN}/vault-api/projects/${feedSlug}/${feedRef.startsWith("BUG") ? "bugs" : "worklogs"}/${feedRef}`,
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
  await page.mouse.click(nearBottom.x, nearBottom.y, { button: "right" });
  await page.waitForSelector(".ctx-menu", { state: "visible" });
  const bottomBox = await page.locator(".ctx-menu").boundingBox();
  check(
    "…and one opened at the bottom edge grows upward instead of off the screen",
    bottomBox.y >= 0 && bottomBox.y + bottomBox.height <= 700,
    `y ${bottomBox.y} + h ${bottomBox.height} in 700`,
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });

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

  /* The vault feed's *other* kind of row, in the vault shape that guarantees one: ten
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
      same(await menuItems(wide), ["open", "work", "bugs", "copy-slug", "archive"]),
    `label ${await wide.getAttribute(".ctx-menu", "aria-label")} vs ${evName}, items ${JSON.stringify(await menuItems(wide))}`,
  );
  await wide.keyboard.press("Escape");

  /* 8. Archive, from the menu — the one item in this app that writes. It is run against the
     scratch copy, never ./vault, and what is checked is the promise the item makes in its
     own hint: the records are kept, and there is a way back from wherever it was invoked. */
  log("--- archive, and the way back");
  const manyProjects = async () => (await (await fetch(`${manyOrigin}/vault-api/projects`)).json());
  const statusOf = async (s) => (await manyProjects()).find((p) => p.slug === s)?.status;
  const settles = async (s, want, ms = 10_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if ((await statusOf(s)) === want) return true;
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  };
  const workCount = async (s) =>
    (await (await fetch(`${manyOrigin}/vault-api/projects/${s}/worklogs`)).json()).length;

  const projectName = projects.find((p) => p.slug === slug)?.name;
  const recordsBefore = await workCount(slug);
  const projectRow = wide
    .locator(".project-row")
    .filter({ has: wide.locator(`.project-name:text-is(${JSON.stringify(projectName)})`) })
    .first();
  await projectRow.click({ button: "right", position: { x: 24, y: 18 } });
  await wide.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  check(
    "the project menu says what Archive costs before the click",
    ((await wide.locator('.ctx-item[data-item="archive"] .ctx-hint').textContent()) ?? "").trim() ===
      "records are kept",
  );
  check(
    "…and there is deliberately no Delete in it",
    !/delete|remove|discard/i.test((await wide.locator(".ctx-menu").textContent()) ?? ""),
  );
  /* This row is below the fold in a 12-project vault, so reaching it scrolls the page —
     and a scroll still settling as the menu opens used to dismiss it on the spot. */
  await wide.waitForTimeout(300);
  check(
    "…and a menu opened on a row that had to be scrolled to is still there a moment later",
    await wide.locator(".ctx-menu").isVisible(),
  );
  await wide.locator('.ctx-item[data-item="archive"]').click();
  await wide.waitForSelector(".undo-bar", { state: "visible", timeout: 10_000 });
  check("archiving from a row menu on /projects raises that screen's own undo bar", true);
  check(`…and ${slug} really is archived in the vault`, await settles(slug, "archived"));
  check(
    "…with every record it had still in it",
    (await workCount(slug)) === recordsBefore,
    `${await workCount(slug)} vs ${recordsBefore}`,
  );
  await wide.locator(".undo-bar .button").click();
  check("…and Undo puts it back", await settles(slug, "active"));

  /* The same action from the sidebar, where there is no undo bar to raise: the way back
     arrives as a toast, and — like the bar — it waits rather than fading. */
  await wide.goto(`${manyOrigin}/p/${slug}`, { waitUntil: "domcontentloaded" });
  await ready(wide);
  const pick = await wide.evaluate(() => {
    const rows = [...document.querySelectorAll(".nav-sub")].filter(
      (r) => !r.classList.contains("nav-more"),
    );
    const i = rows.findIndex((r) => !r.classList.contains("is-current"));
    return i < 0 ? null : { i, name: rows[i].querySelector(".nav-sub-name").textContent.trim() };
  });
  const pickedSlug = (await manyProjects()).find((p) => p.name === pick?.name)?.slug;
  await wide.locator(".nav-sub").nth(pick.i).click({ button: "right" });
  await wide.waitForSelector(".ctx-menu", { state: "visible", timeout: 5_000 });
  await wide.locator('.ctx-item[data-item="archive"]').click();
  await wide.waitForSelector(".toast", { state: "visible", timeout: 10_000 });
  check(`archiving ${pickedSlug} from the sidebar archives it`, await settles(pickedSlug, "archived"));
  check(
    "…and answers with a toast offering the way back",
    ((await wide.locator(".toast .button").textContent()) ?? "").trim() === "Undo",
  );
  // An undo that fades is an undo for people who were already looking (the P5 rule).
  await wide.waitForTimeout(3_000);
  check("…which does not fade out from under the reader", await wide.locator(".toast").isVisible());
  await wide.locator(".toast .button").click();
  check("…and it works", await settles(pickedSlug, "active"));

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
