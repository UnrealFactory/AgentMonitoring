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
 * **At two widths**, because a screen at 1600px is not the app: the boards reflow, and
 * everything a container query does at 960px — the floor tauri.conf.json sets — was
 * invisible here for a round.
 *
 * **And it asks a second question.** The walk above asks which *language* a string is in.
 * {@link VOCABULARIES} asks whether it is a **word**: for the three vocabularies the app
 * itself authors, the pill on screen must equal a dictionary value exactly. That is the
 * check that would have caught a severity column reading 낮 instead of 낮음.
 *
 * **And a third: is the word still whole where the line ends?** {@link COUNTERS} — the
 * word-integrity sweep at the bottom of this file — reads the Korean screens at nine widths
 * and fails when a line break falls between a number and the 의존명사 counting it. Two
 * viewports cannot see that: every width where the vault bar printed “2026년 8월 18” with a
 * lone “일” under it lay strictly between the 1600 and 960 this gate used to read, and the
 * clipping gate walked 1440 and passed, because a syllable that wrapped onto its own line is
 * not clipped and nothing here asked whether it was still attached to its number (P9 round 4
 * critic). A break is not overflow, so it needs its own question and its own widths.
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

/**
 * The widths the word-integrity sweep reads, and why each one is in the list.
 *
 * 960 is the floor tauri.conf.json sets and 1600 the roomy end this gate already read; the
 * seven between them are there because the defect that named this sweep lived *only* between
 * them. 1190 and 1200 are where the vault bar broke “2026년 8” ⏎ “월 18일”, 1360 and 1440 the
 * ends of the band where it broke “…18” ⏎ “일”, 1280 the client area of the real desktop
 * window the round-4 critic photographed, and 1060 and 1520 are ordinary widths between.
 */
