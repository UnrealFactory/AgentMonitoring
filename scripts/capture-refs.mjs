#!/usr/bin/env node
/**
 * Capture the quality bars from SPEC.md into progress/refs/ so critics compare against
 * the real thing instead of a memory of it.
 *
 *   npm run capture-refs
 *
 * Targets:
 *   vscode-pr-1 / vscode-pr-2   two well-written merged PRs on microsoft/vscode
 *   vscode-issues               the microsoft/vscode issue list
 *   grafana-play-1..3           public dashboards on play.grafana.org
 *   linear-*                    linear.app product UI
 *
 * This one talks to the public internet, so it is tolerant: a target that fails is
 * reported and skipped, and what was actually captured is recorded in
 * progress/refs/manifest.json, from which README.md is regenerated. Because the manifest
 * is merged rather than replaced, `--only <names>` can refresh one reference without
 * making the others look uncaptured. Not part of `npm run build` or the screenshot loop.
 *
 * Flags:
 *   --only a,b   capture just these targets (comma-separated names)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const refsDir = join(root, "progress", "refs");
const manifestPath = join(refsDir, "manifest.json");

const VIEWPORT = { width: 1600, height: 1000 };
const SCALE = 1.5;

const argv = process.argv.slice(2);
const onlyArg = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim()).filter(Boolean)) : null;

/** Look up a public dashboard on play.grafana.org by title. */
async function grafanaDashboard(query) {
  const res = await fetch(
    `https://play.grafana.org/api/search?type=dash-db&limit=5&query=${encodeURIComponent(query)}`,
    { signal: AbortSignal.timeout(20_000) }
  );
  if (!res.ok) throw new Error(`grafana search for "${query}" -> ${res.status}`);
  const hits = await res.json();
  if (!hits.length) throw new Error(`no public grafana dashboard matches "${query}"`);
  return `https://play.grafana.org${hits[0].url}?orgId=1`;
}

/**
 * Two merged VS Code PRs picked for substantive multi-paragraph descriptions — the bar
 * for the work-detail page is "a reader who never saw the work can reconstruct it".
 */
const TARGETS = [
  {
    name: "vscode-pr-1",
    url: "https://github.com/microsoft/vscode/pull/329633",
    note: 'Merged PR "agentHost: make the orchestrator own session enumeration and chat lifecycle" — an 11k-character description: summary, what each layer now owns, and how it was validated.',
    waitFor: ".gh-header-title, bdi.js-issue-title, h1",
    theme: "dark",
  },
  {
    name: "vscode-pr-2",
    url: "https://github.com/microsoft/vscode/pull/320785",
    note: 'Merged PR "Integrate Copilot Voice conversation engine" — module-by-module walkthrough with rationale and follow-up notes.',
    waitFor: ".gh-header-title, bdi.js-issue-title, h1",
    theme: "dark",
  },
  {
    name: "vscode-issues",
    url: "https://github.com/microsoft/vscode/issues",
    note: "Issue list — the bar for the bug board: dense rows, labels, assignees and state at a glance.",
    waitFor: "[aria-label='Issues'], .js-navigation-container, h1",
    theme: "dark",
  },
  {
    name: "grafana-play",
    // Dashboard uids on play.grafana.org change; look one up instead of hard-coding it.
    resolve: () => grafanaDashboard("Kubernetes Integration"),
    note: "Grafana Play dashboard — the bar for the status dashboard: stat tiles, time series, dense panel grid.",
    waitFor: "[data-testid='data-testid panel content'], .dashboard-container, canvas, svg",
    theme: "dark",
    settle: 6000,
  },
  {
    name: "grafana-play-2",
    resolve: () => grafanaDashboard("Loki NGINX Service Mesh"),
    note: "Grafana Play dashboard — stat tiles over live data, a geomap, a log table and time series below the fold: the density the status dashboard is measured against.",
    waitFor: "[data-testid='data-testid panel content'], .dashboard-container, canvas, svg",
    theme: "dark",
    settle: 6000,
  },
  {
    name: "grafana-play-3",
    // Panel-type demo rather than a service dashboard: it is backed by generated data, so
    // it renders the same charts on every run instead of an empty "No data" grid.
    resolve: () => grafanaDashboard("Time series graphs"),
    note: "Grafana Play \"Time series graphs\" — how Grafana draws a chart: axes, grid, legend and multi-series colour on live data. The reference for the dashboard's charts (work completed over time, bugs opened vs resolved).",
    waitFor: "[data-testid='data-testid panel content'], .dashboard-container, canvas, svg",
    theme: "dark",
    settle: 6000,
    // Past the explanatory panels at the top, onto the graphs themselves.
    scroll: 780,
  },
  {
    name: "linear-home",
    url: "https://linear.app/",
    note: "linear.app homepage — the visual bar for every screen.",
    waitFor: "main, header, h1",
    theme: "dark",
    settle: 2500,
    scroll: 0,
  },
  {
    name: "linear-product",
    url: "https://linear.app/",
    note: "linear.app homepage, scrolled to the product UI shots.",
    waitFor: "main, header, h1",
    theme: "dark",
    settle: 2500,
    scroll: 1000,
  },
  {
    name: "linear-issues",
    url: "https://linear.app/plan",
    note: "linear.app product page — list density, status pills, sidebar treatment.",
    waitFor: "main, header, h1",
    theme: "dark",
    settle: 2500,
    scroll: 600,
  },
  {
    name: "linear-features",
    url: "https://linear.app/features",
    note: "linear.app features page — more product UI at full width.",
    waitFor: "main, header, h1",
    theme: "dark",
    settle: 2500,
    scroll: 900,
  },
];

