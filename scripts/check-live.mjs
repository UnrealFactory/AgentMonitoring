#!/usr/bin/env node
/**
 * Prove the app is live: a record written to the project reaches every open screen,
 * without a navigation, without a reload, and without losing the reader's place.
 *
 *   npm run check:live
 *   node scripts/check-live.mjs [--port 5199] [--wait 10]
 *
 * This is the gate for the P4 critic's biggest gap. Before it, every page fetched exactly
 * once — at navigation — so an open dashboard printed yesterday's numbers under a green
 * LIVE flag while the sidebar beside it, which the watcher did reload, printed today's. The
 * fix has to hold three things at once, and all three are checked here:
 *
 *   1. **It arrives.** A CLI write shows up on an open dashboard, an open record page *and*
 *      an open note page within the deadline (10s by default), with nobody touching the
 *      browser — the note by having its own description rewritten under the reader.
 *   2. **It does not flash.** No page load, no skeleton, no scroll jump, same URL. A
 *      refresh that throws the page away is a reload with extra steps — the old browser-mode
 *      behaviour was literally `{type:"full-reload"}` down the HMR socket.
 *   3. **It is quiet when nothing happens.** Idling next to the records must not re-fetch
 *      anything: a poll that refreshes on every tick is a poll that fights the reader.
 *
 * It runs against a **copy** of the records in the system temp directory and mutates only
 * that copy — the live folder at ./AgentMonitoring is never written to by this script.
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Prove the app refreshes itself when the records change.

  npm run check:live
  node scripts/check-live.mjs [--port 5199] [--wait 10] [--keep]

  --port <n>   dev-server port (default 5199, its own so it never fights a screenshot run)
  --wait <s>   how long a change may take to reach an open screen (default 10)
  --keep       leave the temp copy behind for inspection

Never writes to ./AgentMonitoring: it copies the records to the temp directory first.`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.LIVE_PORT || 5199));
const WAIT_MS = Number(value("--wait", 10)) * 1000;
const ORIGIN = `http://localhost:${PORT}`;
const KEEP = args.includes("--keep");
/* The panels this gate reads are found by their headings, which are words. */
const LOCALE = value("--locale", process.env.SHOT_LOCALE || "ko");
const T = (key, ...args) => t(LOCALE, key, ...args);
const log = (...m) => console.log("[check:live]", ...m);

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

const exe = process.platform === "win32" ? "agentmon.exe" : "agentmon";
const BIN = process.env.AGENTMON_BIN || join(repoRoot, "target", "release", exe);

/** Run the real CLI against the throwaway copy — the same writer an agent uses. */
function agentmon(dir, cliArgs) {
  return execFileSync(BIN, ["--dir", dir, ...cliArgs], {
    encoding: "utf8",
    // A scratch registry: this gate must not bookmark its temp copy on the real machine.
    env: { ...process.env, AGENTMON_REGISTRY_DIR: join(tmpdir(), "agentmon-live-registry") },
  });
}

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/project-api${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

/**
 * Read a number off the dashboard by the panel it lives in, not by nth-child.
 *
 * The panels are found by their heading, which is a word in the reader's language, so the
 * words come from the same dictionary the window uses (scripts/i18n.mjs).
 */
const dashboardFacts = (page) =>
  page.evaluate(
    ([unresolvedBugs, last24h, bugsNav]) => {
      const panel = (label) =>
        [...document.querySelectorAll(".now-panel")].find((p) =>
          p.querySelector(".now-label")?.textContent?.trim().startsWith(label),
        );
      const text = (el, sel) => el?.querySelector(sel)?.textContent?.trim() ?? null;
      return {
        openBugs: text(panel(unresolvedBugs), ".now-figure-value"),
        openBugsUnit: text(panel(unresolvedBugs), ".now-figure-unit"),
        lastDay: text(panel(last24h), ".now-figure-value"),
        activity: document.querySelector("#activity .card-note")?.textContent?.trim() ?? null,
        sidebarBugs:
          [...document.querySelectorAll(".nav-item")]
            .find((n) => n.textContent?.trim().startsWith(bugsNav))
            ?.querySelector(".nav-count")
            ?.textContent?.trim() ?? null,
        feedTop: document.querySelector(".feed-summary")?.textContent?.trim() ?? null,
      };
    },
    [T("dash.unresolvedBugs"), T("dash.last24h"), T("nav.bugs")],
  );

/** Everything that must survive a refresh: the page instance, its scroll, its URL. */
const stamp = (page) =>
  page.evaluate(() => {
    const w = window;
    w.__liveProbe = w.__liveProbe ?? Math.random().toString(36).slice(2);
    w.__sawSkeleton = false;
    if (!w.__liveObserver) {
      w.__liveObserver = new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.addedNodes) {
            if (
              node.nodeType === 1 &&
              (node.classList?.contains("skeleton") || node.querySelector?.(".skeleton"))
            ) {
              w.__sawSkeleton = true;
            }
          }
        }
      });
      w.__liveObserver.observe(document.body, { childList: true, subtree: true });
    }
    return w.__liveProbe;
  });

