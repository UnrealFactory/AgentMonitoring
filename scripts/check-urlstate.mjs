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
  //
  // Every dimension, not a sample of two. The closed vocabularies (tab, status, severity)
  // were checked against a constant from the start; the open ones — label, assignee,
  // reporter, agent, tag — are only knowable from the project's own records, and until
  // this round they were passed through unchecked. `?agent=nova` pasted into a project
  // that has never heard of nova produced an empty screen under menus that all read
  // "All …": the board showing nothing, and nothing on it saying why.
  //
  // `q` is deliberately absent: free text has no vocabulary, and a search for a word this
  // project does not contain *should* come back empty.
  const dimensions = [
    { screen: "bugs", query: "severity=urgent", control: "Filter by severity", reads: "All severities" },
    { screen: "bugs", query: "label=nonexistent-label", control: "Filter by label", reads: "All labels" },
    { screen: "bugs", query: "assignee=nobody-at-all", control: "Filter by assignee", reads: "All assignees" },
    { screen: "bugs", query: "reporter=nobody-at-all", control: "Filter by reporter", reads: "All reporters" },
    { screen: "work", query: "agent=nobody-at-all", control: "Filter by agent", reads: "All agents" },
    { screen: "work", query: "tag=nonexistent-tag", control: "Filter by tag", reads: "All tags" },
  ];

  /** How many rows each board shows with nothing filtered — the number to fall back to. */
  const baseline = {};
  for (const [screen, url] of [
    ["bugs", `${ORIGIN}/p/${slug}/bugs?tab=all`],
    ["work", `${ORIGIN}/p/${slug}/work`],
  ]) {
    await fresh.goto(url, { waitUntil: "domcontentloaded" });
    await ready(fresh);
    baseline[screen] = await fresh.locator(".work-rows .work-row").count();
  }

  // The tab-shaped dimensions are their own shape of fallback: they choose a view rather
  // than filter one, so an unknown value lands on the default view, not on "everything".
  // Every one of them is checked, on both boards and on the dashboard, because "the two we
  // remembered" is how `?status=banana` came to be read back off the agent menu.
  const tabbed = [
    { screen: "bugs", query: "tab=zzz", tab: /^Open/, rows: "open" },
    { screen: "work", query: "status=banana", tab: /^All/, rows: "work" },
  ];
  for (const t of tabbed) {
    await fresh.goto(`${ORIGIN}/p/${slug}/${t.screen}?${t.query}`, { waitUntil: "domcontentloaded" });
    await ready(fresh);
    const selected =
      (await fresh.getByRole("tab", { name: t.tab }).getAttribute("aria-selected")) === "true";
    const rows = await fresh.locator(".work-rows .work-row").count();
    check(
      `?${t.query} falls back to the default tab on /${t.screen}`,
      selected && (t.rows !== "work" || rows === baseline.work),
      `default tab ${selected ? "selected" : "NOT selected"}, ${rows} rows`,
    );
  }

  for (const d of dimensions) {
    // The bug board's default tab is Open, so its unfiltered view is the All tab; the work
    // list's default already shows everything.
    const base = d.screen === "bugs" ? "tab=all&" : "";
    const url = `${ORIGIN}/p/${slug}/${d.screen}?${base}${d.query}`;
    await fresh.goto(url, { waitUntil: "domcontentloaded" });
    await ready(fresh);
    const rows = await fresh.locator(".work-rows .work-row").count();
    const button = fresh.getByLabel(d.control).first();
    const reads = (await button.innerText()).trim();
    const set = await button.evaluate((el) => el.classList.contains("is-set"));
    check(
      `?${d.query} falls back to unset on /${d.screen}`,
      rows === baseline[d.screen] && reads === d.reads && !set,
      `${rows} rows (unfiltered: ${baseline[d.screen]}), control reads "${reads}"${set ? " and looks set" : ""}`,
    );
  }

  // The other half of the same claim: a value the project *does* contain still filters.
  // Without this the check above passes on a board that ignores its URL entirely.
  const allBugs = await (await fetch(`${ORIGIN}/vault-api/projects/${slug}/bugs`)).json();
  const allWork = await (await fetch(`${ORIGIN}/vault-api/projects/${slug}/worklogs`)).json();
  const real = [
    { screen: "bugs", key: "label", value: allBugs.flatMap((b) => b.labels)[0], control: "Filter by label" },
    {
      screen: "bugs",
      key: "reporter",
      value: allBugs[0]?.reporter,
      control: "Filter by reporter",
    },
    { screen: "work", key: "agent", value: allWork[0]?.agent, control: "Filter by agent" },
    { screen: "work", key: "tag", value: allWork.flatMap((w) => w.tags)[0], control: "Filter by tag" },
  ];
  for (const r of real) {
    const base = r.screen === "bugs" ? "tab=all&" : "";
    await fresh.goto(`${ORIGIN}/p/${slug}/${r.screen}?${base}${r.key}=${encodeURIComponent(r.value)}`, {
      waitUntil: "domcontentloaded",
    });
    await ready(fresh);
    const rows = await fresh.locator(".work-rows .work-row").count();
    const reads = (await fresh.getByLabel(r.control).first().innerText()).trim();
    check(
      `?${r.key}=${r.value} does filter /${r.screen}`,
      rows > 0 && rows < baseline[r.screen] && reads === r.value,
      `${rows} rows (unfiltered: ${baseline[r.screen]}), control reads "${reads}"`,
    );
  }

  // The dashboard's own filter is closed, and lives in the URL the same way.
  await fresh.goto(`${ORIGIN}/p/${slug}?range=decade`, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  check(
    "?range=decade falls back to All time on the dashboard",
    (await fresh.getByRole("tab", { name: "All time" }).getAttribute("aria-selected")) === "true",
  );
  await fresh.goto(`${ORIGIN}/p/${slug}?range=7d`, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  await fresh.waitForFunction(() =>
    [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
  );
  check(
    "…and a known range is obeyed",
    (await fresh.getByRole("tab", { name: "7 days" }).getAttribute("aria-selected")) === "true",
  );

  // A range in the URL that changes nothing on the screen is the same defect as a filter
  // that is not in the URL at all. A cumulative burn-up ends at the project's lifetime
  // total whatever the range, so what has to move is the change *inside* the window, which
  // the legend prints beside each total.
  const deltas = await fresh.locator(".chart-legend .legend-delta").allTextContents();
  check(
    "?range=7d rescopes the charts, not just the sentence under the control",
    deltas.length >= 6 && deltas.some((d) => d !== "±0"),
    `legend deltas: ${JSON.stringify(deltas)}`,
  );

  // And the axis has to say which days it covers. Sub-daily buckets used to label a whole
  // week "12:00 · 00:00 · 12:00" — clock times with no date anywhere on the chart.
  const ticks = await fresh.locator(".chart-tick").allTextContents();
  check(
    "…and the axis names dates, not only clock times",
    ticks.some((t) => /^\d{1,2} [A-Z][a-z]{2}$/.test(t.trim())),
    `ticks: ${JSON.stringify(ticks.slice(0, 14))}`,
  );

  await fresh.goto(`${ORIGIN}/p/${slug}`, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  await fresh.waitForFunction(() =>
    [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
  );
  check(
    "…while All time prints totals with no change column (the total is the change)",
    (await fresh.locator(".chart-legend .legend-delta").count()) === 0,
  );
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
