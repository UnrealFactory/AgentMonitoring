#!/usr/bin/env node
/**
 * Read every screen in one language and fail on any word the app itself wrote in the other.
 *
 *   npm run check:i18n                          both languages, in turn
 *   node scripts/check-i18n.mjs [--port 5173] [--url ORIGIN] [--locale ko|en]
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
 * Neither exemption is allowed to swallow the app's own words: {@link CHROME} names the
 * places where the app speaks *inside* an author container, and they are checked.
 *
 * **What it walks.** Every record in the vault, not a sample — and the screens a reader
 * reaches by being wrong: a stale record link, a project slug nobody owns, and a window
 * pointed at a folder with no vault.json. Those are the app's error surface, they are five
 * of the six screens, and for a whole round nothing looked at them.
 *
 * Everything else must be Korean — and `--locale en` is the same walk with the alphabets
 * swapped, because a Korean string typed into a component is just as invisible to `tsc` as
 * an English one, and the app ships in two languages. Runs against the live vault read-only.
 */
import { join } from "node:path";
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
  console.log(`Fail on a word the app prints in the language the screen is not in.

  npm run check:i18n                 ko then en
  node scripts/check-i18n.mjs --locale en

Options:
  --locale <ko|en>   the language to read the screens in; the gate then looks for the
                     other one — English on a Korean screen, Hangul on an English one
                     (default ko)
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
  ".section-title.is-author", // a `## …` heading the agent wrote, above their own section
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

/**
 * The app's own words *inside* an author container — checked despite the list above.
 *
 * The exemptions are by container, and a container can hold both: a rendered record body is
 * the author's, but an id in it that names nothing is drawn as a chip whose tooltip is the
 * app talking ("no work log or bug with this id in this project"). The live vault has one —
 * WORK-0011 cites BUG-9999 — and it sat in English through a whole round because `.prose`
 * excused it (P8 critic). A chip whose record *is* there keeps the author's title in its
 * tooltip and stays exempt.
 */
const CHROME = [".ref-inline.is-unknown"];

/**
 * Where a language names itself, whichever language the window is in.
 *
 * The picker's two segments are 한국어 and English, each written in its own language, which
 * is the one rule every language picker keeps: a reader who landed in the wrong one has to
 * be able to read their way out. So it is the one place Hangul is allowed on an English
 * screen, and the tooltip on each segment carries the same name.
 */
const OTHER_TONGUE = [".locale-toggle"];

/** Values that are data rather than language, and are the same in every locale. */
const TOKENS = [
  /\b(WORK|BUG)-(?:\d+|N{4})\b/g, // an id — and the shape of one, which a bad address is told
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
  /\bCLI\b/g, // …and CLI itself, which is what the onboarding calls the thing agents run
  /\brefs\b/g, // the frontmatter key a record's cross-references live under (SPEC)
  /[A-Za-z]:[\\/][^\s"]*/g, // a Windows path, as the vault bar and its tooltip print it
  /(?:^|\s)[\\/][\w./\\-]+/g, // a route or a POSIX path
];

/** Two or more Latin letters in a row, once the allowed tokens are taken out. */
const LATIN = /[A-Za-z]{2,}/g;

/**
 * …and the mirror of it: Hangul on an English screen.
 *
 * The app ships in two languages, and only one of them was ever gated. A Korean word typed
 * straight into a component — the easy mistake to make in this repository now — is invisible
 * to `tsc` and to the Korean run of this gate, which is looking for the opposite alphabet.
 * `--locale en` looks for this instead; everything else about the walk is identical.
 */
const HANGUL = /[가-힣]+/g;

let failures = 0;
let checked = 0;

/**
 * Runs in the page. Returns every English-looking string the app printed, with where it is.
 */
const PROBE = ({ exemptSelectors, chromeSelectors }) => {
  const isExempt = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    if (chromeSelectors.some((sel) => el.closest(sel))) return false;
    return exemptSelectors.some((sel) => el.closest(sel));
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
    if (!text || isExempt(node)) continue;
    found.push({ kind: "text", text, at: where(node) });
  }
  for (const el of document.querySelectorAll("[title], [aria-label], [placeholder]")) {
    if (isExempt(el)) continue;
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

/** The words in `text` that belong to the language this screen is *not* in. */
const foreignIn = (text) => {
  const words = LOCALE === "en" ? text.match(HANGUL) : residue(text).match(LATIN);
  return words ? [...new Set(words)] : null;
};

/** What the findings are called, in the run's own terms. */
const OTHER = LOCALE === "en" ? "Korean" : "English";

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
  /** A record of each kind in the first project, for the screens that toggle in place. */
  let firstWork = null;
  let firstBug = null;
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
    if (p.slug === projects[0].slug) {
      firstWork = works[0]?.id ?? null;
      firstBug = bugs[0]?.id ?? null;
    }
    screens.push(
      { name: `dashboard ${p.slug}`, path: `/p/${p.slug}`, wait: ".now-strip .now-hero-value" },
      { name: `dashboard ${p.slug} 7d`, path: `/p/${p.slug}?range=7d`, wait: ".chart-legend" },
      { name: `work ${p.slug}`, path: `/p/${p.slug}/work`, wait: ".work-rows .work-row" },
      { name: `bugs ${p.slug}`, path: `/p/${p.slug}/bugs?tab=all`, wait: ".work-rows .bug-row" },
    );
    /* Every record, not a sample of four.
     *
     * It used to open one done and one in-progress work log per project, which is enough to
     * see each *state* drawn and not enough to see what one record can carry that its
     * neighbours do not: WORK-0011 is the only record in this vault that names an id nobody
     * wrote (BUG-9999), so the chip the app draws for a stale reference — and the English
     * that sat in its tooltip for a round — was never on a screen this gate looked at
     * (P8 critic). Sixty-odd more page loads is a minute; a class of string this gate cannot
     * see is a round. */
    for (const w of works) {
      screens.push({
        name: `work detail ${w.id}`,
        path: `/p/${p.slug}/work/${w.id}`,
        wait: ".record-title",
      });
    }
    for (const b of bugs) {
      screens.push({
        name: `bug detail ${b.id}`,
        path: `/p/${p.slug}/bugs/${b.id}`,
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

  /* ---- and the same screens reached by pressing the toggle ------------------
   *
   * Landing in a language is not the same event as changing to it. A value that carries
   * words and is cached on anything but the language survives the switch, and the reader
   * who tried the control is the one who meets it: the dashboard repainted around a
   * 24-hour line still reading "started 16 · done 16 · notes 30 · 에이전트 8명", and a
   * record's contents rail stayed in the language it was built in (P9 round 1 critic).
   * Nothing in a reload can show that, so these three arrive in the *other* language and
   * click their way into this one. */
  const other = LOCALE === "ko" ? "en" : "ko";
  const switchTo = async (page, waitFor) => {
    await page.waitForSelector(waitFor, { state: "visible", timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector(".skeleton"));
    await page.locator(`.locale-option[data-value="${LOCALE}"]`).click();
    await page.waitForFunction(
      (want) => document.documentElement.lang === want,
      LOCALE,
      { timeout: 5_000 },
    );
  };
  for (const [name, path, wait] of [
    ["dashboard", `/p/${projects[0].slug}`, ".now-strip .now-hero-value"],
    ...(firstWork ? [["work detail", `/p/${projects[0].slug}/work/${firstWork}`, ".record-title"]] : []),
    ...(firstBug ? [["bug detail", `/p/${projects[0].slug}/bugs/${firstBug}`, ".record-title"]] : []),
  ]) {
    screens.push({
      name: `${name}, switched to ${LOCALE} in place`,
      path: `${path}${path.includes("?") ? "&" : "?"}lang=${other}`,
      wait,
      prepare: (page) => switchTo(page, wait),
    });
  }

  /* ---- the screens a reader reaches by being wrong -------------------------
   *
   * Everything above is the app working. The app failing is a screen too — five of them
   * take their headline from failureTitle() in src/lib/api.ts, which returned English
   * literals for a whole round while their Korean twins sat in the dictionary unused, and
   * this gate could not see it because it never drove a 404 or an unreadable vault
   * (P8 critic). It does now: a stale record link, a project slug nobody owns, and a
   * window pointed at a folder that is not a vault.
   *
   * `?vault=` is read once and kept in sessionStorage (src/lib/api.ts), so the unreadable
   * ones come last and get their own browser context — otherwise every screen after them
   * would be looking at the same broken folder. */
  const slug = projects[0].slug;
  /* The slug this gate types into the address bar is data on the screen that answers it,
     exactly as a real slug is — the app prints back what it was asked for. */
  const NO_SUCH_PROJECT = "does-not-exist";
  vaultWords.add(NO_SUCH_PROJECT);
  /* Likewise an id that is not one: the app prints back the address it was given. */
  const BAD_ID = "NOTANID";
  vaultWords.add(BAD_ID);
  screens.push(
    { name: "work detail, no such record", path: `/p/${slug}/work/WORK-9999`, wait: ".error-title" },
    { name: "bug detail, no such record", path: `/p/${slug}/bugs/BUG-9999`, wait: ".error-title" },
    /* An address that could never have been a record — a different headline from the two
       above, and a sentence the desktop backend words differently again (check-errors.mjs). */
    { name: "work detail, unusable id", path: `/p/${slug}/work/${BAD_ID}`, wait: ".error-title" },
    { name: "dashboard, no such project", path: `/p/${NO_SUCH_PROJECT}`, wait: ".error-title" },
    { name: "work list, no such project", path: `/p/${NO_SUCH_PROJECT}/work`, wait: ".error-title" },
    { name: "bug board, no such project", path: `/p/${NO_SUCH_PROJECT}/bugs`, wait: ".error-title" },
  );

  /* A real directory with no vault.json in it: this repo's own docs/. The message names it,
     so it has to be a path that exists rather than a placeholder. */
  const noVault = `?vault=${encodeURIComponent(join(process.cwd(), "docs"))}`;
  const unreadable = [
    { name: "dashboard, unreadable vault", path: `/p/${slug}${noVault}`, wait: ".error-title" },
    { name: "work list, unreadable vault", path: `/p/${slug}/work${noVault}`, wait: ".error-title" },
    { name: "bug board, unreadable vault", path: `/p/${slug}/bugs${noVault}`, wait: ".error-title" },
    {
      name: "work detail, unreadable vault",
      path: `/p/${slug}/work/WORK-0001${noVault}`,
      wait: ".error-title",
    },
    {
      name: "bug detail, unreadable vault",
      path: `/p/${slug}/bugs/BUG-0001${noVault}`,
      wait: ".error-title",
    },
    { name: "projects, unreadable vault", path: `/projects${noVault}`, wait: ".error-title" },
  ];

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
  const VIEW = {
    viewport: { width: 1600, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  };
  log(`${screens.length + unreadable.length} screens · language ${LOCALE}`);

  const findings = [];
  const walk = async (page, list) => {
    for (const screen of list) {
      await page.goto(`${ORIGIN}${screen.path}`, { waitUntil: "domcontentloaded" });
      if (screen.prepare) await screen.prepare(page);
      await page.waitForSelector(screen.wait, { state: "visible", timeout: 15_000 });
      await page.waitForFunction(() => !document.querySelector(".skeleton"));
      const printed = await page.evaluate(PROBE, {
        exemptSelectors: [...AUTHOR, ...OTHER_TONGUE],
        chromeSelectors: CHROME,
      });
      checked += 1;
      let bad = 0;
      for (const item of printed) {
        const words = foreignIn(item.text.replace(vaultToken, " "));
        if (!words) continue;
        bad += 1;
        findings.push({ screen: screen.name, ...item, words });
      }
      if (VERBOSE || bad) log(`${screen.name}: ${printed.length} strings, ${bad} ${OTHER}`);
    }
  };

  const page = await browser.newPage(VIEW);
  await useLocale(page, LOCALE);
  await walk(page, screens);

  // Its own session, because `?vault=` sticks to the one it is opened in.
  const broken = await browser.newContext(VIEW);
  await useLocale(broken, LOCALE);
  await walk(await broken.newPage(), unreadable);
  await broken.close();

  if (findings.length) {
    failures = findings.length;
    console.error(`\n  ${findings.length} ${OTHER} string(s) printed by the app in ${LOCALE}:\n`);
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
    : `${failures} ${OTHER} string(s) on ${checked} screens`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
