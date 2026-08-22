#!/usr/bin/env node
/**
 * Prove the three list screens — bugs, work, notes — keep their state in the URL, and that
 * their search reaches the whole record.
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
import { t, useLocale } from "./i18n.mjs";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
/* Which language this run walks. The app ships in two and the URL contract is the same in
   both, so the gate is parameterised rather than pinned to the one it was written in:
   `--locale en` re-runs every check below against the English words. */
const LOCALE = value("--locale", process.env.SHOT_LOCALE || "ko");
const T = (key, ...args) => t(LOCALE, key, ...args);
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

  const rows = await (await fetch(`${ORIGIN}/project-api/projects`)).json();
  const projects = rows.filter((r) => r.available && r.project).map((r) => r.project);
  const slug = projects[0].id;
  log(`checking /p/${slug}`);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await useLocale(context, LOCALE);
  log(`language: ${LOCALE}`);
  const page = await context.newPage();

  // -- the bug board keeps tab + filters + query in the URL --------------------------------
  await page.goto(`${ORIGIN}/p/${slug}/bugs`, { waitUntil: "domcontentloaded" });
  await ready(page);
  check("board opens clean (no query string on the default view)", search(page) === "");

  // Tabs and chips by `data-value`: what they are called is the dictionary's business,
  // and this gate is about the URL.
  await page.locator('[role="tab"][data-value="all"]').click();
  await page.locator('.sev-chip[data-value="medium"]').click();
  await page.getByLabel(T("bugs.searchLabel")).fill("pg_stat_activity");
  await page.waitForFunction(() => document.querySelectorAll(".work-rows .work-row").length === 1);

  const params = new URLSearchParams(search(page));
  check(
    "every filter is in the URL",
    params.get("tab") === "all" &&
      params.get("severity") === "medium" &&
      params.get("q") === "pg_stat_activity",
    search(page),
  );

  const matched = await rowIds(page);
  check(
    "search reaches the record body, not just the row",
    matched.length === 1 && matched[0] === "BUG-0008",
    `matched ${JSON.stringify(matched)} — "pg_stat_activity" appears only in BUG-0008's report and thread`,
  );

  // -- open a record, come back, and the board is where it was ------------------------------
  const filtered = page.url();
  await page.locator(".work-rows .work-row").first().click();
  await ready(page);
  check("a row opens its record", /\/bugs\/BUG-0008$/.test(new URL(page.url()).pathname), page.url());

  await page.goBack();
  await ready(page);
  check("Back returns to the filtered board", page.url() === filtered, page.url());
  check("…with the rows it had", JSON.stringify(await rowIds(page)) === JSON.stringify(matched));
  check(
    "…and the search box still holding the query",
    (await page.getByLabel(T("bugs.searchLabel")).inputValue()) === "pg_stat_activity",
  );

  // -- the same URL in a window that has never seen the app --------------------------------
  const fresh = await context.newPage();
  await fresh.goto(filtered, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  check("a pasted link reproduces the view", JSON.stringify(await rowIds(fresh)) === JSON.stringify(matched));
  check(
    "…including the tab",
    (await fresh.locator('[role="tab"][data-value="all"]').getAttribute("aria-selected")) === "true",
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
    { screen: "bugs", query: "severity=urgent", control: T("filter.bySeverity"), reads: T("filter.allSeverities") },
    { screen: "bugs", query: "label=nonexistent-label", control: T("filter.byLabel"), reads: T("filter.allLabels") },
    { screen: "bugs", query: "assignee=nobody-at-all", control: T("filter.byAssignee"), reads: T("filter.allAssignees") },
    { screen: "bugs", query: "reporter=nobody-at-all", control: T("filter.byReporter"), reads: T("filter.allReporters") },
    { screen: "work", query: "agent=nobody-at-all", control: T("filter.byAgent"), reads: T("filter.allAgents") },
    { screen: "work", query: "tag=nonexistent-tag", control: T("filter.byTag"), reads: T("filter.allTags") },
    { screen: "notes", query: "agent=nobody-at-all", control: T("filter.byAgent"), reads: T("filter.allAgents") },
    { screen: "notes", query: "tag=nonexistent-tag", control: T("filter.byTag"), reads: T("filter.allTags") },
  ];

  /** How many rows each board shows with nothing filtered — the number to fall back to. */
  const baseline = {};
  for (const [screen, url] of [
    ["bugs", `${ORIGIN}/p/${slug}/bugs?tab=all`],
    ["work", `${ORIGIN}/p/${slug}/work`],
    ["notes", `${ORIGIN}/p/${slug}/notes`],
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
    /* The bug board's default tab is Unresolved, a subset, so its row count has no baseline
       to equal — `rows` names the baseline only where the default tab shows everything. */
    { screen: "bugs", query: "tab=zzz", tab: "unresolved" },
    { screen: "work", query: "status=banana", tab: "all", rows: "work" },
    { screen: "notes", query: "type=banana", tab: "all", rows: "notes" },
  ];
  for (const t of tabbed) {
    await fresh.goto(`${ORIGIN}/p/${slug}/${t.screen}?${t.query}`, { waitUntil: "domcontentloaded" });
    await ready(fresh);
    const selected =
      (await fresh
        .locator(`[role="tab"][data-value="${t.tab}"]`)
        .getAttribute("aria-selected")) === "true";
    const rows = await fresh.locator(".work-rows .work-row").count();
    check(
      `?${t.query} falls back to the default tab on /${t.screen}`,
      selected && (!t.rows || rows === baseline[t.rows]),
      `default tab ${selected ? "selected" : "NOT selected"}, ${rows} rows`,
    );
  }

  for (const d of dimensions) {
    // The bug board's default tab is Unresolved, so its unfiltered view is the All tab; the work
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
  const allBugs = await (await fetch(`${ORIGIN}/project-api/projects/${slug}/bugs`)).json();
  const allWork = await (await fetch(`${ORIGIN}/project-api/projects/${slug}/worklogs`)).json();
  const allNotes = await (await fetch(`${ORIGIN}/project-api/projects/${slug}/notes`)).json();
  const noteAgent = (n) => n?.updatedBy ?? n?.agent;
  const firstNoteTag = allNotes.flatMap((n) => n.tags)[0];
  const real = [
    { screen: "bugs", key: "label", value: allBugs.flatMap((b) => b.labels)[0], control: T("filter.byLabel") },
    {
      screen: "bugs",
      key: "reporter",
      value: allBugs[0]?.reporter,
      control: T("filter.byReporter"),
    },
    { screen: "work", key: "agent", value: allWork[0]?.agent, control: T("filter.byAgent") },
    { screen: "work", key: "tag", value: allWork.flatMap((w) => w.tags)[0], control: T("filter.byTag") },
    /* The notes entries carry the exact count the vault says the value covers, because
       `rows < baseline` is not checkable here: every live note is by one agent, so the
       honest claim is "choosing the value gives exactly the records that carry it" —
       which is stronger than the strict-subset check, not a relaxation of it. */
    /* The notes screen slices on the agent its rows *show* — `updatedBy ?? agent`, the one
       whose words are on the page (src/pages/NotesPage.tsx). Reading `agent` here instead
       asked for a value the dropdown does not offer as soon as any note has been rewritten
       by a second agent, and counted rows the app never claimed. Mirror the screen. */
    {
      screen: "notes",
      key: "agent",
      value: noteAgent(allNotes[0]),
      control: T("filter.byAgent"),
      rows: allNotes.filter((n) => noteAgent(n) === noteAgent(allNotes[0])).length,
    },
    {
      screen: "notes",
      key: "tag",
      value: firstNoteTag,
      control: T("filter.byTag"),
      rows: allNotes.filter((n) => n.tags.includes(firstNoteTag)).length,
    },
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
      rows > 0 &&
        (r.rows !== undefined ? rows === r.rows : rows < baseline[r.screen]) &&
        reads === r.value,
      `${rows} rows (unfiltered: ${baseline[r.screen]}${r.rows !== undefined ? `, expected ${r.rows}` : ""}), control reads "${reads}"`,
    );
  }

  // The dashboard's own filter is closed, and lives in the URL the same way.
  await fresh.goto(`${ORIGIN}/p/${slug}?range=decade`, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  check(
    "?range=decade falls back to All time on the dashboard",
    (await fresh.locator('[role="tab"][data-value="all"]').getAttribute("aria-selected")) === "true",
  );
  await fresh.goto(`${ORIGIN}/p/${slug}?range=7d`, { waitUntil: "domcontentloaded" });
  await ready(fresh);
  await fresh.waitForFunction(() =>
    [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
  );
  check(
    "…and a known range is obeyed",
    (await fresh.locator('[role="tab"][data-value="7d"]').getAttribute("aria-selected")) === "true",
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
  // "12 Aug" in English, "8월 12일" in Korean — a date either way, which is the claim.
  const DATE_TICK = LOCALE === "ko" ? /^\d{1,2}월 \d{1,2}일$/ : /^\d{1,2} [A-Z][a-z]{2}$/;
  check(
    "…and the axis names dates, not only clock times",
    ticks.some((tick) => DATE_TICK.test(tick.trim())),
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
  await page.locator('[role="tab"][data-value="done"]').click();
  await page.getByLabel(T("work.searchLabel")).fill("create_new");
  await page.waitForFunction(() => !!document.querySelector(".work-rows .work-row, .empty-title"));
  const workParams = new URLSearchParams(search(page));
  check(
    "work list keeps status + query in the URL",
    workParams.get("status") === "done" && workParams.get("q") === "create_new",
    search(page),
  );
  const workFiltered = page.url();
  const workRows = await rowIds(page);
  check("work search reaches What/Why/How and the updates", workRows.length > 0, `"create_new" is in WORK-0003 body only; matched ${JSON.stringify(workRows)}`);

  await page.locator(".work-rows .work-row").first().click();
  await ready(page);
  await page.goBack();
  await ready(page);
  check("Back returns to the filtered work list", page.url() === workFiltered, page.url());
  check("…with the rows it had", JSON.stringify(await rowIds(page)) === JSON.stringify(workRows));

  // -- and the notes list, the third record kind, does the same ------------------------------
  //
  // A note row has no WORK/BUG id: its identity is its kebab name, so the rows are read off
  // `.note-row-name`. The search claim is the work list's: the query reaches the body, not
  // just the row — "err_unsupported_esm" is in python-is-a-store-stub's body and appears in
  // no note's name, title or description.
  const noteNames = () => page.locator(".note-rows .note-row .note-row-name").allTextContents();
  await page.goto(`${ORIGIN}/p/${slug}/notes`, { waitUntil: "domcontentloaded" });
  await ready(page);
  check("notes list opens clean (no query string on the default view)", search(page) === "");
  await page.locator('[role="tab"][data-value="memory"]').click();
  await page.getByLabel(T("notes.searchLabel")).fill("err_unsupported_esm");
  await page.waitForFunction(() => !!document.querySelector(".work-rows .note-row, .empty-title"));
  const noteParams = new URLSearchParams(search(page));
  check(
    "notes list keeps type + query in the URL",
    noteParams.get("type") === "memory" && noteParams.get("q") === "err_unsupported_esm",
    search(page),
  );
  const notesMatched = await noteNames();
  check(
    "note search reaches the note body, not just the row",
    notesMatched.length === 1 && notesMatched[0] === "python-is-a-store-stub",
    `matched ${JSON.stringify(notesMatched)} — "err_unsupported_esm" is only in python-is-a-store-stub's body`,
  );
  const notesFiltered = page.url();
  await page.locator(".note-rows .note-row").first().click();
  await ready(page);
  check(
    "a note row opens its record",
    /\/notes\/python-is-a-store-stub$/.test(new URL(page.url()).pathname),
    page.url(),
  );
  await page.goBack();
  await ready(page);
  check("Back returns to the filtered notes list", page.url() === notesFiltered, page.url());
  check("…with the rows it had", JSON.stringify(await noteNames()) === JSON.stringify(notesMatched));
  check(
    "…and the search box still holding the query",
    (await page.getByLabel(T("notes.searchLabel")).inputValue()) === "err_unsupported_esm",
  );
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