const log = (...m) => console.log("[refs]", ...m);

/**
 * Scroll `y` pixels down the thing that is actually scrollable. Grafana scrolls an inner
 * container, so `window.scrollTo` silently does nothing there; a wheel event over the
 * middle of the viewport scrolls whichever element owns the scrollbar.
 */
async function scrollDown(page, y) {
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.mouse.wheel(0, y);
}

mkdirSync(refsDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  colorScheme: "dark",
  reducedMotion: "reduce",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "en-US",
});

const captured = [];
const failures = [];

for (const target of TARGETS) {
  if (only && !only.has(target.name)) continue;
  const page = await context.newPage();
  try {
    if (target.resolve) target.url = await target.resolve();
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector(target.waitFor, { timeout: 30_000 }).catch(() => {});
    // Dismiss the cookie banners that otherwise sit across the middle of the shot.
    for (const label of ["Accept all", "Accept All", "Accept", "Got it", "I agree"]) {
      const button = page.getByRole("button", { name: label, exact: false }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 2000 }).catch(() => {});
        break;
      }
    }
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    if (target.settle) await page.waitForTimeout(target.settle);
    // Scroll after settling, not before: lazy panels and late images move the page under
    // us, and a shot of the wrong band of a dashboard is a useless reference.
    if (target.scroll) {
      await scrollDown(page, target.scroll);
      await page.waitForTimeout(1200);
    }

    const file = join(refsDir, `${target.name}.png`);
    await page.screenshot({ path: file });
    captured.push(target);
    log(`${target.name.padEnd(16)} ${target.url}`);
  } catch (err) {
    failures.push({ ...target, error: err.message });
    console.error(`[refs] FAILED ${target.name}: ${err.message}`);
  } finally {
    await page.close();
  }
}

await browser.close();

// The manifest is the record of what is actually on disk. Merging (rather than
// overwriting) is what lets `--only` refresh one reference without erasing the rest.
const previous = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")).refs ?? []
  : [];
const byName = new Map(previous.map((r) => [r.name, r]));
const now = new Date().toISOString();
for (const t of captured) {
  byName.set(t.name, { name: t.name, url: t.url, note: t.note, capturedAt: now });
}
// Keep declaration order, then anything left over from an older run.
const order = new Map(TARGETS.map((t, i) => [t.name, i]));
const refs = [...byName.values()]
  .filter((r) => existsSync(join(refsDir, `${r.name}.png`)))
  .sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99));

writeFileSync(manifestPath, `${JSON.stringify({ viewport: VIEWPORT, deviceScaleFactor: SCALE, refs }, null, 2)}\n`, "utf8");

const readme = `# Reference shots — the bars P0..P6 are judged against

Captured by \`npm run capture-refs\` (scripts/capture-refs.mjs) at 1600x1000 @1.5x, dark
colour scheme. These are the public pages named in SPEC.md's quality table; compare
\`progress/shots/*.png\` against them. \`manifest.json\` records the exact URL and capture
time of every file; re-shoot one with \`node scripts/capture-refs.mjs --only <name>\`.

| File | Bar | Source | Captured |
|---|---|---|---|
${refs
  .map((r) => `| \`${r.name}.png\` | ${r.note} | <${r.url}> | ${r.capturedAt.slice(0, 16)}Z |`)
  .join("\n")}
${
  failures.length
    ? `\n## Not captured on the last run (the file on disk, if any, is older)\n\n${failures
        .map((f) => `- \`${f.name}\` (<${f.url}>): ${f.error}`)
        .join("\n")}\n`
    : ""
}
## Which screen is judged against which reference

| App screen | Reference |
|---|---|
| \`shots/work-detail.png\` | \`refs/vscode-pr-1.png\`, \`refs/vscode-pr-2.png\`, \`refs/linear-*.png\` |
| \`shots/work-list.png\` | \`refs/vscode-issues.png\`, \`refs/linear-issues.png\` |
| \`shots/bugs.png\`, \`shots/bug-detail.png\` | \`refs/vscode-issues.png\`, \`refs/linear-*.png\` |
| \`shots/dashboard.png\` | \`refs/grafana-play.png\`, \`refs/grafana-play-2.png\`, \`refs/grafana-play-3.png\` |
| \`shots/projects.png\`, shell | \`refs/linear-home.png\`, \`refs/linear-product.png\` |
`;

writeFileSync(join(refsDir, "README.md"), readme, "utf8");
const attempted = captured.length + failures.length;
log(`${captured.length}/${attempted} captured → progress/refs (${refs.length} refs on disk)`);

process.exit(failures.length && failures.length === attempted ? 1 : 0);
