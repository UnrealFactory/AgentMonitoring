#!/usr/bin/env node
/**
 * Read every screen in Korean and fail on any English the app itself wrote.
 *
 *   npm run check:i18n
 *   node scripts/check-i18n.mjs [--port 5173] [--url ORIGIN] [--locale ko]
 *
 * A translation is not done when the dictionary is full; it is done when nothing on screen
 * is still in the other language. Those two are different by exactly the strings somebody
 * forgot, and a forgotten string is invisible to `tsc`, to the clipping gate and to a
 * reviewer who is reading the Korean and skimming the rest. So this walks the rendered DOM —
 * every text node, plus every `title`, `aria-label` and `placeholder` — and reports Latin
 * words that are not accounted for.
 *
 * **What is allowed, and why.** The app translates its own chrome and never touches the
 * record. So two things are exempt:
 *
 *   1. **Author content**, by container: a record body, a title an agent wrote, a project
 *      description, the quoted sentence of a note. The renderer's job is to print those
 *      verbatim (P6), and this gate must never push anybody towards translating them.
 *   2. **Technical tokens**, by value: ids (WORK-0001), the app's own name, agent handles,
 *      project names and slugs, tags and labels out of the vault, CLI commands and flags,
 *      file names, and UTC. They are data, not language — a Korean screen prints
 *      `agentmon work start` exactly as an English one does.
 *
 * Everything else must be Korean. Runs against the live vault read-only.
 */
