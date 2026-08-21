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
 * **And a fourth: which side of the word is the number on?** {@link COUNTED_KEYS} and
 * {@link ORDER_PAIRS}. Korean names the thing and counts after — 완료 24 — and the three
 * questions above are all blind to a number printed in front of it: 시작 is Korean, the pill
 * equals a dictionary value, nothing wrapped and nothing overflowed. So the burn-up tooltip
 * printed "11 시작 · 11 완료 · 0 진행 중" for four rounds, 200px above its own legend reading
 * "시작 27 · 완료 27 · 진행 중 0" (P9 round 5 critic). That tooltip only exists while a chart
 * is hovered or focused, which is also why nothing had ever looked at it — so this gate now
 * opens it, by pointer and by arrow key, on both charts of both projects and at every width
 * in the sweep.
 *
 * **And a fifth: whose Korean?** The third question was asked only of the app's own words:
 * the sweep was handed {@link AUTHOR}, and `.prose`, `.feed-summary`, `.project-desc` and
 * `.now-row-title` — every surface that prints the *reader's* Korean — were on that list. So
 * the chrome measured clean at every width while a record body cut 모았습니다 into 모았습니
 * and 다 (P9 round 6 critic). It is asked of the whole page now, minus {@link BREAKABLE}: a
 * code span and a file path are strings, not words, and they are meant to break anywhere.
 *
 * Under that one: **nothing here had ever pointed the app at a vault holding Korean records**,
 * so five rounds of Korean review read Korean chrome over English data. The sweep now runs a
 * second time against a vault built for it with the release CLI (scripts/ko-vault.mjs) — a
 * Korean project, Korean titles, Korean bodies, Korean handles — on its own dev server, in a
 * temp directory that is deleted when the gate ends.
 *
 * **And a sixth, which is about this file rather than about the app: was the question asked?**
 * The round after the fixture arrived, the same defect shipped one box further out —
 * `.rel-title`, a record's title in the 관련 항목 rail — because no record in the fixture had
 * `refs`, so that rail was empty on every screen swept and the whole-page question passed over
 * a box with nothing in it. On the live vault the same box held English, which only breaks at
 * spaces. So each swept screen now declares the surfaces the fixture exists to fill, and an
 * empty one is a finding (see {@link FILLED_PROBE}): a gate that cannot reach a surface must
 * say so rather than report it clean.
 *
 * Everything else must be Korean — and `--locale en` is the same walk with the alphabets
 * swapped, because a Korean string typed into a component is just as invisible to `tsc` as
 * an English one, and the app ships in two languages. Runs against the live vault read-only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { ensureServer, startServer, stopServer, waitForServer } from "./dev-server.mjs";
import { t, useLocale } from "./i18n.mjs";
import { buildKoreanProjects } from "./ko-vault.mjs";

/* The app's own duration formatter, for choosing which record the sweep reads — the gate must
   not carry a second opinion about how long "5시간 48분" is (see resolvedBugIn). Outside a
   window it speaks the default locale, which is Korean, which is the sweep's language. */
register("./ts-hooks.mjs", import.meta.url);
const { formatDuration } = await import("../src/lib/format.ts");

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
 * ones between them are there because the defects that named this sweep lived *only* between
 * them. 1190 and 1200 are where the vault bar broke “2026년 8” ⏎ “월 18일”, 1360 and 1440 the
 * ends of the band where it broke “…18” ⏎ “일”, 1280 the client area of the real desktop
 * window the round-4 critic photographed, and 1060 and 1520 are ordinary widths between.
 *
 * 1110 and 1150 are the round-8 lesson, and they are two widths rather than one because the
 * box they were added for breaks *differently* on either side of a 55px band: the resolution
 * header printed “…등록 5” ⏎ “시간 48분 후” at 1102–1124 and “…등록 5시간 ” ⏎ “48분 후” at
 * 1144–1156, and this list stepped straight over both (1060 → 1190). A width sweep that only
 * ever reads round numbers is a sweep of the widths somebody thought of.
 */