const SWEEP_DEFAULT = "960,1060,1190,1200,1280,1360,1440,1520,1600";

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
  --narrow <n>       the second viewport the reflowing screens are read at, where the
                     container queries fire (default 960, the desktop window's minimum)
  --widths a,b,c     the widths the Korean word-integrity sweep runs at
                     (default ${SWEEP_DEFAULT})
  --sweep-only       run only that sweep — reproducing one wrapping finding takes seconds
                     rather than the whole screen walk
  --verbose          list every screen walked, not only the findings`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const LOCALE = value("--locale", "ko");
const VERBOSE = flag("--verbose");
/** The two widths every reflowing screen is read at: roomy, and the narrowest the app may be. */
const WIDE = 1600;
const NARROW = Number(value("--narrow", 960)); // src-tauri/tauri.conf.json minWidth
/** The widths the Korean word-integrity sweep reads (see SWEEP_DEFAULT). */
const SWEEP_WIDTHS = value("--widths", SWEEP_DEFAULT)
  .split(",")
  .map((w) => Number(w.trim()))
  .filter(Boolean);
const SWEEP_ONLY = flag("--sweep-only");
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
 * The app's closed vocabularies, and every string each one is allowed to print.
 *
 * The alphabet checks above ask *which language* a string is in. They cannot ask whether it
 * is a **word**, and a whole class of defect lives in that gap: the bug board used to
 * abbreviate severity with `label.charAt(0)`, so a narrow row printed 높 / 보 / 낮 — two
 * bound stems, a fragment of 보통, and 낮, which is Korean for *daytime*, in the column
 * meaning lowest severity. Hangul on a Korean screen; nothing to report. The legend 100px
 * above it said 낮음 (P9 round 3 critic).
 *
 * So for the three vocabularies where the app is the author and the set of legal answers is
 * known — work state, bug state, severity — the rendered pill must equal a dictionary value
 * exactly. Anything else is the app inventing a word, whatever alphabet it is in: a
 * truncation, a stray synonym, an untranslated literal.
 */
const VOCABULARIES = [
  { name: "work status", selector: ".pill[class*='pill-work-']", keys: ["word.work.in_progress", "word.work.done", "word.work.abandoned"] },
  { name: "bug status", selector: ".pill[class*='pill-bug-']", keys: ["word.bug.open", "word.bug.in_progress", "word.bug.resolved", "word.bug.closed"] },
  {
    name: "severity",
    selector: ".pill-sev",
    keys: ["word.sev.critical", "word.sev.high", "word.sev.medium", "word.sev.low"],
    /* …plus whatever short forms this language declares. Empty in Korean, which is the
       fact under test: a language with no short form must print the word at every width. */
    abbrKeys: ["word.sevAbbr.critical", "word.sevAbbr.high", "word.sevAbbr.medium", "word.sevAbbr.low"],
  },
];

/**
 * A short form written in Hangul is forbidden, in any language, whatever a dictionary says.
 *
 * The DOM check below compares what is on screen against the dictionary, which catches a
 * component inventing a string — `label.charAt(0)` — and cannot catch the same truncation
 * typed *into* the dictionary, because then the gate and the defect agree. This is the half
 * that does not read the dictionary for its opinion.
 *
 * The rule is not a preference. A Latin initial is not a word in any reading of it, so C/H/M/L
 * is a form English readers expand. A Hangul syllable block *is* a possible word: cut 낮음 to
 * 낮 and you have not abbreviated anything, you have written the word for **daytime** in the
 * severity column. There is no length at which that is safe, so a Hangul short form is
 * refused rather than reviewed — the language keeps its whole word, which measures narrower
 * than the English one anyway (src/lib/i18n/ko.ts).
 */
const ABBR_KEYS = VOCABULARIES.flatMap((vocab) => vocab.abbrKeys ?? []);

/** Runs in the page: what each closed-vocabulary pill actually shows the reader. */
const VOCAB_PROBE = (vocabularies) => {
  const shown = (el) => {
    /* The text a reader sees, not textContent: a pill carries its word and its short form
       and hides one of them, and which one survives is the whole question. */
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out += node.textContent;
      else if (node.nodeType === 1) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        if (node.getAttribute("aria-hidden") === "true" && !node.textContent.trim()) continue;
        out += node.textContent;
      }
    }
    return out.replace(/\s+/g, " ").trim();
  };
  const found = [];
  for (const vocab of vocabularies) {
    for (const el of document.querySelectorAll(vocab.selector)) {
      if (getComputedStyle(el).display === "none") continue;
      found.push({ vocab: vocab.name, text: shown(el) });
    }
  }
  return found;
};

/**
 * …and the mirror of it: Hangul on an English screen.
 *
 * The app ships in two languages, and only one of them was ever gated. A Korean word typed
 * straight into a component — the easy mistake to make in this repository now — is invisible
 * to `tsc` and to the Korean run of this gate, which is looking for the opposite alphabet.
 * `--locale en` looks for this instead; everything else about the walk is identical.
 */
const HANGUL = /[가-힣]+/g;

/**
 * The bound nouns a number may not be parted from, and the sweep that enforces it.
 *
 * Korean counts with 의존명사: 18일, 8월, 27개, 22건, 8명 are each **one word**, and the
 * counter is a syllable that cannot stand on its own line — “2026년 8월 18” over a bare “일”
 * is the same class of damage as cutting 낮음 to 낮, arriving by the line breaker instead of
 * by a component. English has a space where Korean has the counter, so this is a defect only
 * the Korean build can have, and no gate here could see it: the alphabet walk asks what
 * language a string is in, the vocabulary walk reads pills, and check-clipping measures
 * overflow — a syllable that wrapped cleanly onto the next line overflows nothing.
 *
 * The list is the counters this app actually prints (see src/lib/i18n/ko.ts): the calendar's
 * 년/월/일, the durations 시간/분/초/개월/주, and the counters 개/건/명/번. Time units are in
 * it because “17시간 39분” is on the dashboard beside the dates.
 */
const COUNTERS = ["년", "개월", "월", "일", "시간", "분", "초", "주", "개", "건", "명", "번"];

/**
 * The screens whose Korean is swept, and what makes each one wrap-sensitive.
 *
 * Not all 149: this asks a question about *layout*, and the answer only changes where a box
 * is narrow enough to break a line and holds numbers the app itself wrote. That is the vault
 * bar and the project cards on /projects, and the dashboard's facts — the strip, the hero
 * unit, the 24-hour line, the record rows' durations — plus the two boards, which reflow
 * hardest. Every text node on them is read, minus the author containers: how an agent's own
 * English sentence wraps is not the app's business.
 */
const SWEEP_SCREENS = (slug) => [
  { name: "projects", path: "/projects", wait: ".project-row" },
  { name: `dashboard ${slug}`, path: `/p/${slug}`, wait: ".now-strip .now-hero-value" },
  { name: `work ${slug}`, path: `/p/${slug}/work`, wait: ".work-rows .work-row" },
  { name: `bugs ${slug}`, path: `/p/${slug}/bugs?tab=all`, wait: ".work-rows .bug-row" },
];

/**
 * Runs in the page. Returns every number+counter pair the line breaker split in two.
 *
 * Measured, not guessed: a Range is laid over the pair as it was rendered and asked for its
 * client rects. Two rects on two different lines is a break inside the word — whatever CSS
 * property allowed it, whatever the DOM looks like. The pairs are found in a *flat* string
 * per block container rather than per text node, so `{n}<span>개</span>` is read as the one
 * word it looks like on screen; whitespace nodes stay in that string, which is why a pair is
 * only a pair when nothing at all sits between the digits and the counter.
 */
const BREAK_PROBE = ({ counters, exempt }) => {
  const re = new RegExp(`\\d+(?:[.,]\\d+)?(?:${counters.join("|")})`, "g");
  /* The block container whose line boxes a text node lives in: an inline element shares its
     parent's lines, anything else starts its own. */
  const blockOf = (node) => {
    for (let cur = node.parentElement; cur; cur = cur.parentElement) {
      const display = getComputedStyle(cur).display;
      if (display !== "inline" && display !== "contents") return cur;
    }
    return document.body;
  };
  const label = (el) => {
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

  const groups = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.textContent) continue;
    if (exempt.some((sel) => el.closest(sel))) continue;
    const block = blockOf(node);
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(node);
  }

  const found = [];
  for (const nodes of groups.values()) {
    let flat = "";
    const map = [];
    for (const node of nodes) {
      map.push({ node, start: flat.length, length: node.textContent.length });
      flat += node.textContent;
    }
    const locate = (offset) => {
      for (const entry of map) {
        if (offset >= entry.start && offset <= entry.start + entry.length) {
          return { node: entry.node, offset: offset - entry.start };
        }
      }
      return null;
    };
    re.lastIndex = 0;
    for (let m = re.exec(flat); m; m = re.exec(flat)) {
      const from = locate(m.index);
      const to = locate(m.index + m[0].length);
      if (!from || !to) continue;
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      /* Zero-width rects appear at a range's boundaries and can sit on the line before it;
         only painted ink counts as a second line. */
      const lines = new Set(
        [...range.getClientRects()]
          .filter((r) => r.width > 0.5 && r.height > 0.5)
          .map((r) => Math.round(r.top)),
      );
      if (lines.size > 1) {
        found.push({
          pair: m[0],
          at: label(from.node.parentElement),
          context: flat.replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    }
  }
  return found;
};

let failures = 0;
let checked = 0;
let swept = 0;

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
    /* The 404, which this gate only ever loaded cold (the `not found` screen above). Loading
       it is not the test: NotFound() calls t() and, until round 5, read nothing that changes,
       while its route element is built once in App() — so the window repainted around it and
       left “화면이 없습니다” under an English sidebar for as long as the reader stayed
       (P9 round 4 critic). The reader who presses the toggle on a bad address is exactly the
       reader who meets it, so the toggle is pressed here. */
    ["not found", "/nope/nope", ".page-title"],
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
  const view = (width) => ({
    viewport: { width, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const VIEW = view(WIDE);

  /* The legal answers for each closed vocabulary, in this language. */
  const allowed = VOCABULARIES.map((vocab) => ({
    ...vocab,
    words: new Set(
      [...vocab.keys, ...(vocab.abbrKeys ?? [])].map((key) => t(LOCALE, key)).filter(Boolean),
    ),
  }));

  log(
    SWEEP_ONLY
      ? `word-integrity sweep only · ${SWEEP_WIDTHS.join("/")}px · language ${LOCALE}`
      : `${screens.length + unreadable.length} screens · language ${LOCALE}` +
          (LOCALE === "ko" ? ` · sweep at ${SWEEP_WIDTHS.length} widths` : ""),
  );

  const findings = [];

  /* Before a page is opened: no short form may be written in Hangul (see ABBR_KEYS). */
  for (const key of ABBR_KEYS) {
    const short = t(LOCALE, key);
    if (short && HANGUL.test(short)) {
      findings.push({
        screen: "dictionary",
        kind: "short form",
        text: `${key} = "${short}"`,
        at: `src/lib/i18n/${LOCALE}.ts`,
        words: ["a Hangul syllable is a word, not an initial — leave it empty and keep the word"],
      });
    }
    HANGUL.lastIndex = 0; // the regex is /g; it is also used by foreignIn
  }
  const walk = async (page, list, width) => {
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
        findings.push({ screen: `${screen.name} @${width}`, ...item, words });
      }

      /* …and the same screen asked a different question: is every word a word? */
      const pills = await page.evaluate(VOCAB_PROBE, allowed.map(({ name, selector }) => ({ name, selector })));
      for (const pill of pills) {
        const vocab = allowed.find((v) => v.name === pill.vocab);
        if (!vocab || vocab.words.has(pill.text)) continue;
        bad += 1;
        findings.push({
          screen: `${screen.name} @${width}`,
          kind: `${pill.vocab} vocabulary`,
          text: pill.text,
          at: vocab.selector,
          words: [`not one of: ${[...vocab.words].join(" / ")}`],
        });
      }
      if (VERBOSE || bad) log(`${screen.name} @${width}: ${printed.length} strings, ${bad} bad`);
    }
  };

  if (!SWEEP_ONLY) {
    const page = await browser.newPage(VIEW);
    await useLocale(page, LOCALE);
    await walk(page, screens, WIDE);

    // Its own session, because `?vault=` sticks to the one it is opened in.
    const broken = await browser.newContext(VIEW);
    await useLocale(broken, LOCALE);
    await walk(await broken.newPage(), unreadable, WIDE);
    await broken.close();
  }

  /* ---- and again in a window the app is allowed to be -----------------------
   *
   * Everything above ran at one wide viewport, where no container query fires — so for a
   * round this gate could not see the bug board's narrow layout at all, and the severity
   * column printed 낮 ("daytime") in place of 낮음 through every desktop window between
   * 960px and 1058px (P9 round 3 critic). 960 is the floor tauri.conf.json sets, so it is
   * the narrowest the app can ever be and the width where the most chrome has collapsed.
   * The boards are the screens that reflow; the rest are the same DOM at another size. */
  if (!SWEEP_ONLY) {
    const narrow = await browser.newContext(view(NARROW));
    await useLocale(narrow, LOCALE);
    await walk(
      await narrow.newPage(),
      screens.filter((s) => /^(bugs|work|dashboard) /.test(s.name)),
      NARROW,
    );
    await narrow.close();
  }

  /* ---- and the widths in between, asking whether the words are whole ---------
   *
   * Two viewports is two data points, and a line break is a step function: the width where
   * the vault bar's 생성 date orphaned its 일 was every one of the eleven between 1190 and
   * 1440, and this gate read 1600 and 960. So the Korean screens that reflow are read again
   * across the range a desktop window actually spends its life in, and every number+counter
   * pair on them must come out of the line breaker in one piece (see COUNTERS).
   *
   * Korean only, and not because English is exempt from the rule: English writes “18 Aug
   * 2026”, where the break the reader gets is at a space that was always there. There is no
   * pair to split, and a sweep with nothing to find is a minute of gate time saying nothing. */
  if (LOCALE === "ko") {
    for (const width of SWEEP_WIDTHS) {
      const ctx = await browser.newContext(view(width));
      await useLocale(ctx, LOCALE);
      const sweepPage = await ctx.newPage();
      for (const screen of SWEEP_SCREENS(slug)) {
        await sweepPage.goto(`${ORIGIN}${screen.path}`, { waitUntil: "domcontentloaded" });
        await sweepPage.waitForSelector(screen.wait, { state: "visible", timeout: 15_000 });
        await sweepPage.waitForFunction(() => !document.querySelector(".skeleton"));
        const broken = await sweepPage.evaluate(BREAK_PROBE, {
          counters: COUNTERS,
          exempt: AUTHOR,
        });
        swept += 1;
        for (const item of broken) {
          findings.push({
            screen: `${screen.name} @${width}`,
            kind: "word split",
            text: item.context,
            at: item.at,
            words: [`“${item.pair}” is broken across two lines — a counter left its number`],
          });
        }
        if (VERBOSE || broken.length) {
          log(`${screen.name} @${width}: ${broken.length} split word(s)`);
        }
      }
      await ctx.close();
    }
  }

  if (findings.length) {
    failures = findings.length;
    /* Two kinds of finding now: a string in the wrong language, and a string that is in the
       right language and is not a word. Counted apart, because "3 English strings" over a
       list of Korean fragments is the gate misreporting its own result. */
    const split = findings.filter((f) => f.kind === "word split").length;
    const foreign = findings.filter(
      (f) => !/vocabulary|short form|word split/.test(f.kind),
    ).length;
    const parts = [];
    if (foreign) parts.push(`${foreign} ${OTHER} string(s)`);
    if (findings.length - foreign - split) {
      parts.push(`${findings.length - foreign - split} not in the vocabulary`);
    }
    if (split) parts.push(`${split} word(s) split across a line break`);
    console.error(`\n  ${parts.join(", ")}, printed by the app in ${LOCALE}:\n`);
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

const span = `${SWEEP_WIDTHS[0]}–${SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1]}px`;
const sweepNote =
  LOCALE === "ko"
    ? `, and whole across ${swept} readings at ${SWEEP_WIDTHS.length} widths ${span}`
    : " (the word-integrity sweep is Korean's; English breaks at spaces)";
log(
  failures !== 0
    ? `${failures} finding(s) on ${checked} screens and ${swept} sweep readings`
    : SWEEP_ONLY
      ? `clean: ${swept} readings at ${SWEEP_WIDTHS.length} widths ${span} — no number was parted from its counter`
      : `clean: ${checked} screens at ${WIDE}px and ${NARROW}px — every word the app printed is ${LOCALE}, and is a word${sweepNote}`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