import { chromium } from "playwright";
import { ensureServer, stopServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--help") || flag("-h")) {
  console.log(`Fail on English the app itself prints, on a Korean screen.

  npm run check:i18n
  node scripts/check-i18n.mjs --locale ko

Options:
  --locale <ko>      the language to read the screens in (default ko)
  --port <n>         dev-server port to boot on / check against (default 5173)
  --url <origin>     check an already-running server instead of booting one
  --verbose          list every screen walked, not only the findings`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const LOCALE = value("--locale", "ko");
const VERBOSE = flag("--verbose");
const log = (...m) => console.log("[check-i18n]", ...m);

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET /vault-api${path} -> ${res.status}`);
  return res.json();
};

/**
 * Containers whose text belongs to whoever wrote the record, not to the app.
 *
 * Deliberately generous: the cost of exempting one more author-owned box is nothing, and
 * the cost of *not* exempting it is a gate that tells the next builder to translate a bug
 * report.
 */
const AUTHOR = [
  ".prose", // every rendered record body: What/Why/How, notes, comments, resolutions
  ".record-title", // the title an agent gave the record
  ".work-row-title",
  ".now-row-title",
  ".rel-title",
  ".palette-label", // a record's title in the palette
  ".feed-summary", // the first clause of what the agent wrote
  ".now-quote-line", // a sentence quoted verbatim out of a note
  ".project-desc",
  ".dashboard .page-title", // the project's own name…
  ".dashboard .page-sub", // …and its description
  ".res-part-title", // the labels the author bolded inside a resolution
  ".res-jump-text",
  ".res-jump-link", // …including the full label, which rides on the chip's tooltip
  ".contents-link.is-sub", // …and the same labels in the contents rail
  ".now-ask", // the tooltip is the sentence the agent wrote, quoted
  ".empty-code", // a command line the reader is meant to run
  ".command-text",
  ".vault-bar-path",
  ".file-item",
  ".agent-name",
  ".agent-avatar",
  ".tag",
  ".mono", // ids, slugs, routes, paths
  "code",
  "pre",
  "kbd",
  ".sr-only", // the chart's spoken summary is assembled from labels already checked
];

/** Values that are data rather than language, and are the same in every locale. */
const TOKENS = [
  /\b(WORK|BUG)-\d+\b/g,
  /\bAgentMonitoring\b/g,
  /\bUTC\b/g,
  /\bCtrl\b/g,
  /\bagentmon\b/g,
  /\bvault\.json\b/g,
  /\bevents\.jsonl\b/g,
  /\bprojects\/[^\s]*/g,
  /\bAGENTMON_VAULT\b/g,
  /--[a-z-]+/g,
  /\bv\d+\b/g,
  /##\s*\w+/g,
  /\bEnglish\b/g, // the language toggle names the other language in its own language
  /\bID\b/g, // written in Latin in Korean product UIs, like URL and CLI
  /\brefs\b/g, // the frontmatter key a record's cross-references live under (SPEC)
  /[A-Za-z]:[\\/][^\s"]*/g, // a Windows path, as the vault bar and its tooltip print it
  /(?:^|\s)[\\/][\w./\\-]+/g, // a route or a POSIX path
];

/** Two or more Latin letters in a row, once the allowed tokens are taken out. */
const LATIN = /[A-Za-z]{2,}/g;

let failures = 0;
let checked = 0;

/**
 * Runs in the page. Returns every English-looking string the app printed, with where it is.
 */
const PROBE = (authorSelectors) => {
  const inAuthor = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!el && authorSelectors.some((sel) => el.closest(sel));
  };
  const where = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return "?";
    const parts = [];
    for (let cur = el; cur && parts.length < 3; cur = cur.parentElement) {
      const cls =
        typeof cur.className === "string" && cur.className.trim()
          ? `.${cur.className.trim().split(/\s+/)[0]}`
          : "";
      parts.unshift(`${cur.tagName.toLowerCase()}${cls}`);
    }
    return parts.join(" > ");
  };

  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || "").trim();
    if (!text || inAuthor(node)) continue;
    found.push({ kind: "text", text, at: where(node) });
  }
  for (const el of document.querySelectorAll("[title], [aria-label], [placeholder]")) {
    if (inAuthor(el)) continue;
    for (const attr of ["title", "aria-label", "placeholder"]) {
      const text = (el.getAttribute(attr) || "").trim();
      if (text) found.push({ kind: attr, text, at: where(el) });
    }
  }
  return found;
};

/** What is left of a string once every allowed token is removed. */
const residue = (text) => {
  let rest = text;
  for (const re of TOKENS) rest = rest.replace(re, " ");
  return rest;
};

const englishIn = (text) => {
  const words = residue(text).match(LATIN);
  return words ? [...new Set(words)] : null;
};

let browser = null;
let server = null;

try {
  ({ server } = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  }));

  const projects = await api("/projects");
  /* Everything the vault itself names — agent handles, project names and slugs, tags and
     labels — is data the app prints as written, in any language. Read from the vault rather
     than listed here, so a new agent name is not a new gate failure. */
  const vaultWords = new Set();
  for (const p of projects) {
    vaultWords.add(p.name);
    vaultWords.add(p.slug);
    for (const tag of p.tags ?? []) vaultWords.add(tag);
  }
  const screens = [];
  for (const p of projects) {
    const works = await api(`/projects/${p.slug}/worklogs`);
    const bugs = await api(`/projects/${p.slug}/bugs`);
    for (const w of works) {
      vaultWords.add(w.agent);
      for (const tag of w.tags ?? []) vaultWords.add(tag);
      for (const f of w.files ?? []) vaultWords.add(f);
    }
    for (const b of bugs) {
      vaultWords.add(b.reporter);
      if (b.assignee) vaultWords.add(b.assignee);
      for (const l of b.labels ?? []) vaultWords.add(l);
    }
    /* One of each screen per project, and the *last* record of each kind as well as the
       first: an in-progress work log draws a different strip from a finished one. */
    const work = works.find((w) => w.status === "done") ?? works[0];
    const running = works.find((w) => w.status === "in_progress");
    const bug = bugs.find((b) => b.status === "resolved") ?? bugs[0];
    const open = bugs.find((b) => b.status === "open" || b.status === "in_progress");
    screens.push(
      { name: `dashboard ${p.slug}`, path: `/p/${p.slug}`, wait: ".now-strip .now-hero-value" },
      { name: `dashboard ${p.slug} 7d`, path: `/p/${p.slug}?range=7d`, wait: ".chart-legend" },
      { name: `work ${p.slug}`, path: `/p/${p.slug}/work`, wait: ".work-rows .work-row" },
      { name: `bugs ${p.slug}`, path: `/p/${p.slug}/bugs?tab=all`, wait: ".work-rows .bug-row" },
    );
    if (work) {
      screens.push({
        name: `work detail ${work.id}`,
        path: `/p/${p.slug}/work/${work.id}`,
        wait: ".record-title",
      });
    }
    if (running) {
      screens.push({
        name: `work detail ${running.id} (in progress)`,
        path: `/p/${p.slug}/work/${running.id}`,
        wait: ".record-title",
      });
    }
    if (bug) {
      screens.push({
        name: `bug detail ${bug.id}`,
        path: `/p/${p.slug}/bugs/${bug.id}`,
        wait: ".record-title",
      });
    }
    if (open) {
      screens.push({
        name: `bug detail ${open.id} (unresolved)`,
        path: `/p/${p.slug}/bugs/${open.id}`,
        wait: ".record-title",
      });
    }
  }
  screens.push(
    { name: "projects", path: "/projects", wait: ".project-row" },
    { name: "not found", path: "/nowhere-at-all", wait: ".page-title" },
    {
      name: "command palette",
      path: `/p/${projects[0].slug}`,
      wait: ".palette-item",
      prepare: async (page) => {
        await page.waitForSelector(".page-title", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.keyboard.press("Control+K");
      },
    },
    {
      name: "record menu",
      path: `/p/${projects[0].slug}/work`,
      wait: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".work-row", { state: "visible" });
        await page.locator(".work-row").first().click({ button: "right" });
      },
    },
    {
      name: "project menu",
      path: "/projects",
      wait: ".ctx-menu",
      prepare: async (page) => {
        await page.waitForSelector(".nav-sub", { state: "visible" });
        await page.locator(".nav-sub").first().click({ button: "right" });
      },
    },
    {
      name: "filter menu",
      path: `/p/${projects[0].slug}/bugs?tab=all`,
      wait: ".select-menu",
      prepare: async (page) => {
        await page.waitForSelector(".select-button", { state: "visible" });
        await page
          .locator(`button.select-button[aria-label="${t(LOCALE, "filter.bySeverity")}"]`)
          .click();
      },
    },
  );

  /* An agent handle or a tag is a Latin word the app is right to print. They are matched as
     whole words so `nova` does not also excuse the word "innovation". */
  const vaultToken = new RegExp(
    `\\b(${[...vaultWords]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})\\b`,
    "g",
  );

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await useLocale(page, LOCALE);
  log(`${screens.length} screens · language ${LOCALE}`);

  const findings = [];
  for (const screen of screens) {
    await page.goto(`${ORIGIN}${screen.path}`, { waitUntil: "domcontentloaded" });
    if (screen.prepare) await screen.prepare(page);
    await page.waitForSelector(screen.wait, { state: "visible", timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector(".skeleton"));
    const printed = await page.evaluate(PROBE, AUTHOR);
    checked += 1;
    let bad = 0;
    for (const item of printed) {
      const words = englishIn(item.text.replace(vaultToken, " "));
      if (!words) continue;
      bad += 1;
      findings.push({ screen: screen.name, ...item, words });
    }
    if (VERBOSE || bad) log(`${screen.name}: ${printed.length} strings, ${bad} English`);
  }

  if (findings.length) {
    failures = findings.length;
    console.error(`\n  ${findings.length} English string(s) printed by the app in ${LOCALE}:\n`);
    for (const f of findings.slice(0, 40)) {
      console.error(`  FAIL  [${f.screen}] ${f.kind} at ${f.at}`);
      console.error(`        “${f.text.slice(0, 140)}”  → ${f.words.join(", ")}`);
    }
    if (findings.length > 40) console.error(`  … and ${findings.length - 40} more`);
  }
} catch (err) {
  failures += 1;
  console.error(`[check-i18n] FAILED: ${err.stack ?? err.message}`);
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}

log(
  failures === 0
    ? `clean: ${checked} screens, every word the app printed is ${LOCALE}`
    : `${failures} English string(s) on ${checked} screens`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
