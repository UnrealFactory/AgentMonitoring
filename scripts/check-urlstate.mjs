#!/usr/bin/env node
/**
 * Prove the two triage screens keep their state in the URL, and that their search reaches
 * the whole record.
 *
 *   npm run check:urlstate
 *   node scripts/check-urlstate.mjs [--port 5173] [--url ORIGIN]
 *
 * These are behaviours a screenshot cannot show and a reader only notices when they are
 * missing: filter the board, open a record, press Back — and land on the board you left,
 * not on the default view. Paste that URL into a fresh window and get the same screen.
 * Type a phrase you remember from a bug's repro steps (`pg_stat_activity`, which appears
 * nowhere in any title) and find the bug.
 *
 * Boots its own dev server when none is listening. A builder's tool, not part of the app.
 */
import { chromium } from "playwright";
import { ensureServer, stopServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const log = (...m) => console.log("[check-urlstate]", ...m);

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
};
const rowIds = (page) => page.locator(".work-rows .work-row .work-row-id").allTextContents();
const search = (page) => new URL(page.url()).search;

let browser = null;
let server = null;

try {
  ({ server } = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  }));

  const projects = await (await fetch(`${ORIGIN}/vault-api/projects`)).json();
  const slug = projects.find((p) => p.slug === "relay")?.slug ?? projects[0].slug;
  log(`checking /p/${slug}`);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });

  // -- the bug board keeps tab + filters + query in the URL --------------------------------
  await page.goto(`${ORIGIN}/p/${slug}/bugs`, { waitUntil: "domcontentloaded" });
  await ready(page);
  check("board opens clean (no query string on the default view)", search(page) === "");

  await page.getByRole("tab", { name: /^All/ }).click();
  await page.locator(".sev-chip-label", { hasText: "Critical" }).click();
  await page.getByLabel("Search bugs").fill("pg_stat_activity");
  await page.waitForFunction(() => document.querySelectorAll(".work-rows .work-row").length === 1);

  const params = new URLSearchParams(search(page));
  check(
    "every filter is in the URL",
    params.get("tab") === "all" &&
      params.get("severity") === "critical" &&
      params.get("q") === "pg_stat_activity",
    search(page),
  );

  const matched = await rowIds(page);
  check(
    "search reaches the record body, not just the row",
    matched.length === 1 && matched[0] === "BUG-0004",
    `matched ${JSON.stringify(matched)} — "pg_stat_activity" appears only in BUG-0004's report and thread`,
  );

  // -- open a record, come back, and the board is where it was ------------------------------
  const filtered = page.url();
  await page.locator(".work-rows .work-row").first().click();
  await ready(page);
  check("a row opens its record", /\/bugs\/BUG-0004$/.test(new URL(page.url()).pathname), page.url());

  await page.goBack();
  await ready(page);
  check("Back returns to the filtered board", page.url() === filtered, page.url());
  check("…with the rows it had", JSON.stringify(await rowIds(page)) === JSON.stringify(matched));
  check(
    "…and the search box still holding the query",
    (await page.getByLabel("Search bugs").inputValue()) === "pg_stat_activity",
  );

  // -- the same URL in a window that has never seen the app --------------------------------
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await fresh.goto(filtered, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  check("a pasted link reproduces the view", JSON.stringify(await rowIds(fresh)) === JSON.stringify(matched));
  check(
    "…including the tab",
    (await fresh.getByRole("tab", { name: /^All/ }).getAttribute("aria-selected")) === "true",
  );

  // -- nonsense in the URL is ignored rather than obeyed ------------------------------------
  await fresh.goto(`${ORIGIN}/p/${slug}/bugs?tab=banana&severity=urgent`, {
    waitUntil: "domcontentloaded",
  });
  await ready(fresh);
  const banana = await fresh.locator(".work-rows .work-row").count();
  check("an unknown filter value falls back to the default", banana > 0, `${banana} rows`);
  await fresh.close();

  // -- the work list does the same -----------------------------------------------------------
  await page.goto(`${ORIGIN}/p/${slug}/work`, { waitUntil: "domcontentloaded" });
  await ready(page);
  await page.getByRole("tab", { name: /^Done/ }).click();
  await page.getByLabel("Search work logs").fill("sqlx");
  await page.waitForFunction(() => !!document.querySelector(".work-rows .work-row, .empty-title"));
  const workParams = new URLSearchParams(search(page));
  check(
    "work list keeps status + query in the URL",
    workParams.get("status") === "done" && workParams.get("q") === "sqlx",
    search(page),
  );
  const workFiltered = page.url();
  const workRows = await rowIds(page);
  check("work search reaches What/Why/How and the updates", workRows.length > 0, `"sqlx" is in WORK-0003 body only; matched ${JSON.stringify(workRows)}`);

  await page.locator(".work-rows .work-row").first().click();
  await ready(page);
  await page.goBack();
  await ready(page);
  check("Back returns to the filtered work list", page.url() === workFiltered, page.url());
  check("…with the rows it had", JSON.stringify(await rowIds(page)) === JSON.stringify(workRows));
} catch (err) {
  failures += 1;
  console.error(`[check-urlstate] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}

log(failures === 0 ? `clean: ${checks} checks passed` : `${failures} of ${checks} checks failed`);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
