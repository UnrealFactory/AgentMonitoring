#!/usr/bin/env node
/**
 * Prove the app is live: a record written to the vault reaches every open screen, without
 * a navigation, without a reload, and without losing the reader's place.
 *
 *   npm run check:live
 *   node scripts/check-live.mjs [--port 5199] [--wait 10]
 *
 * This is the gate for the P4 critic's biggest gap. Before it, every page fetched exactly
 * once — at navigation — so an open dashboard printed yesterday's numbers under a green
 * LIVE flag while the sidebar beside it, which the watcher did reload, printed today's. The
 * fix has to hold three things at once, and all three are checked here:
 *
 *   1. **It arrives.** A CLI write shows up on an open dashboard *and* an open record page
 *      within the deadline (10s by default), with nobody touching the browser.
 *   2. **It does not flash.** No page load, no skeleton, no scroll jump, same URL. A
 *      refresh that throws the page away is a reload with extra steps — the old browser-mode
 *      behaviour was literally `{type:"full-reload"}` down the HMR socket.
 *   3. **It is quiet when nothing happens.** Idling next to the vault must not re-fetch
 *      anything: a poll that refreshes on every tick is a poll that fights the reader.
 *
 * It runs against a **copy** of the vault in the system temp directory and mutates only
 * that copy — the live vault at ./vault is never written to by this script.
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Prove the app refreshes itself when the vault changes.

  npm run check:live
  node scripts/check-live.mjs [--port 5199] [--wait 10] [--keep]

  --port <n>   dev-server port (default 5199, its own so it never fights a screenshot run)
  --wait <s>   how long a change may take to reach an open screen (default 10)
  --keep       leave the temp vault copy behind for inspection

Never writes to ./vault: it copies the vault to the system temp directory first.`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.LIVE_PORT || 5199));
const WAIT_MS = Number(value("--wait", 10)) * 1000;
const ORIGIN = `http://localhost:${PORT}`;
const KEEP = args.includes("--keep");
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

/** Run the real CLI against the throwaway vault — the same writer an agent uses. */
function agentmon(vault, cliArgs) {
  return execFileSync(BIN, ["--vault", vault, ...cliArgs], { encoding: "utf8" });
}

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