/**
 * `landmark` is something the reader can see: where it sits in the window is the real
 * measure of "did I lose my place". Not `scrollTop` — when a new row appears *above* the
 * fold the browser's scroll anchoring moves scrollTop on purpose, precisely so the visible
 * content does not jump, and asserting the number would fail the very behaviour we want.
 */
const state = (page, landmark) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const main = document.querySelector(".main");
    return {
      probe: window.__liveProbe ?? null,
      sawSkeleton: window.__sawSkeleton === true,
      scroll: main?.scrollTop ?? 0,
      /** Where the landmark sits in the window — what the reader actually sees. */
      landmarkTop: Math.round(el?.getBoundingClientRect().top ?? NaN),
      /** …and how far down the document it is, so growth above it can be told apart. */
      landmarkOffset: Math.round(
        (el?.getBoundingClientRect().top ?? 0) + (main?.scrollTop ?? 0),
      ),
      url: location.href,
    };
  }, landmark);

const ready = async (page) => {
  await page.waitForSelector(".page-title, .record-title", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
};

/** Wait for `read(page)` to satisfy `done`, and report how long it took. */
async function waitFor(page, read, done, label) {
  const started = Date.now();
  for (;;) {
    const value = await read(page);
    if (done(value)) return { ms: Date.now() - started, value };
    if (Date.now() - started > WAIT_MS) return { ms: Date.now() - started, value, timedOut: true };
    await page.waitForTimeout(250);
  }
}

let browser = null;
let server = null;
let vaultCopy = null;

try {
  if (!existsSync(BIN)) {
    throw new Error(
      `the agentmon binary is not built (${BIN}) — run \`cargo build --release -p agentmon-cli\``,
    );
  }

  // A copy, always. This gate writes records, and the folder in this repo is real history.
  const source = process.env.AGENTMON_DIR || join(repoRoot, "AgentMonitoring");
  vaultCopy = join(mkdtempSync(join(tmpdir(), "agentmon-live-")), "AgentMonitoring");
  cpSync(source, vaultCopy, { recursive: true });
  log(`records copy: ${vaultCopy} (source ${source} is never written to)`);

  log(`starting a dev server on ${ORIGIN} against the copy…`);
  server = startServer(PORT, {
    env: {
      AGENTMON_DIRS: vaultCopy,
      AGENTMON_REGISTRY_DIR: join(tmpdir(), "agentmon-live-registry"),
    },
  });
  await waitForServer(server, ORIGIN);

  /* Whose server is this? Vite moves to the next free port when the one it was given is
     taken, and `waitForServer` is satisfied by *any* answer on the origin — so a dev
     server somebody left running on this port answers every request in this file. That is
     not a flaky gate, it is a gate that writes to the wrong records: it created a project
     in this repo's real history before this check existed. It has to be the copy. */
  const servingRows = await api("/projects");
  if (!servingRows.some((r) => resolve(r.path) === resolve(vaultCopy))) {
    throw new Error(
      `something else is already listening on ${ORIGIN}: it serves ${servingRows.map((r) => r.path).join(", ")}, not the ` +
        `copy at ${vaultCopy}. Stop it (or pass --port/$LIVE_PORT) and run this again — this ` +
        `gate writes records, and it must only ever write to its own copy.`,
    );
  }

  const projects = servingRows.filter((r) => r.available && r.project).map((r) => r.project);
  if (!projects.length) throw new Error("the records copy has no readable project");
  const project =
    projects.find((p) => p.counts.workInProgress > 0) ??
    [...projects].sort((a, b) => b.counts.events - a.counts.events)[0];
  const slug = project.id;

  // The record the detail page will be open on: something already in flight, or one
  // started now — either way it exists *before* the pages open, so the change under test
  // is only the update that follows.
  let works = await api(`/projects/${slug}/worklogs`);
  let target = works.find((w) => w.status === "in_progress");
  if (!target) {
    agentmon(vaultCopy, [
      "work",
      "start",
      "--agent",
      "check-live",
      "--title",
      "Liveness gate: a record to post an update on",
      "--body",
      "## What\n\nA work log the liveness gate posts an update to.\n\n## Why\n\nThe gate needs a record that is open before the browser opens it.\n\n## How\n\nStarted by scripts/check-live.mjs against a copy of the vault.\n",
    ]);
    works = await api(`/projects/${slug}/worklogs`);
    target = works.find((w) => w.status === "in_progress");
  }

  // The note the third page will be open on. A note is the third record kind and the only
  // mutable one — `note update` rewrites it in place — so its page is where "the app is
  // live" has the most to prove: the reader is looking at the exact sentence that changes.
  const noteRecords = await api(`/projects/${slug}/notes`);
  const note = noteRecords.find((n) => n.name === "registry-sandbox-in-gates") ?? noteRecords[0];
  if (!note) throw new Error("the records copy has no note for the note page to open");
  log(`project: ${slug} · dashboard + ${target.id} + ${note.name}`);

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await useLocale(context, LOCALE);
  log(`language: ${LOCALE}`);

  const dash = await context.newPage();
  const detail = await context.newPage();
  const notePage = await context.newPage();
  let loads = 0;
  let dataRequests = 0;
  for (const page of [dash, detail, notePage]) {
    page.on("load", () => (loads += 1));
    page.on("pageerror", (err) => {
      failures += 1;
      console.error(`  page error: ${err.message}`);
    });
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/project-api/") && !url.includes("/project-api/cursor")) dataRequests += 1;
    });
  }

  await dash.goto(`${ORIGIN}/p/${slug}`, { waitUntil: "domcontentloaded" });
  await ready(dash);
  await dash.waitForFunction(() =>
    [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
  );
  await detail.goto(`${ORIGIN}/p/${slug}/work/${target.id}`, { waitUntil: "domcontentloaded" });
  await ready(detail);
  await notePage.goto(`${ORIGIN}/p/${slug}/notes/${note.name}`, { waitUntil: "domcontentloaded" });
  await ready(notePage);

  // Scroll the pages well down: the reader is mid-page, which is the whole point. (A short
  // note page clamps the scroll; the checks below read what it actually landed on.)
  for (const page of [dash, detail, notePage]) {
    await page.evaluate(() => document.querySelector(".main")?.scrollTo(0, 420));
    await page.waitForTimeout(50);
  }

  await stamp(dash);
  await stamp(detail);
  await stamp(notePage);
  const LANDMARK = { dash: "#activity", detail: ".record-title", note: ".record-title" };
  const before = {
    dash: await state(dash, LANDMARK.dash),
    detail: await state(detail, LANDMARK.detail),
    note: await state(notePage, LANDMARK.note),
  };
  const factsBefore = await dashboardFacts(dash);
  loads = 0;
  log(`baseline: unresolved bugs ${factsBefore.openBugs}, ${factsBefore.activity}`);

  /* -- 3. quiet when nothing happens ---------------------------------------- */

  dataRequests = 0;
  await dash.waitForTimeout(4500);
  check(
    "idling beside an unchanged vault re-fetches nothing",
    dataRequests === 0,
    `${dataRequests} data requests in 4.5s of silence (the cursor poll is excluded)`,
  );

  /* -- 1 + 2. a CLI write reaches both open screens -------------------------- */

  const marker = `live-gate-${Date.now().toString(36)}`;
  agentmon(vaultCopy, [
    "bug",
    "create",
    "--agent",
    "check-live",
    "--title",
    `Liveness gate marker ${marker}`,
    "--severity",
    "low",
    "--body",
    `## Report\n\nFiled by scripts/check-live.mjs to prove an open dashboard notices a new record. Marker ${marker}.\n`,
  ]);
  agentmon(vaultCopy, [
    "work",
    "update",
    target.id,
    "--agent",
    "check-live",
    "--message",
    `Liveness gate note ${marker}: this sentence was written while the record page was already open.`,
  ]);

  const expectedBugs = String(Number(factsBefore.openBugs) + 1);
  const dashResult = await waitFor(
    dash,
    dashboardFacts,
    (f) => f.openBugs === expectedBugs,
    "dashboard",
  );
  check(
    `an open dashboard shows a bug filed after it loaded (within ${WAIT_MS / 1000}s)`,
    !dashResult.timedOut,
    `unresolved bugs read ${dashResult.value.openBugs} after ${dashResult.ms}ms, expected ${expectedBugs}`,
  );
  if (!dashResult.timedOut) log(`dashboard caught up in ${dashResult.ms}ms`);

  const detailResult = await waitFor(
    detail,
    (page) => page.evaluate(() => document.body.innerText),
    (text) => text.includes(marker),
    "detail",
  );
  check(
    "an open record page shows an update posted after it loaded",
    !detailResult.timedOut,
    `the note did not appear within ${WAIT_MS / 1000}s`,
  );
  if (!detailResult.timedOut) log(`record page caught up in ${detailResult.ms}ms`);

  const after = {
    dash: await state(dash, LANDMARK.dash),
    detail: await state(detail, LANDMARK.detail),
    note: await state(notePage, LANDMARK.note),
  };
  check("no page reloaded", loads === 0, `${loads} load events`);
  check(
    "the pages are the same instances (no remount, no navigation)",
    after.dash.probe === before.dash.probe &&
      after.detail.probe === before.detail.probe &&
      after.note.probe === before.note.probe,
    JSON.stringify({ before, after }),
  );
  check(
    "no skeleton flashed while refreshing",
    !after.dash.sawSkeleton && !after.detail.sawSkeleton && !after.note.sawSkeleton,
    `dashboard ${after.dash.sawSkeleton}, record ${after.detail.sawSkeleton}, note ${after.note.sawSkeleton}`,
  );
  /* What "scroll preserved" has to mean on a screen whose content grew above the fold: a
     new bug row and a new agent row really do push the page down, and the browser's scroll
     anchoring absorbs most of that by moving scrollTop on purpose. So the measure is the
     landmark's position in the *window*, and the budget is one row — a reload, the failure
     this guards against, puts the reader hundreds of pixels away, at the top. */
  const ROW = 100;
  const moved = (a, b) => Math.abs(a.landmarkTop - b.landmarkTop);
  const grew = (a, b) => b.landmarkOffset - a.landmarkOffset;
  check(
    "the reader kept their place on all three screens",
    moved(before.dash, after.dash) <= ROW &&
      moved(before.detail, after.detail) <= ROW &&
      moved(before.note, after.note) <= ROW,
    `landmark moved ${moved(before.dash, after.dash)}px on the dashboard (${LANDMARK.dash}), ` +
      `${moved(before.detail, after.detail)}px on the record (${LANDMARK.detail}) and ` +
      `${moved(before.note, after.note)}px on the note (${LANDMARK.note}); ` +
      `scrollTop ${before.dash.scroll}→${after.dash.scroll} / ${before.detail.scroll}→${after.detail.scroll}`,
  );
  log(
    `dashboard: content above the landmark grew ${grew(before.dash, after.dash)}px ` +
      `(a new bug row, a new agent row), scrollTop moved ` +
      `${after.dash.scroll - before.dash.scroll}px, and the view moved ` +
      `${moved(before.dash, after.dash)}px`,
  );
  /* The direction scrollTop moves is the browser's business — anchoring nudges it up when
     content above the fold grows and back down when it shrinks, both to keep the view
     still, which the landmark check above already measures. What must never happen is the
     reader being put back at the top, which is what a reload does. */
  const stillScrolled = (a, b) => a.scroll === 0 || b.scroll > 0;
  check(
    "no screen scrolled back to the top",
    stillScrolled(before.dash, after.dash) &&
      stillScrolled(before.detail, after.detail) &&
      stillScrolled(before.note, after.note),
    `dashboard ${before.dash.scroll}→${after.dash.scroll}, record ${before.detail.scroll}→${after.detail.scroll}, note ${before.note.scroll}→${after.note.scroll}`,
  );
  check(
    "the URL never moved",
    after.dash.url === before.dash.url &&
      after.detail.url === before.detail.url &&
      after.note.url === before.note.url,
    `${after.dash.url} / ${after.detail.url} / ${after.note.url}`,
  );

  /* -- the self-contradiction the critic caught: sidebar vs page ------------- */

  const facts = await dashboardFacts(dash);
  check(
    "the sidebar and the dashboard agree about unresolved bugs",
    facts.sidebarBugs === T("word.unresolvedCount", Number(facts.openBugs)),
    `sidebar "${facts.sidebarBugs}" vs card "${facts.openBugs}"`,
  );
  /* The first number in the note, wherever the language puts it: "85 events · 3 days · UTC"
     leads with it, "이벤트 85건 · 3일 · UTC" does not. */
  const eventsIn = (note) => Number(/\d+/.exec(note ?? "")?.[0] ?? -1);
  const activityCount = eventsIn(facts.activity);
  const beforeCount = eventsIn(factsBefore.activity);
  check(
    "the activity feed counted the new events too",
    activityCount === beforeCount + 2,
    `${factsBefore.activity} -> ${facts.activity} (expected +2: one bug, one update)`,
  );

  /* -- a second write, to prove it was not a one-off ------------------------- */

  const second = `${marker}-2`;
  agentmon(vaultCopy, [
    "work",
    "update",
    target.id,
    "--agent",
    "check-live",
    "--message",
    `Second liveness note ${second}.`,
  ]);
  const again = await waitFor(
    detail,
    (page) => page.evaluate(() => document.body.innerText),
    (text) => text.includes(second),
    "detail",
  );
  check("a second write lands as well", !again.timedOut, `not seen within ${WAIT_MS / 1000}s`);

  /* -- the third record kind: a note is rewritten in place, and that is live too ---
     The sentence under test is the one the reader is looking at — the author's own
     description, `.note-lead`, which `note update` replaces rather than appends to. */

  const noteMarker = `note-${marker}`;
  agentmon(vaultCopy, [
    "note",
    "update",
    note.name,
    "--agent",
    "check-live",
    "--description",
    `Liveness gate: this description was rewritten while the page was open (${noteMarker}).`,
  ]);
  const noteResult = await waitFor(
    notePage,
    (page) => page.locator(".note-lead").textContent(),
    (text) => (text ?? "").includes(noteMarker),
    "note",
  );
  check(
    "an open note page shows a description rewritten after it loaded",
    !noteResult.timedOut,
    `.note-lead still reads ${JSON.stringify(noteResult.value)} after ${WAIT_MS / 1000}s`,
  );
  if (!noteResult.timedOut) log(`note page caught up in ${noteResult.ms}ms`);
  const noteAfter = await state(notePage, LANDMARK.note);
  check(
    "…with no reload, the same page instance, no skeleton, and the reader's place kept",
    loads === 0 &&
      noteAfter.probe === before.note.probe &&
      !noteAfter.sawSkeleton &&
      moved(before.note, noteAfter) <= ROW &&
      noteAfter.url === before.note.url,
    JSON.stringify({ before: before.note, after: noteAfter }),
  );

  /* …and a brand-new note reaches the open dashboard's feed, named by its kebab name —
     the third shape a feed ref can take, linking to the note's own page. */
  const newNote = `live-note-${Date.now().toString(36)}`;
  agentmon(vaultCopy, [
    "note",
    "add",
    "--agent",
    "check-live",
    "--type",
    "memory",
    "--name",
    newNote,
    "--title",
    "Liveness gate: a note filed while the dashboard was open",
    "--description",
    "Filed by scripts/check-live.mjs to prove a note event reaches an open feed.",
    "--body",
    "The open dashboard's activity feed should gain a note_created event whose ref is this note's kebab name and whose row links to the note's own page.",
  ]);
  const feedNote = await waitFor(
    dash,
    (page) =>
      page.evaluate(
        (name) =>
          [...document.querySelectorAll("a.feed-row")]
            .filter((row) => row.querySelector(".feed-ref")?.textContent?.trim() === name)
            .map((row) => row.getAttribute("href"))[0] ?? "",
        newNote,
      ),
    (href) => href !== "",
    "feed",
  );
  check(
    "a note filed under an open dashboard reaches its feed, named by its kebab name",
    !feedNote.timedOut,
    `no feed row carries the ref ${newNote} within ${WAIT_MS / 1000}s`,
  );
  check(
    "…and the feed row links to the note's own page",
    (feedNote.value ?? "").endsWith(`/p/${slug}/notes/${newNote}`),
    `href ${JSON.stringify(feedNote.value)}`,
  );

  /* -- the browser-mode write path (the app's own create) -------------------- */

  const newLocation = join(vaultCopy, "..", "live-gate-project");
  const created = await dash.evaluate(async (location) => {
    const res = await fetch("/project-api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        location,
        name: "Liveness gate project",
        description: "Created through the app's own write endpoint by scripts/check-live.mjs.",
        tags: ["gate"],
        agent: "check-live",
      }),
    });
    return { status: res.status, body: await res.json() };
  }, newLocation);
  check(
    "browser mode can create a project through the same core code",
    created.status === 200 && created.body.name === "Liveness gate project",
    JSON.stringify(created).slice(0, 300),
  );

  const rowsNow = await api("/projects");
  const projectsNow = rowsNow.filter((r) => r.available && r.project).map((r) => r.project);
  check(
    "…and it lands on the served list as a real project with its own event",
    projectsNow.some((p) => p.name === "Liveness gate project" && p.counts.events === 1),
    JSON.stringify(projectsNow.map((p) => `${p.name}:${p.counts.events}`)),
  );

  // …and the open window notices it, without anybody navigating: the sidebar's project
  // count is read from the same context every screen refreshes from.
  const inSidebar = await waitFor(
    dash,
    (page) =>
      page.evaluate(
        (label) =>
          [...document.querySelectorAll(".nav-item")]
            .find((n) => n.textContent?.trim().startsWith(label))
            ?.querySelector(".nav-count")?.textContent ?? "",
        T("nav.projects"),
      ),
    (text) => text.trim() === String(projectsNow.length),
    "sidebar",
  );
  check(
    "…and the open window counts it without a navigation",
    !inSidebar.timedOut,
    `sidebar reads "${inSidebar.value}", vault has ${projectsNow.length} projects`,
  );
} catch (err) {
  failures += 1;
  console.error(`[check:live] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
  if (vaultCopy && !KEEP) rmSync(join(vaultCopy, ".."), { recursive: true, force: true });
  else if (vaultCopy) log(`temp copy kept at ${vaultCopy}`);
}

log(failures === 0 ? `clean: ${checks} checks passed` : `${failures} of ${checks} checks failed`);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