const SWEEP_DEFAULT = "960,1060,1110,1150,1190,1200,1280,1360,1440,1520,1600";

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
  --ko-port <n>      port for the Korean-content fixture vault's own server (default port+4)
  --narrow <n>       the second viewport the reflowing screens are read at, where the
                     container queries fire (default 960, the desktop window's minimum)
  --widths a,b,c     the widths the Korean word-integrity sweep runs at
                     (default ${SWEEP_DEFAULT})
  --sweep-only       run only that sweep — reproducing one wrapping finding takes seconds
                     rather than the whole screen walk
  --verbose          list every screen walked, not only the findings

The Korean run also builds a vault whose records are Korean and sweeps that too, so it
needs the release CLI: cargo build --release -p agentmon-cli`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
/** The Korean-content fixture gets its own server, because a vault is a whole server's. */
const KO_PORT = Number(value("--ko-port", PORT + 4));
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
  const res = await fetch(`${ORIGIN}/project-api${path}`);
  if (!res.ok) throw new Error(`GET /project-api${path} -> ${res.status}`);
  return res.json();
};

/**
 * The bug in `bugs` whose resolution header is the longest — the worst case for the line
 * breaker — or null if this project has no bug with a resolution.
 *
 * Two choices here, and both were the round-8 defect in miniature.
 *
 * *Which bugs qualify*: `status === "resolved"` is not the question the screen asks. The card
 * is drawn on `bug.resolution`, the text of the fix (src/pages/BugDetailPage.tsx), which the
 * list endpoint does not carry, so each candidate's detail is read. A bug the sweep then finds
 * no card on would make the new screen wait 15s and die of a timeout — a real failure, but not
 * the one it is for.
 *
 * *Which of them to sweep*: not the first. This gate asks a **layout** question, and the first
 * of anything is not the hardest case of it — the live vault's first resolved bug is a
 * four-minute fix ("등록 4분 후", one short line at every width) while the header that broke for
 * two rounds belongs to a five-hour one ("등록 5시간 48분 후"). So the candidates are scored by
 * what fills that box: the duration, formatted by the app's own `formatDuration` rather than
 * by a copy of it, and the handle of the agent who resolved it.
 */
const resolvedBugIn = async (origin, slug, bugs) => {
  let best = null;
  for (const b of bugs) {
    if (!b.resolved && b.status !== "resolved") continue;
    const res = await fetch(`${origin}/project-api/projects/${slug}/bugs/${b.id}`);
    if (!res.ok) continue;
    const detail = await res.json();
    if (!detail.resolution) continue;
    const header =
      formatDuration(b.created, b.resolved) + (b.resolvedBy ?? b.assignee ?? "");
    if (!best || header.length > best.length) best = { id: b.id, length: header.length };
  }
  return best?.id ?? null;
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
  ".feedback-title", // an app-feedback item's title, written by the filing agent
  ".feedback-body", // …and its body
  ".work-row-title",
  ".note-row-title", // a shared note's title, on its list row
  ".note-row-desc", // …and the author's one-line description under it
  ".note-lead", // the same description at the head of the note's own page
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
 * screen, and the tooltip on each segment carries the same name. The New project form's
 * CLAUDE.md choice keeps the same rule for the same reason: the label tells you what the
 * generated file will read like, in that file's own language.
 */
const OTHER_TONGUE = [".locale-toggle", ".claude-md-choice"];

/** Values that are data rather than language, and are the same in every locale. */
const TOKENS = [
  /\b(WORK|BUG|FB)-(?:\d+|N{4})\b/g, // an id — and the shape of one, which a bad address is told
  /\bAgentMonitoring\b/g,
  /\bUTC\b/g,
  /\bCtrl\b/g,
  /\bagentmon\b/g,
  /\bvault\.json\b/g,
  /\bevents\.jsonl\b/g,
  /\bCLAUDE\.md\b/g,
  /\.mcp\.json\b/g, // the client config file the project menu writes, named as-is
  /\bprojects\/[^\s]*/g,
  /\bAGENTMON_DIRS?\b/g,
  /\bproject\.json\b/g,
  /--[a-z-]+/g,
  /\bv\d+\b/g,
  /##\s*\w+/g,
  /\bEnglish\b/g, // the language toggle names the other language in its own language
  /\bID\b/g, // written in Latin in Korean product UIs, like URL and CLI
  /\bCLI\b/g, // …and CLI itself, which is what the onboarding calls the thing agents run
  /\bMCP\b/g, // the protocol name, printed as-is like CLI
  /\bapp[_-]feedback\b/g, // the app-feedback tool and CLI verb (docs/MCP.md)
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
  /* The third record kind's own closed vocabulary: the type pill on a note's page must be
     exactly the dictionary's word — 필수/지식/인계/결정/참조, never a synonym or a truncation. */
  {
    name: "note type",
    selector: ".pill[class*='pill-note-']",
    keys: ["word.note.essential", "word.note.memory", "word.note.handoff", "word.note.decision", "word.note.reference"],
  },
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
 *
 * The sweep also carries the app's own state words as whole tokens ({@link COUNTED_KEYS}),
 * for the same reason and one step out: 시작 has no space in it and may not gain one from the
 * line breaker either. The chart tooltip printed it as 시 over 작 — one syllable per line —
 * because the tip is laid out in whatever room is left to the right of the crosshair and all
 * three of the row's flex items were shrinkable, so the label got 19px for a 21px word. Found
 * by rendering the tooltip, which nothing here had ever done.
 */
const COUNTERS = ["년", "개월", "월", "일", "시간", "분", "초", "주", "개", "건", "명", "번"];

/**
 * The app's own counted words — and the fourth question: **which side of the word is the
 * number on?**
 *
 * Three gates read a count-and-its-word and all three pass an English sentence written in
 * Korean. `check:i18n`'s alphabet walk asks which *language* a string is in — 시작 is Korean.
 * {@link VOCABULARIES} asks whether a pill equals a dictionary value — it does, exactly.
 * {@link COUNTERS} asks whether a line break parted a number from its counter — nothing
 * wrapped. `check:clipping` measures overflow — nothing overflowed. So "11 시작 · 11 완료 ·
 * 0 진행 중" sat in the burn-up tooltip for four rounds, 200px above a legend reading
 * "시작 27 · 완료 27 · 진행 중 0" and one element away from a spoken status reading
 * "시작 11, 완료 11" — one chart, one word, two orders (P9 round 5 critic). Nothing here
 * asked the only question that separates them.
 *
 * The rule is the dictionary's own, written beside `word.inProgressCount` in
 * src/lib/i18n/ko.ts: "2 진행 중"처럼 숫자가 상태어 앞에 오는 영어 어순은 쓰지 않는다. Korean
 * names the thing and counts after — 완료 24, 미해결 2개, 진행 중 2개 — and `dash.countPart`
 * already keeps both orders in the dictionary where they belong (ko `${label} ${count}`,
 * en `${count} ${label}`).
 *
 * So: on a Korean screen a **bare** numeral may not stand immediately in front of one of
 * these words. Bare is the whole rule — "작업 로그 2개 진행 중" and "12개 중 2개 진행 중" are
 * grammatical and pass, because the 의존명사 binds the number into a noun phrase; it is the
 * naked digit with nothing but space between it and the state word that is English grammar
 * wearing Korean words.
 *
 * Read from the dictionary rather than typed here, so a re-worded state is not a new gate
 * failure. Korean only, and not because English is exempt from having an order: English has
 * two legitimate ones — "24 done" in a legend, "started 16 · done 16" in the day mix — so a
 * blanket rule would be wrong. The elements where English has exactly one order are gated
 * structurally instead; see {@link ORDER_PAIRS}.
 */
const COUNTED_KEYS = [
  ...VOCABULARIES.flatMap((vocab) => vocab.keys),
  "word.inProgress",
  "word.done",
  "word.abandoned",
  "word.open",
  "word.resolved",
  "word.closed",
  "word.unresolved",
  "word.unresolvedLabel",
  "word.unassigned",
  "word.unassignedLabel",
  "word.doneOrAbandoned",
  "word.resolvedOrClosed",
  /* The note noun. Every Korean string that counts notes says 메모 4개, noun first — the
     note-type words themselves arrive through the vocabulary spread above. */
  "word.noteNoun",
  /* The burn-up's two upper series: the words the tooltip printed behind its numbers. */
  "dash.seriesStarted",
  "dash.seriesFiled",
];

/**
 * The elements that carry a count and its word as two siblings, and which of them comes first.
 *
 * The sweep above reads text, which is the reader's view and is Korean-only. This reads
 * *structure*, in both languages: for each of these boxes the value element and the label
 * element must be in the order the language puts them — label first in Korean, value first
 * in English. It is the half that a mutation cannot slip past in either direction, and it is
 * deliberately the trio the critic caught disagreeing with each other on one card: the
 * legend under the plot, the tooltip's rows, and the tooltip's gap line.
 */
const ORDER_PAIRS = [
  { name: "chart legend", selector: ".chart-legend li", value: ".legend-value", label: ".legend-label" },
  { name: "chart tooltip row", selector: ".tip-row", value: ".tip-value", label: ".tip-label" },
  { name: "chart tooltip gap", selector: ".tip-gap", value: ".tip-gap-value", label: ".tip-gap-label" },
];

/**
 * Where a mid-token break is what somebody asked for, and the only place Hangul may be cut.
 *
 * The Korean word question below is asked of the *whole* page rather than of a list of
 * boxes, because the list was the bug: for six rounds the sweep was handed {@link AUTHOR}
 * and the four surfaces that print a reader's own Korean were all on it. So the exemptions
 * here are by intent, not by ownership — a code span, a shell command, a file path and an
 * id are strings whose characters do not form words, and the styles that hold them ask for
 * `overflow-wrap: anywhere` on purpose so a 60-character path cannot leave the column.
 * Everything else on the screen, the record's own prose included, must keep its words whole.
 */
const BREAKABLE = [
  "code",
  "pre",
  "kbd",
  ".mono", // ids, slugs, routes, paths
  ".command-text",
  ".empty-code",
  ".vault-bar-path",
  ".file-item",
  ".sr-only", // never painted, so it has no lines to be broken across
];

/**
 * The screens whose Korean is swept, and what makes each one wrap-sensitive.
 *
 * Not all 149: this asks a question about *layout*, and the answer only changes where a box
 * is narrow enough to break a line. That is the vault bar and the project cards on /projects,
 * the dashboard's facts — the strip, the hero unit, the 24-hour line, the record rows'
 * durations — the two boards, which reflow hardest, and a record of each kind, which is where
 * the longest Korean on the screen is: the body an agent wrote. The record screens are new
 * this round, and they are the ones that would have caught the round-6 defect: `.prose` was
 * exempt from the question *and* absent from the list, so the sweep never loaded a body at a
 * width where it wraps.
 *
 * **A record of each kind is not a record in each state.** `bug` here is `bugs[0]`, and this
 * reader sorts bugs open-first (scripts/project-fs.mjs), so it is an *open* bug on every project
 * of both vaults — which means `.outcome-card.is-resolution` was never rendered on any screen
 * this sweep opened, at any width, and the 해결 내용 header inside it broke Korean words for
 * two rounds under a gate that reported clean (P9 round 8 critic: 74 of 837 readings of that
 * one box on the live vault, 1102–1156px). So the resolved bug is its own screen, chosen by
 * asking the vault which bug has a resolution rather than by taking the first one, and a
 * vault with no such bug is reported as a gap rather than skipped (see `sweep`).
 */
const SWEEP_SCREENS = (projects) => [
  { name: "projects", path: "/projects", wait: ".project-row", filled: [".project-desc", ".feed-summary"] },
  /* The app's first write action, in the state a Korean name puts it in: the create panel
     with a name that cannot derive a slug, where the hint becomes the rule and the button
     stays disabled and explained (src/pages/ProjectsPage.tsx). It is the longest Korean
     sentence the chrome prints anywhere, in a half-width column, and it is a *typed* state,
     so no gate had ever loaded it — the sweep types its way in. */
  {
    name: "new project form, Korean name",
    path: "/projects",
    wait: ".field-hint.is-blocking",
    prepare: async (page) => {
      await page.waitForSelector(".project-row", { state: "visible", timeout: 15_000 });
      await page.getByRole("button", { name: t("ko", "proj.new"), exact: true }).click();
      await page.waitForSelector(".create-panel", { state: "visible", timeout: 15_000 });
      await page
        .locator(".create-grid .field input")
        .first()
        .fill(t("ko", "proj.form.namePlaceholder"));
    },
  },
  ...projects.flatMap(({ slug, work, bug, note, resolvedBug }) => [
    {
      name: `dashboard ${slug}`,
      path: `/p/${slug}`,
      wait: ".now-strip .now-hero-value",
      filled: [".now-row-title", ".feed-summary"],
    },
    {
      name: `work ${slug}`,
      path: `/p/${slug}/work`,
      wait: ".work-rows .work-row",
      filled: [".work-row-title"],
    },
    {
      name: `bugs ${slug}`,
      path: `/p/${slug}/bugs?tab=all`,
      wait: ".work-rows .bug-row",
      filled: [".work-row-title"],
    },
    ...(work
      ? [{
          name: `work detail ${work}`,
          path: `/p/${slug}/work/${work}`,
          wait: ".record-title",
          filled: [".record-title", ".prose", ".rel-title"],
        }]
      : []),
    ...(bug
      ? [{
          name: `bug detail ${bug}`,
          path: `/p/${slug}/bugs/${bug}`,
          wait: ".record-title",
          filled: [".record-title", ".prose", ".rel-title"],
        }]
      : []),
    /* The notes list: the third record kind's index, whose rows carry two author-written
       lines (title and description) in a fixed-width grid — the shape that wraps. Waited on
       by its rows, so a fixture that stops writing notes fails here instead of passing over
       an empty list. */
    {
      name: `notes ${slug}`,
      path: `/p/${slug}/notes`,
      wait: ".note-rows .note-row",
      filled: [".note-row-title", ".note-row-desc"],
    },
    /* …and one note in full — chosen with refs (see the builders), so the Related rail
       renders and `.rel-title` holds a Korean title on the fixture. The lead line is the
       author's description, the longest single sentence a note screen prints. */
    ...(note
      ? [{
          name: `note detail ${note}`,
          path: `/p/${slug}/notes/${note}`,
          wait: ".record-title",
          filled: [".record-title", ".note-lead", ".prose", ".rel-title"],
        }]
      : []),
    /* The one screen in the app that prints a date *and* two durations in one box — the
       header of the resolution card. It waits on the card rather than on the title, so a
       screen that somehow has no resolution fails here instead of passing quietly. */
    ...(resolvedBug
      ? [{
          name: `resolved bug ${resolvedBug}`,
          path: `/p/${slug}/bugs/${resolvedBug}`,
          wait: ".outcome-card.is-resolution .outcome-when",
          filled: [".record-title", ".prose", ".outcome-body .prose"],
        }]
      : []),
    /* The tooltips, open, at every width in the list — the state the burn-up tip is read in
       and the one no gate had ever rendered (see openTips). */
    {
      name: `dashboard ${slug} chart tips`,
      path: `/p/${slug}`,
      wait: ".chart-tip",
      prepare: openTips(true),
    },
  ]),
];

/**
 * Runs in the page. Returns the declared surfaces that are **not** holding Korean.
 *
 * The gate that missed `.rel-title` for a round asked the right question — is every Korean
 * word on this page still whole? — of the right screens, and got no answer from that box,
 * because nothing in the fixture ever put a Korean title in it: no record had `refs`, so
 * 관련 항목 was absent from every screen the sweep opened, while the live vault filled the
 * same box with English, which only breaks at spaces (P9 round 7 critic). A question asked of
 * an empty box passes, and reports the same "clean" as a question that was answered.
 *
 * So each swept screen names the surfaces the Korean-content fixture exists to fill, and this
 * fails when one of them holds no Hangul. It is a check on the *fixture*, not on the app: it
 * runs only against the built vault (where every record is Korean by construction), never
 * against the live one, whose records are English and are supposed to be.
 */
const FILLED_PROBE = (selectors) =>
  selectors.filter(
    (sel) =>
      ![...document.querySelectorAll(sel)].some((el) => /[가-힣]{2,}/.test(el.textContent || "")),
  );

/**
 * Runs in the page. Returns every monogram wearing a lowercase Latin initial.
 *
 * The avatar's glyphs are chosen by a function with two branches — Latin handles take the
 * first letter of each of the first two parts, uppercased; Hangul handles take one syllable,
 * which has no case (agentInitials, src/components/ui.tsx). A handle that is *both* went down
 * the Korean branch uncased, so `nova-배송팀` wore a lowercase "n" beside the uppercase PI and
 * PM monograms on the same screen, and wore only that "n", so two teams' agents shared one
 * monogram (P9 rounds 7 and 8 critics). Every other initial in this app is uppercase, and
 * "every other" is exactly what a gate can check without knowing the rule.
 *
 * Read from the rendered avatar rather than from the function, because the function is in a
 * `.tsx` and this gate runs in Node: the surface is the thing being promised anyway.
 */
const MONOGRAM_PROBE = () =>
  [...document.querySelectorAll(".agent-avatar")]
    .map((el) => (el.textContent || "").trim())
    .filter((text) => /\p{Ll}/u.test(text))
    .filter((text, i, all) => all.indexOf(text) === i);

/**
 * Runs in the page. Returns every Korean word the line breaker split in two.
 *
 * Measured, not guessed: a Range is laid over the word as it was rendered and asked for its
 * client rects. Rects on two different lines is a break inside the word — whatever CSS
 * property allowed it, whatever the DOM looks like. The words are found in a *flat* string
 * per block container rather than per text node, so `{n}<span>개</span>` is read as the one
 * word it looks like on screen; whitespace nodes stay in that string, which is why a pair is
 * only a pair when nothing at all sits between the digits and the counter.
 *
 * Asked twice per screen, of two different shapes and two different halves of the page:
 *
 *   * `counters`/`words` over everything except {@link AUTHOR} — a number and its 의존명사 are
 *     one word, and so is each of the app's own state words.
 *   * `hangul` over everything except {@link BREAKABLE} — *any* run of two or more syllables
 *     is a word, wherever it came from. This is the question the sweep did not ask for six
 *     rounds: the app's own chrome was covered by keep-all and measured clean, while every
 *     surface that prints the reader's Korean was on the exempt list and cut mid-syllable
 *     ("재시도 규칙은 한곳에 모았습니" ⏎ "다.", 59 times over one Korean vault; P9 round 6).
 *     Author *content* is not the app's business; what the app's line breaker does to it is.
 */
const BREAK_PROBE = ({ counters, words, exempt, hangul }) => {
  const shapes = [];
  if (counters.length) shapes.push(`\\d+(?:[.,]\\d+)?(?:${counters.join("|")})`);
  if (words.length) shapes.push(words.join("|"));
  if (hangul) shapes.push("[가-힣]{2,}");
  const re = new RegExp(shapes.join("|"), "g");
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
         only painted ink counts as a second line.

         Line membership is decided by vertical *overlap*, not by an equal top: a number is
         set larger than the word it counts and a `<code>` run sits a pixel or two higher
         than the prose beside it, so equal tops report splits that are not there. Two boxes
         on one line always overlap; two line boxes never do. */
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      const lines = [];
      for (const r of rects) {
        const line = lines.find((l) => Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > 1);
        if (line) {
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
        } else {
          lines.push({ top: r.top, bottom: r.bottom });
        }
      }
      if (lines.length > 1) {
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

/**
 * Runs in the page. Returns every bare numeral standing in front of one of the app's own
 * counted words (see {@link COUNTED_KEYS}) — English word order in a Korean window.
 *
 * Two things make this harder than a regex over `textContent`, and both are what the defect
 * hid behind:
 *
 *   1. **The phrase is spread across elements.** The tooltip's number and its word are two
 *      sibling `<span>`s with no text node between them, so the text is read flattened per
 *      container the way {@link BREAK_PROBE} reads it — `<span>11</span><span>시작</span>` is
 *      the "11 시작" a reader sees, not two unrelated strings. And the container is a *line*
 *      container, not a block one: a flex row blockifies its children, so grouping by
 *      `display !== inline` puts the number and the word in two different groups and finds
 *      nothing. Every element that is a flex or grid item is climbed through.
 *   2. **…which makes separate things look adjacent.** Two remedies, because one is not
 *      enough. A group never crosses a **unit** — a control, a list item, a table cell —
 *      since the work list's four filter tabs sit in one row and "전체 27" beside "진행 중 0"
 *      is not the phrase "27 진행 중". And what survives that is *measured*: a Range is laid
 *      over the match and asked where it was painted. One line, and no gap between its pieces
 *      wider than a word space, or it is two things that happen to share a row.
 *
 * `title` and `aria-label` are read too — the tooltip on a status dot is a sentence somebody
 * reads — and there the string is already one piece, so no measuring is needed.
 */
const ORDER_PROBE = ({ words, exempt }) => {
  const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alternation = [...words]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  /* `\d+` then nothing but space: a digit followed by its 의존명사 ("2개 진행 중") never
     reaches the word, which is the point — that phrase is correct Korean and must pass. */
  const re = new RegExp(`(\\d+)[ \\t\\u00a0]*(${alternation})(?![가-힣])`, "g");
  /** How far apart two painted pieces may be and still be one phrase, in px. */
  const ADJACENT = 24;
  /**
   * How much bigger than its word a number has to be set before it stops being a word in a
   * phrase and becomes a **figure with a caption**.
   *
   * The NOW panel's 48px 0 over a 12px "진행 중 · 전체 작업 로그 27개", and the 32px 92 over
   * "이벤트 기록됨", are stat tiles: a display figure and the caption naming it, a register
   * Korean sets exactly as English does, with the grammatical sentence carried on the tile's
   * own tooltip ("작업 로그 27개 중 0개 진행 중"). The tooltip's 14px number beside its 12px
   * word is not that — it is one phrase, read as one line, and it takes the language's word
   * order. 1.5× sits in the empty middle: the phrases measure 1.1–1.2×, the figures 2.7–4×.
   */
  const FIGURE = 1.5;
  /** One thing a reader reads as one thing: a control, a list item, a cell. */
  const UNIT = "a,button,li,td,th,label,summary,[role=tab],[role=button],[role=option],[role=row]";
  const isTrack = (el) => /flex|grid/.test(getComputedStyle(el).display);
  const blockOf = (node) => {
    for (let cur = node.parentElement; cur; cur = cur.parentElement) {
      if (cur.matches(UNIT)) return cur;
      const display = getComputedStyle(cur).display;
      const inline = display === "inline" || display === "contents";
      /* A flex/grid item is laid out on its parent's line beside its siblings, whatever its
         own blockified `display` says. */
      const item = cur.parentElement && isTrack(cur.parentElement);
      if (!inline && !item) return cur;
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

  const found = [];

  /* Every text node in the block, author-owned ones included, because dropping a node makes
     its neighbours adjacent that never were: an id chip between a number and a pill would
     turn `BUG-0012` + `열림` into the phrase "0012열림". They are kept in the string and
     ruled out at the match instead — a number an agent wrote is not the app's word order. */
  const groups = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement || !node.textContent) continue;
    const block = blockOf(node);
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(node);
  }
  for (const [block, nodes] of groups) {
    let flat = "";
    const map = [];
    for (const node of nodes) {
      map.push({ node, start: flat.length, end: flat.length + node.textContent.length });
      flat += node.textContent;
    }
    const at = (offset) => {
      const hit = map.find((e) => offset >= e.start && offset < e.end) ?? map[map.length - 1];
      return { node: hit.node, offset: Math.min(offset - hit.start, hit.node.textContent.length) };
    };
    re.lastIndex = 0;
    for (let m = re.exec(flat); m; m = re.exec(flat)) {
      const from = at(m.index);
      const to = at(m.index + m[0].length - 1);
      const number = from.node.parentElement;
      const word = to.node.parentElement;
      if ([number, word].some((el) => exempt.some((sel) => el.closest(sel)))) continue;
      const size = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;
      if (size(number) >= size(word) * FIGURE) continue; // a figure and its caption

      /* Painted where a reader would read it as one phrase, or not a phrase. */
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset + 1);
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0.5 && r.height > 0.5)
        .sort((a, b) => a.left - b.left);
      if (!rects.length) continue;
      /* One line, by overlap rather than by a shared top: the number is set larger than the
         word beside it and the two are baseline-aligned, so equal tops would be the wrong
         question. A wrap gives no overlap at all. */
      const sameLine = (r) =>
        Math.min(r.bottom, rects[0].bottom) - Math.max(r.top, rects[0].top) > 1;
      if (rects.some((r) => !sameLine(r))) continue;
      if (rects.some((r, i) => i > 0 && r.left - rects[i - 1].right > ADJACENT)) continue;

      found.push({
        phrase: m[0],
        context: flat.replace(/\s+/g, " ").trim().slice(0, 120),
        at: label(word),
      });
    }
  }

  for (const el of document.querySelectorAll("[title], [aria-label]")) {
    if (exempt.some((sel) => el.closest(sel))) continue;
    for (const attr of ["title", "aria-label"]) {
      const text = el.getAttribute(attr);
      if (!text) continue;
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        found.push({
          phrase: m[0],
          context: text.replace(/\s+/g, " ").trim().slice(0, 120),
          at: `${label(el)} [${attr}]`,
        });
      }
    }
  }
  return found;
};

/**
 * Runs in the page. Returns every count/word pair whose two elements are in the wrong order
 * for this language — the structural half of the same question (see {@link ORDER_PAIRS}).
 */
const PAIR_PROBE = ({ pairs, labelFirst }) => {
  const found = [];
  for (const pair of pairs) {
    for (const box of document.querySelectorAll(pair.selector)) {
      const value = box.querySelector(pair.value);
      const label = box.querySelector(pair.label);
      if (!value || !label) continue;
      /* DOCUMENT_POSITION_FOLLOWING = 4: the label comes after the value in the DOM, and a
         flex row with no `order` paints in DOM order. */
      const labelIsFirst = !(value.compareDocumentPosition(label) & 4);
      if (labelIsFirst === labelFirst) continue;
      found.push({
        where: pair.name,
        text: box.textContent.replace(/\s+/g, " ").trim().slice(0, 80),
        first: labelIsFirst ? "the word" : "the number",
      });
    }
  }
  return found;
};

/**
 * Put both burn-up tooltips on screen at the same time, one by arrow key and one by pointer.
 *
 * The tip is the surface a mouse reader meets most and the one nothing in this repo had ever
 * rendered in a gate: it only exists while the chart is hovered or focused. `keyboardFirst`
 * swaps which chart gets which input, so across the two dashboard entries each chart is
 * driven both ways. The arrow keys are pressed rather than simulated because
 * `onKeyDown`/`onFocus` are two different paths into the same `active` state, and the critic
 * reproduced the defect through both.
 */
const openTips = (keyboardFirst) => async (page) => {
  await page.waitForSelector(".chart-plot", { state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
  const plots = page.locator(".chart-plot");
  const count = await plots.count();
  if (count === 0) return; // a project with nothing to plot draws .chart-empty instead
  const [byKey, byPointer] = keyboardFirst ? [0, 1] : [count - 1, 0];
  await plots.nth(byKey).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  if (count > 1 && byPointer !== byKey) {
    await plots.nth(byPointer).hover({ position: { x: 120, y: 60 } });
  }
  await page.waitForFunction(
    (want) => document.querySelectorAll(".chart-tip").length >= want,
    count > 1 ? 2 : 1,
    { timeout: 5_000 },
  );
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
/** The dev server for the Korean-content fixture, and the directory it is built in. */
let koServer = null;
const temps = [];

try {
  ({ server } = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  }));

  const projectRows = await api("/projects");
  const projects = projectRows.filter((r) => r.available && r.project).map((r) => r.project);
  /* Everything the vault itself names — agent handles, project names and slugs, tags and
     labels — is data the app prints as written, in any language. Read from the vault rather
     than listed here, so a new agent name is not a new gate failure. */
  const vaultWords = new Set();
  for (const p of projects) {
    vaultWords.add(p.name);
    /* …and its id. The doc above says "project names and slugs" and for a whole era the id
       *was* the name, so only the name was ever read. v2 ids are their own token
       (prj-agent-monitoring), and the breadcrumb prints one verbatim while the project list
       is still in flight — data, not language, exactly like the name it stands in for. */
    vaultWords.add(p.id);
    for (const tag of p.tags ?? []) vaultWords.add(tag);
  }
  const screens = [];
  /** A record of each kind in the first project, for the screens that toggle in place. */
  let firstWork = null;
  let firstBug = null;
  /** Each project and one record of each kind in it — what the width sweep walks. */
  const sweepProjects = [];
  for (const p of projects) {
    const works = await api(`/projects/${p.id}/worklogs`);
    const bugs = await api(`/projects/${p.id}/bugs`);
    const notesList = await api(`/projects/${p.id}/notes`);
    sweepProjects.push({
      slug: p.id,
      work: works[0]?.id ?? null,
      bug: bugs[0]?.id ?? null,
      /* A note *with refs*, so the sweep's note-detail screen renders the Related rail —
         a note without one would sweep a page with an empty box where `.rel-title` goes. */
      note: (notesList.find((n) => n.refs?.length) ?? notesList[0])?.name ?? null,
      resolvedBug: await resolvedBugIn(ORIGIN, p.id, bugs),
    });
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
    /* Note agents and tags are vault data exactly as work ones are; a note's kebab *name*
       is not added, because everywhere the app prints one is mono (.note-row-name, the
       breadcrumb, a feed ref, a palette hint) — a name outside a mono box is a finding. */
    for (const n of notesList) {
      vaultWords.add(n.agent);
      for (const tag of n.tags ?? []) vaultWords.add(tag);
    }
    /* Actors off the event log too, not only off the records.
     *
     * An actor is a handle out of the vault wherever it is printed — the feed's `.feed-actor`
     * draws it exactly as the byline draws `nova`. Reading them only off worklogs and bugs
     * missed the one actor that appears on *events alone*: `app`, which is what the desktop
     * app records when a human, not an agent, writes something (DEFAULT_ACTOR in
     * src/lib/api.ts). So the day this vault got its first human-made write, five screens
     * started failing this gate for printing a name that came out of the vault they were
     * reading. */
    for (const e of await api(`/projects/${p.id}/events`)) vaultWords.add(e.actor);
    if (p.id === projects[0].id) {
      firstWork = works[0]?.id ?? null;
      firstBug = bugs[0]?.id ?? null;
    }
    screens.push(
      { name: `dashboard ${p.id}`, path: `/p/${p.id}`, wait: ".now-strip .now-hero-value" },
      { name: `dashboard ${p.id} 7d`, path: `/p/${p.id}?range=7d`, wait: ".chart-legend" },
      { name: `work ${p.id}`, path: `/p/${p.id}/work`, wait: ".work-rows .work-row" },
      { name: `bugs ${p.id}`, path: `/p/${p.id}/bugs?tab=all`, wait: ".work-rows .bug-row" },
      /* …and the same dashboard with the tooltips *open*, which is the only state they are
         ever read in and the one no gate had ever loaded: the burn-up tip exists on hover or
         on focus and is in no screenshot, no DOM this gate walked and no clipping run, so
         four rounds of Korean gates never saw the English word order printed inside it
         (P9 round 5 critic). Both charts at once, and both ways in — a hover does not move
         focus, so the keyboard's tip stays open under the mouse's. */
      {
        name: `dashboard ${p.id} chart tips`,
        path: `/p/${p.id}`,
        wait: ".chart-tip",
        prepare: openTips(true),
      },
      {
        name: `dashboard ${p.id} 7d chart tips`,
        path: `/p/${p.id}?range=7d`,
        wait: ".chart-tip",
        prepare: openTips(false),
      },
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
        path: `/p/${p.id}/work/${w.id}`,
        wait: ".record-title",
      });
    }
    for (const b of bugs) {
      screens.push({
        name: `bug detail ${b.id}`,
        path: `/p/${p.id}/bugs/${b.id}`,
        wait: ".record-title",
      });
    }
    /* The third record kind: its list, and every note in full — the same "every record,
       not a sample" rule the two loops above follow. The list is waited on by its rows, so
       a vault whose notes stop being served fails loudly rather than passing over an empty
       screen. */
    screens.push({ name: `notes ${p.id}`, path: `/p/${p.id}/notes`, wait: ".note-rows .note-row" });
    for (const n of notesList) {
      screens.push({
        name: `note detail ${n.name}`,
        path: `/p/${p.id}/notes/${n.name}`,
        wait: ".record-title",
      });
    }
  }
  /* The app feedback board is machine-level — whatever this machine's agents filed. Its
     titles and bodies are author content (AUTHOR above); its agents are vault-style data. */
  for (const f of await api("/app-feedback")) vaultWords.add(f.agent);
  screens.push(
    { name: "projects", path: "/projects", wait: ".project-row" },
    { name: "app feedback", path: "/app-feedback", wait: ".empty, .feedback-list" },
    { name: "not found", path: "/nowhere-at-all", wait: ".page-title" },
    {
      name: "command palette",
      path: `/p/${projects[0].id}`,
      wait: ".palette-item",
      prepare: async (page) => {
        await page.waitForSelector(".page-title", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.keyboard.press("Control+K");
      },
    },
    {
      name: "record menu",
      path: `/p/${projects[0].id}/work`,
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
    /* The delete dialog — the app's one destructive surface, and four paragraphs of the
       app's own prose that exist nowhere else. It is *opened* and read; nothing is typed
       into it and nothing is clicked, and the button it would need is disabled until the
       project's slug is typed exactly, so this walk cannot delete anything from the live
       vault it is reading (components/DeleteProject.tsx). */
    {
      name: "delete dialog",
      path: "/projects",
      wait: ".modal.is-danger",
      prepare: async (page) => {
        await page.waitForSelector(".project-row", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.locator(".project-row").first().click({ button: "right", position: { x: 24, y: 18 } });
        await page.waitForSelector(".ctx-menu", { state: "visible" });
        await page.locator('.ctx-item[data-item="delete"]').click();
      },
    },
    {
      name: "filter menu",
      path: `/p/${projects[0].id}/bugs?tab=all`,
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
    ["dashboard", `/p/${projects[0].id}`, ".now-strip .now-hero-value"],
    ...(firstWork ? [["work detail", `/p/${projects[0].id}/work/${firstWork}`, ".record-title"]] : []),
    ...(firstBug ? [["bug detail", `/p/${projects[0].id}/bugs/${firstBug}`, ".record-title"]] : []),
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
   * `?dirs=` is read once and kept in sessionStorage (src/lib/api.ts), so the unreadable
   * ones come last and get their own browser context — otherwise every screen after them
   * would be looking at the same broken folder. */
  const slug = projects[0].id;
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

  /* A real directory with no project in it: this repo's own docs/. The message names it,
     so it has to be a path that exists rather than a placeholder. */
  const noProject = `?dirs=${encodeURIComponent(join(process.cwd(), "docs"))}`;
  const unreadable = [
    { name: "dashboard, unreadable folder", path: `/p/${slug}${noProject}`, wait: ".error-title" },
    { name: "work list, unreadable folder", path: `/p/${slug}/work${noProject}`, wait: ".error-title" },
    { name: "bug board, unreadable folder", path: `/p/${slug}/bugs${noProject}`, wait: ".error-title" },
    {
      name: "work detail, unreadable folder",
      path: `/p/${slug}/work/WORK-0001${noProject}`,
      wait: ".error-title",
    },
    {
      name: "bug detail, unreadable folder",
      path: `/p/${slug}/bugs/BUG-0001${noProject}`,
      wait: ".error-title",
    },
    /* /projects is the screen that explains an unreadable folder rather than erroring on
       it: the row stays, dimmed, with the diagnosis on it (SPEC v2, screen 7). */
    { name: "projects, unreadable folder", path: `/projects${noProject}`, wait: ".project-row.is-unavailable" },
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

  /* The words a bare numeral may not stand in front of, in this language's own spelling. */
  const countedWords = [...new Set(COUNTED_KEYS.map((key) => t(LOCALE, key)).filter(Boolean))];
  /* …and the same words as single tokens, which the line breaker may not open up. A word
     with a space in it ("완료 또는 중단") is three of them: Korean breaks at a space and
     nowhere else, so only the space-free pieces are one word, and a one-syllable piece
     cannot be split at all. */
  const wholeWords = [
    ...new Set(countedWords.flatMap((w) => w.split(/\s+/)).filter((w) => w.length > 1)),
  ];
  /* Korean names the thing and counts after; English counts first. */
  const LABEL_FIRST = LOCALE === "ko";
  const orderProbe = async (page) => {
    const findingsHere = [];
    if (LOCALE === "ko") {
      for (const hit of await page.evaluate(ORDER_PROBE, { words: countedWords, exempt: AUTHOR })) {
        findingsHere.push({
          kind: "word order",
          text: hit.context,
          at: hit.at,
          words: [`“${hit.phrase}” — 숫자가 상태어 앞에 오는 영어 어순 (ko.ts: word.inProgressCount)`],
        });
      }
    }
    for (const hit of await page.evaluate(PAIR_PROBE, {
      pairs: ORDER_PAIRS,
      labelFirst: LABEL_FIRST,
    })) {
      findingsHere.push({
        kind: "count order",
        text: hit.text,
        at: hit.where,
        words: [
          `${hit.first} comes first; ${LOCALE} puts ${LABEL_FIRST ? "the word" : "the number"} first`,
        ],
      });
    }
    return findingsHere;
  };

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
        /* Two stripping orders, and only what survives both is foreign. Each order has a
           blind spot: vault words first let a tag named `mcp` bite the middle out of
           “.mcp.json” (leaving “json”); fixed tokens first let /\bv\d+\b/ bite “v2” out
           of the handle “v2-rearchitect” (leaving “rearchitect”). A real English word is
           whole under either order. */
        const vaultFirst = foreignIn(item.text.replace(vaultToken, " "));
        const tokensFirst = foreignIn(residue(item.text).replace(vaultToken, " "));
        const words =
          vaultFirst && tokensFirst ? vaultFirst.filter((w) => tokensFirst.includes(w)) : null;
        if (!words || !words.length) continue;
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

      /* …and a fourth: which side of the word is the number on? (see COUNTED_KEYS) */
      for (const item of await orderProbe(page)) {
        bad += 1;
        findings.push({ screen: `${screen.name} @${width}`, ...item });
      }

      /* …and: is any monogram wearing a lowercase initial? (see MONOGRAM_PROBE) */
      for (const text of await page.evaluate(MONOGRAM_PROBE)) {
        bad += 1;
        findings.push({
          screen: `${screen.name} @${width}`,
          kind: "monogram case",
          text,
          at: ".agent-avatar",
          words: ["a Latin initial is uppercase — every other monogram in this app is"],
        });
      }

      /* …and a fifth: is every Korean word on this screen still whole? The width sweep below
         asks the same question harder, but only of the screens that reflow; this asks it of
         every screen and every record in the vault, at the two widths already loaded. Both
         languages: a Korean sentence quoted inside an English record is Korean, and the line
         breaker does not know which window it is in. */
      for (const item of await page.evaluate(BREAK_PROBE, {
        counters: [],
        words: [],
        exempt: BREAKABLE,
        hangul: true,
      })) {
        bad += 1;
        findings.push({
          screen: `${screen.name} @${width}`,
          kind: "word split",
          text: item.context,
          at: item.at,
          words: [`“${item.pair}” is broken across two lines — a word lost a syllable`],
        });
      }
      if (VERBOSE || bad) log(`${screen.name} @${width}: ${printed.length} strings, ${bad} bad`);
    }
  };

  if (!SWEEP_ONLY) {
    const page = await browser.newPage(VIEW);
    await useLocale(page, LOCALE);
    await walk(page, screens, WIDE);

    // Its own session, because `?dirs=` sticks to the one it is opened in.
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
      screens.filter((s) => /^(bugs|work|notes|dashboard) /.test(s.name)),
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
   * pair to split, and a sweep with nothing to find is a minute of gate time saying nothing.
   *
   * The same readings answer the word-order question (COUNTED_KEYS): the critic photographed
   * the tooltip at 1440, so the sweep opens the dashboard's tips at every width in the list
   * rather than trusting that word order is a thing that cannot depend on layout. */
  /**
   * One vault, swept at every width. `where` names it in the findings, because "@1200" over
   * a body nobody recognises is not a place somebody can go and look.
   */
  const sweep = async (origin, sweepProjects, where, { fixture = false } = {}) => {
    /* A vault with no resolved bug in it cannot answer the resolution card's question, and
       the sweep says so rather than walking one screen fewer and reporting clean. This is
       the shape of the hole that hid the 해결 내용 header for two rounds: the screen was
       never opened, so nothing failed (P9 round 8 critic), and it is the same lesson
       FILLED_PROBE was written for one box further in. */
    if (!sweepProjects.some((p) => p.resolvedBug)) {
      findings.push({
        screen: `${where}(vault)`,
        kind: "fixture gap",
        text: "no project in this vault has a bug with a resolution",
        at: ".outcome-card.is-resolution",
        words: [
          "the resolution card is never rendered, so the one box in the app that prints a " +
            "date and two durations is never read at any width",
        ],
      });
    }
    for (const width of SWEEP_WIDTHS) {
      const ctx = await browser.newContext(view(width));
      await useLocale(ctx, LOCALE);
      const sweepPage = await ctx.newPage();
      for (const screen of SWEEP_SCREENS(sweepProjects)) {
        const at = `${where}${screen.name} @${width}`;
        await sweepPage.goto(`${origin}${screen.path}`, { waitUntil: "domcontentloaded" });
        if (screen.prepare) await screen.prepare(sweepPage);
        await sweepPage.waitForSelector(screen.wait, { state: "visible", timeout: 15_000 });
        await sweepPage.waitForFunction(() => !document.querySelector(".skeleton"));
        await sweepPage.evaluate(() => document.fonts.ready);
        /* Is the question being answered at all? (see FILLED_PROBE) — once per screen, at the
           first width, because "does this box hold Korean" is a fact about the fixture and
           not about the layout. */
        if (fixture && screen.filled && width === SWEEP_WIDTHS[0]) {
          for (const sel of await sweepPage.evaluate(FILLED_PROBE, screen.filled)) {
            findings.push({
              screen: at,
              kind: "fixture gap",
              text: `${sel} holds no Korean on this screen`,
              at: sel,
              words: [
                "the Korean-content vault stopped filling a surface this sweep reads — " +
                  "a line-break question asked of an empty box passes without being answered " +
                  "(scripts/ko-vault.mjs)",
              ],
            });
          }
        }
        /* …and the monogram beside every Korean handle, once per screen for the same reason:
           case is not a function of the viewport. The live vault has no mixed handle in it —
           this is the question only the Korean fixture can answer (see MONOGRAM_PROBE). */
        if (width === SWEEP_WIDTHS[0]) {
          for (const text of await sweepPage.evaluate(MONOGRAM_PROBE)) {
            findings.push({
              screen: at,
              kind: "monogram case",
              text,
              at: ".agent-avatar",
              words: ["a Latin initial is uppercase — every other monogram in this app is"],
            });
          }
        }
        const broken = [
          // The app's own counted words and its numbers, minus what the author wrote.
          ...(await sweepPage.evaluate(BREAK_PROBE, {
            counters: COUNTERS,
            words: wholeWords,
            exempt: AUTHOR,
            hangul: false,
          })),
          // Every Korean word on the screen, the record's own included (see BREAKABLE).
          ...(await sweepPage.evaluate(BREAK_PROBE, {
            counters: [],
            words: [],
            exempt: BREAKABLE,
            hangul: true,
          })),
        ];
        swept += 1;
        for (const item of broken) {
          findings.push({
            screen: at,
            kind: "word split",
            text: item.context,
            at: item.at,
            words: [
              `“${item.pair}” is broken across two lines — ` +
                (/\d/.test(item.pair) ? "a counter left its number" : "a word lost a syllable"),
            ],
          });
        }
        const misordered = await orderProbe(sweepPage);
        for (const item of misordered) findings.push({ screen: at, ...item });
        if (VERBOSE || broken.length || misordered.length) {
          log(
            `${at}: ${broken.length} split word(s), ${misordered.length} misordered count(s)`,
          );
        }
      }
      await ctx.close();
    }
  };

  if (LOCALE === "ko") {
    await sweep(ORIGIN, sweepProjects, "");

    /* ---- and again over a vault whose *records* are Korean --------------------
     *
     * Everything above reads this repo's own vault, and this repo writes its records in
     * English. So five rounds of Korean review read Korean chrome over English data, and the
     * question "what does this app do to a Korean paragraph" was one no gate here could ask:
     * `.prose`, `.feed-summary`, `.project-desc` and `.now-row-title` held English, which
     * breaks at spaces that were already there (P9 round 6 critic).
     *
     * So the sweep is run a second time against a vault built for it with the release CLI —
     * Korean project names and descriptions, Korean titles, Korean ## What/## Why/## How,
     * progress notes, outcomes, bug reports and resolutions, and Korean agent handles
     * (scripts/ko-vault.mjs). Built rather than committed, in a temp directory that is
     * deleted at the end, on its own dev server: the live vault is never pointed at, written
     * to or read by anything but the walk above. */
    const koBase = mkdtempSync(join(tmpdir(), "agentmon-ko-"));
    temps.push(koBase);
    log(`building Korean-content projects with the release CLI in ${koBase}…`);
    const koDirs = buildKoreanProjects(koBase);
    koServer = startServer(KO_PORT, {
      env: { AGENTMON_DIRS: koDirs.join(";"), AGENTMON_REGISTRY_DIR: join(koBase, ".registry") },
    });
    const koOrigin = `http://localhost:${KO_PORT}`;
    await waitForServer(koServer, koOrigin);
    const koProjects = [];
    const koRows = await (await fetch(`${koOrigin}/project-api/projects`)).json();
    for (const p of koRows.filter((r) => r.available && r.project).map((r) => r.project)) {
      const works = await (await fetch(`${koOrigin}/project-api/projects/${p.id}/worklogs`)).json();
      const bugs = await (await fetch(`${koOrigin}/project-api/projects/${p.id}/bugs`)).json();
      const notes = await (await fetch(`${koOrigin}/project-api/projects/${p.id}/notes`)).json();
      koProjects.push({
        slug: p.id,
        work: works[0]?.id ?? null,
        bug: bugs[0]?.id ?? null,
        note: (notes.find((n) => n.refs?.length) ?? notes[0])?.name ?? null,
        resolvedBug: await resolvedBugIn(koOrigin, p.id, bugs),
      });
    }
    await sweep(koOrigin, koProjects, "ko-fixture ", { fixture: true });
  }

  if (findings.length) {
    failures = findings.length;
    /* Six kinds of finding now: a string in the wrong language; a string that is in the
       right language and is not a word; a word the line breaker cut off its number; a number
       standing on the wrong side of its word; a monogram wearing a lowercase initial; and a
       surface the Korean fixture stopped filling, which is the gate reporting that it could
       not ask. Counted apart, because "3 English strings" over a list of Korean fragments is
       the gate misreporting its own result. */
    const split = findings.filter((f) => f.kind === "word split").length;
    const order = findings.filter((f) => /word order|count order/.test(f.kind)).length;
    const gaps = findings.filter((f) => f.kind === "fixture gap").length;
    const cased = findings.filter((f) => f.kind === "monogram case").length;
    const foreign = findings.filter(
      (f) =>
        !/vocabulary|short form|word split|word order|count order|fixture gap|monogram case/.test(
          f.kind,
        ),
    ).length;
    const parts = [];
    if (foreign) parts.push(`${foreign} ${OTHER} string(s)`);
    if (findings.length - foreign - split - order - gaps - cased) {
      parts.push(`${findings.length - foreign - split - order - gaps - cased} not in the vocabulary`);
    }
    if (split) parts.push(`${split} word(s) split across a line break`);
    if (order) parts.push(`${order} count(s) on the wrong side of their word`);
    if (cased) parts.push(`${cased} monogram(s) wearing a lowercase initial`);
    if (gaps) parts.push(`${gaps} surface(s) the Korean fixture no longer fills`);
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
  if (koServer) await stopServer(koServer);
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

const span = `${SWEEP_WIDTHS[0]}–${SWEEP_WIDTHS[SWEEP_WIDTHS.length - 1]}px`;
const sweepNote =
  LOCALE === "ko"
    ? `, and whole and correctly ordered across ${swept} readings at ${SWEEP_WIDTHS.length} widths ${span} on this vault and on a Korean-content one`
    : " (the width sweep is Korean's; English breaks at spaces)";
log(
  failures !== 0
    ? `${failures} finding(s) on ${checked} screens and ${swept} sweep readings`
    : SWEEP_ONLY
      ? `clean: ${swept} readings at ${SWEEP_WIDTHS.length} widths ${span} — no word lost a syllable, no number was parted from its counter, and none stood in front of its word`
      : `clean: ${checked} screens at ${WIDE}px and ${NARROW}px — every word the app printed is ${LOCALE}, is a word, and counts on the side ${LOCALE} counts on${sweepNote}`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