/** Read a number off the dashboard by the panel it lives in, not by nth-child. */
const dashboardFacts = (page) =>
  page.evaluate(() => {
    const panel = (label) =>
      [...document.querySelectorAll(".now-panel")].find((p) =>
        p.querySelector(".now-label")?.textContent?.trim().startsWith(label),
      );
    const text = (el, sel) => el?.querySelector(sel)?.textContent?.trim() ?? null;
    return {
      openBugs: text(panel("Open bugs"), ".now-figure-value"),
      openBugsUnit: text(panel("Open bugs"), ".now-figure-unit"),
      lastDay: text(panel("Last 24 hours"), ".now-figure-value"),
      activity: document.querySelector("#activity .card-note")?.textContent?.trim() ?? null,
      sidebarBugs:
        [...document.querySelectorAll(".nav-item")]
          .find((n) => n.textContent?.trim().startsWith("Bugs"))
          ?.querySelector(".nav-count")
          ?.textContent?.trim() ?? null,
      feedTop: document.querySelector(".feed-summary")?.textContent?.trim() ?? null,
    };
  });

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

  // A copy, always. This gate writes records, and the vault in this repo is real history.
  const source = process.env.AGENTMON_VAULT || join(repoRoot, "vault");
  vaultCopy = mkdtempSync(join(tmpdir(), "agentmon-live-"));
  cpSync(source, vaultCopy, { recursive: true });
  log(`vault copy: ${vaultCopy} (source ${source} is never written to)`);

  log(`starting a dev server on ${ORIGIN} against the copy…`);
  server = startServer(PORT, { env: { AGENTMON_VAULT: vaultCopy } });
  await waitForServer(server, ORIGIN);

  const projects = await api("/projects");
  if (!projects.length) throw new Error("the vault copy has no projects");
  const project =
    projects.find((p) => p.counts.workInProgress > 0) ??
    [...projects].sort((a, b) => b.counts.events - a.counts.events)[0];
  const slug = project.slug;

  // The record the detail page will be open on: something already in flight, or one
  // started now — either way it exists *before* the pages open, so the change under test
  // is only the update that follows.
  let works = await api(`/projects/${slug}/worklogs`);
  let target = works.find((w) => w.status === "in_progress");
  if (!target) {
    agentmon(vaultCopy, [
      "work",
      "start",
      "-p",
      slug,
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
  log(`project: ${slug} · dashboard + ${target.id}`);

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  const dash = await context.newPage();
  const detail = await context.newPage();
  let loads = 0;
  let dataRequests = 0;
  for (const page of [dash, detail]) {
    page.on("load", () => (loads += 1));
    page.on("pageerror", (err) => {
      failures += 1;
      console.error(`  page error: ${err.message}`);
    });
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/vault-api/") && !url.includes("/vault-api/cursor")) dataRequests += 1;
    });
  }

  await dash.goto(`${ORIGIN}/p/${slug}`, { waitUntil: "domcontentloaded" });
  await ready(dash);
  await dash.waitForFunction(() =>
    [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
  );
  await detail.goto(`${ORIGIN}/p/${slug}/work/${target.id}`, { waitUntil: "domcontentloaded" });
  await ready(detail);

  // Scroll both pages well down: the reader is mid-page, which is the whole point.
  for (const page of [dash, detail]) {
    await page.evaluate(() => document.querySelector(".main")?.scrollTo(0, 420));
    await page.waitForTimeout(50);
  }

  await stamp(dash);
  await stamp(detail);
  const LANDMARK = { dash: "#activity", detail: ".record-title" };
  const before = {
    dash: await state(dash, LANDMARK.dash),
    detail: await state(detail, LANDMARK.detail),
  };
  const factsBefore = await dashboardFacts(dash);
  loads = 0;
  log(`baseline: open bugs ${factsBefore.openBugs}, ${factsBefore.activity}`);

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
    "-p",
    slug,
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
    "-p",
    slug,
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
    `open bugs read ${dashResult.value.openBugs} after ${dashResult.ms}ms, expected ${expectedBugs}`,
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
  };
  check("no page reloaded", loads === 0, `${loads} load events`);
  check(
    "the pages are the same instances (no remount, no navigation)",
    after.dash.probe === before.dash.probe && after.detail.probe === before.detail.probe,
    JSON.stringify({ before, after }),
  );
  check(
    "no skeleton flashed while refreshing",
    !after.dash.sawSkeleton && !after.detail.sawSkeleton,
    `dashboard ${after.dash.sawSkeleton}, record ${after.detail.sawSkeleton}`,
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
    "the reader kept their place on both screens",
    moved(before.dash, after.dash) <= ROW && moved(before.detail, after.detail) <= ROW,
    `landmark moved ${moved(before.dash, after.dash)}px on the dashboard (${LANDMARK.dash}) and ` +
      `${moved(before.detail, after.detail)}px on the record (${LANDMARK.detail}); ` +
      `scrollTop ${before.dash.scroll}→${after.dash.scroll} / ${before.detail.scroll}→${after.detail.scroll}`,
  );
  log(
    `dashboard: content above the landmark grew ${grew(before.dash, after.dash)}px ` +
      `(a new bug row, a new agent row), scrollTop moved ` +
      `${after.dash.scroll - before.dash.scroll}px, and the view moved ` +
      `${moved(before.dash, after.dash)}px`,
  );
  check(
    "neither screen scrolled back to the top",
    after.dash.scroll >= before.dash.scroll && after.detail.scroll >= before.detail.scroll,
    `dashboard ${before.dash.scroll}→${after.dash.scroll}, record ${before.detail.scroll}→${after.detail.scroll}`,
  );
  check(
    "the URL never moved",
    after.dash.url === before.dash.url && after.detail.url === before.detail.url,
    `${after.dash.url} / ${after.detail.url}`,
  );

  /* -- the self-contradiction the critic caught: sidebar vs page ------------- */

  const facts = await dashboardFacts(dash);
  check(
    "the sidebar and the dashboard agree about open bugs",
    facts.sidebarBugs === `${facts.openBugs} open`,
    `sidebar "${facts.sidebarBugs}" vs card "${facts.openBugs}"`,
  );
  const activityCount = Number(/^(\d+)/.exec(facts.activity ?? "")?.[1] ?? -1);
  const beforeCount = Number(/^(\d+)/.exec(factsBefore.activity ?? "")?.[1] ?? -1);
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
    "-p",
    slug,
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

  /* -- the browser-mode write path (the app's own create) -------------------- */

  const created = await dash.evaluate(async () => {
    const res = await fetch("/vault-api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "live-gate-project",
        name: "Liveness gate project",
        description: "Created through the app's own write endpoint by scripts/check-live.mjs.",
        tags: ["gate"],
        agent: "check-live",
      }),
    });
    return { status: res.status, body: await res.json() };
  });
  check(
    "browser mode can create a project through the same core code",
    created.status === 200 && created.body.slug === "live-gate-project",
    JSON.stringify(created).slice(0, 300),
  );

  const projectsNow = await api("/projects");
  check(
    "…and it lands in the vault as a real project with its own event",
    projectsNow.some((p) => p.slug === "live-gate-project" && p.counts.events === 1),
    JSON.stringify(projectsNow.map((p) => `${p.slug}:${p.counts.events}`)),
  );

  // …and the open window notices it, without anybody navigating: the sidebar's project
  // count is read from the same context every screen refreshes from.
  const inSidebar = await waitFor(
    dash,
    (page) =>
      page.evaluate(
        () =>
          [...document.querySelectorAll(".nav-item")]
            .find((n) => n.textContent?.trim().startsWith("Projects"))
            ?.querySelector(".nav-count")?.textContent ?? "",
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
  if (vaultCopy && !KEEP) rmSync(vaultCopy, { recursive: true, force: true });
  else if (vaultCopy) log(`temp vault kept at ${vaultCopy}`);
}

log(failures === 0 ? `clean: ${checks} checks passed` : `${failures} of ${checks} checks failed`);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
