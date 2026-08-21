#!/usr/bin/env node
/**
 * Every way the records can say no, read through the app's own words — on **both
 * transports** where both can reach the condition.
 *
 *   npm run check:errors
 *   node scripts/check-errors.mjs [--port 5173] [--locale ko|en] [-v]
 *
 * ## Why this gate exists
 *
 * `npm run check:i18n` walks the rendered screens, which is the only way to catch a string
 * that never reaches the dictionary — but it drives the Vite dev server, and the dev server
 * is not the product. The desktop app calls `agentmon-core` in process, and core writes
 * clauses the middleware in `scripts/project-fs.mjs` does not:
 *
 *   record 'BUG-9999' not found in this project (expected file C:\…\BUG-9999.md)
 *   invalid id 'NOTANID': expected the form BUG-NNNN (e.g. BUG-0001)
 *
 * The hint clause and the whole `invalid id` shape exist only in Rust. No browser gate can
 * reach them. The desktop app also has no HTTP status to hand `failureTitle`, so a stale
 * link must classify off the *message* — this gate is what proves the two transports
 * cannot disagree about one condition.
 *
 * So each failure is provoked from the real `agentmon` binary and/or the dev server, then
 * both answers are read through the real `src/lib/api.ts` — not a copy — and the gate
 * requires that:
 *
 *   1. **The two transports say the same thing** where both can be asked. Same
 *      {@link failureKind}, same headline, same answer to "is there anything a retry could
 *      fix". A status is a fact about HTTP, not about a folder of records.
 *   2. **The app agrees with core.** `failureKind` matches `CoreError::kind()`, so a new
 *      variant in Rust cannot quietly land in "could not read the project".
 *   3. **Nothing arrives in the wrong language**, code spans and technical tokens aside.
 *   4. **The sentences are sentences.** A clause that ends and another that begins are
 *      separated by punctuation the reader can see.
 *
 * v2 note: two conditions are structurally one-transport. "No project found at <path>" is
 * how the CLI (and core, in the desktop app) reports a folder with no project — the app's
 * screens never see it, because the app reads by id off its registry. "No project with id
 * '<id>' is registered" is that registry sentence, and the CLI has no id lookup to provoke
 * it with. Each is checked on the transport that can produce it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureServer, stopServer, repoRoot } from "./dev-server.mjs";

register("./ts-hooks.mjs", import.meta.url);
const { failureKind, failureTitle, nothingToRetry, projectErrorMessage } = await import(
  "../src/lib/api.ts"
);
const { setLocale, LOCALES } = await import("../src/lib/i18n/index.ts");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--help") || flag("-h")) {
  console.log(`Read every backend failure through the app's words, on both transports.

  npm run check:errors
  node scripts/check-errors.mjs --locale ko -v

Options:
  --locale <ko|en>   check one language only (default: both)
  --port <n>         dev-server port to boot on / reuse (default 5173)
  --bin <path>       the agentmon binary (default target/release, then target/debug)
  -v                 print every sentence, not only the failing ones`);
  process.exit(0);
}

const VERBOSE = flag("-v") || flag("--verbose");
const PORT = Number(value("--port", "5173"));
const ORIGIN = `http://localhost:${PORT}`;
const LANGS = flag("--locale") ? [value("--locale", "ko")] : LOCALES;
/** The repo's own project folder — real data, and the id inside it. */
const DATA = join(repoRoot, "AgentMonitoring");
const PROJECT_ID = "prj-agent-monitoring";
const log = (msg) => console.log(`[check-errors] ${msg}`);

const exe = process.platform === "win32" ? "agentmon.exe" : "agentmon";
const BIN =
  value("--bin", null) ??
  [join(repoRoot, "target", "release", exe), join(repoRoot, "target", "debug", exe)].find(
    (p) => existsSync(p)
  );
if (!BIN) {
  console.error(
    "[check-errors] no agentmon binary — build it first:\n" +
      "  cargo build --release -p agentmon-cli"
  );
  process.exit(1);
}

/** A directory that exists and holds no project, for the CLI's own `--dir`. */
const EMPTY_DIR = mkdtempSync(join(tmpdir(), "agentmon-check-"));

/**
 * The failures a reader can actually reach.
 *
 * `cli` is what an agent (or the desktop app, through the same core) runs; `url` is the
 * route the browser build asks for in the same situation; `id` is the record id the
 * address carried, which the detail screens hand to `failureTitle`. `kind` is what
 * `CoreError::kind()` must call it — the third opinion, from Rust. A case with no `cli`
 * or no `url` is one only that transport can produce (see the header).
 */
const CASES = [
  {
    name: "stale bug link",
    cli: ["bug", "view", "BUG-9999"],
    url: `/project-api/projects/${PROJECT_ID}/bugs/BUG-9999`,
    id: "BUG-9999",
    kind: "record_not_found",
    expect: "no_record",
  },
  {
    name: "stale work link",
    cli: ["work", "view", "WORK-9999"],
    url: `/project-api/projects/${PROJECT_ID}/worklogs/WORK-9999`,
    id: "WORK-9999",
    kind: "record_not_found",
    expect: "no_record",
  },
  {
    name: "an id that cannot be a record",
    cli: ["bug", "view", "NOTANID"],
    url: `/project-api/projects/${PROJECT_ID}/bugs/NOTANID`,
    id: "NOTANID",
    kind: "invalid_argument",
    expect: "bad_address",
  },
  {
    name: "stale note link",
    cli: ["note", "view", "no-such-note"],
    url: `/project-api/projects/${PROJECT_ID}/notes/no-such-note`,
    id: "no-such-note",
    kind: "record_not_found",
    expect: "no_record",
  },
  {
    /* A note's address is a kebab name, so it has its own way of being unusable — and its
       own `expected the form …` clause, written twice (Rust and the JS twin) on purpose. */
    name: "a name that cannot be a note",
    cli: ["note", "view", "UPPER..bad"],
    url: `/project-api/projects/${PROJECT_ID}/notes/UPPER..bad`,
    id: "UPPER..bad",
    kind: "invalid_argument",
    expect: "bad_address",
  },
  {
    name: "a folder with no project (CLI)",
    cli: ["work", "list"],
    dir: EMPTY_DIR,
    id: null,
    kind: "project_not_found",
    expect: "no_project",
  },
  {
    name: "a project id not on this machine (app)",
    url: "/project-api/projects/prj-nobody-has-this/worklogs",
    id: null,
    kind: "project_not_found",
    expect: "no_project",
  },
];

/** What core calls a failure → what the app must call it. */
const KIND_MAP = {
  record_not_found: "no_record",
  project_not_found: "no_project",
  invalid_argument: "bad_address",
  invalid_project: "unreadable",
  io_error: "unreadable",
};

/** Ask the real binary. Returns core's own `{ kind, message }`. */
function askCli(testCase) {
  const argv = ["--json", "--dir", testCase.dir ?? DATA, ...testCase.cli];
  const run = spawnSync(BIN, argv, { encoding: "utf8" });
  if (run.error) throw new Error(`${BIN}: ${run.error.message}`);
  let parsed;
  try {
    // A failed run prints its envelope on stderr, where a shell pipeline expects it.
    parsed = JSON.parse(run.stderr || run.stdout);
  } catch {
    throw new Error(
      `agentmon --json printed no JSON for [${testCase.cli.join(" ")}]:\n${run.stdout}${run.stderr}`
    );
  }
  if (parsed.ok !== false || !parsed.error?.message) {
    throw new Error(`[${testCase.cli.join(" ")}] did not fail — the data has changed?`);
  }
  return { kind: parsed.error.kind, message: parsed.error.message };
}

/** Ask the dev server the same question. Returns `{ status, message }`. */
async function askServer(testCase) {
  const res = await fetch(`${ORIGIN}${testCase.url}`, { headers: { accept: "application/json" } });
  const text = await res.text();
  if (res.ok) throw new Error(`${testCase.url} answered ${res.status} — it was meant to fail`);
  let message = text;
  try {
    message = JSON.parse(text).error ?? text;
  } catch {
    /* keep the raw body, exactly as fetchJson does */
  }
  return { status: res.status, message };
}

/* --------------------------------------------------------------------------
   What a good sentence looks like
   ----------------------------------------------------------------------- */

/** Paths, ids and command lines are data: the dictionary marks them, so strip them out. */
const withoutCode = (text) => text.replace(/`[^`]*`/g, " ");

/**
 * Latin the app is right to print in Korean: the product's name (which is also the data
 * folder's name), the CLI's name, the initialisms Korean writes in Latin too, and any
 * record id — `BUG-9999` is the reader's own address, printed back to them. Anything else
 * outside a code span is a message that arrived untranslated.
 */
const ALLOWED = /\b(AgentMonitoring|agentmon|ID|UTC|API|CLI|JSON|project\.json|[A-Z]{2,}-\d+|prj-[a-z0-9-]+)\b/g;

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {string[]} data ids this failure was asked about: the app prints them back. */
const latinIn = (text, data = []) => {
  let rest = withoutCode(text).replace(ALLOWED, " ");
  for (const token of data) rest = rest.replace(new RegExp(escape(token), "g"), " ");
  return [...new Set(rest.match(/[A-Za-z][A-Za-z'._-]{1,}/g) ?? [])];
};

/**
 * Two clauses joined by nothing but a space.
 *
 * Korean: a `-습니다`/`-세요` ending is the end of a sentence, so the next word may not
 * simply follow it — `.`, `—`, `:` or `·` has to be visible between them. English: a code
 * span followed by a capitalised word is the same defect (`… has no \`BUG-9999\` Expected
 * the file …`). Both shipped, in the same string, in the same round.
 */
function runOn(text, locale) {
  const stripped = withoutCode(text);
  const rule =
    locale === "ko" ? /(?:습니다|하세요|세요)(?![.?!…])\s+[가-힣]/ : /[a-z)\]]\s+[A-Z][a-z]+/;
  const m = rule.exec(stripped);
  return m ? stripped.slice(Math.max(0, m.index - 24), m.index + 32).trim() : null;
}

/* --------------------------------------------------------------------------
   The run
   ----------------------------------------------------------------------- */

let server = null;
let failures = 0;
let checked = 0;
const fail = (where, detail) => {
  failures += 1;
  console.error(`  FAIL  ${where}\n        ${detail}`);
};

try {
  ({ server } = await ensureServer({ origin: ORIGIN, port: PORT, log }));
  log(`${CASES.length} failures × ${LANGS.length} language(s) · binary ${BIN}`);

  for (const testCase of CASES) {
    const desktop = testCase.cli ? askCli(testCase) : null;
    const browser = testCase.url ? await askServer(testCase) : null;
    checked += 1;

    /* 1. The app's classification agrees with core's own. */
    const want = KIND_MAP[testCase.kind];
    if (!want) fail(testCase.name, `core kind "${testCase.kind}" is not in KIND_MAP`);
    if (desktop && desktop.kind !== testCase.kind) {
      fail(`${testCase.name} · desktop`, `core kind is ${desktop.kind}, expected ${testCase.kind}`);
    }
    const gotDesktop = desktop ? failureKind(desktop.message, undefined) : null;
    const gotBrowser = browser ? failureKind(browser.message, browser.status) : null;
    for (const [side, got, message] of [
      ["desktop", gotDesktop, desktop?.message],
      ["browser", gotBrowser, browser?.message],
    ]) {
      if (got !== null && got !== testCase.expect) {
        fail(`${testCase.name} · ${side}`, `expected ${testCase.expect}, got ${got}\n        ${message}`);
      }
    }

    /* 2. The two transports answer the same condition the same way. */
    if (desktop && browser) {
      if (gotDesktop !== gotBrowser) {
        fail(
          `${testCase.name} · transports disagree`,
          `desktop (no status) → ${gotDesktop}; browser (${browser.status}) → ${gotBrowser}`
        );
      }
      if (
        nothingToRetry(desktop.message, undefined) !== nothingToRetry(browser.message, browser.status)
      ) {
        fail(
          `${testCase.name} · transports disagree`,
          "one of them offers a retry button and the other does not"
        );
      }
    }

    /* 3. Both sentences, in every language the app ships. */
    for (const locale of LANGS) {
      setLocale(locale, { persist: false });
      const cards = [];
      if (desktop) {
        cards.push(["desktop", failureTitle(desktop.message, undefined, testCase.id), projectErrorMessage(desktop.message), desktop.message]);
      }
      if (browser) {
        cards.push(["browser", failureTitle(browser.message, browser.status, testCase.id), projectErrorMessage(browser.message), browser.message]);
      }
      if (cards.length === 2 && cards[0][1] !== cards[1][1]) {
        fail(
          `${testCase.name} · ${locale} · headline`,
          `desktop: “${cards[0][1]}”\n        browser: “${cards[1][1]}”`
        );
      }
      for (const [side, title, body, raw] of cards) {
        const where = `${testCase.name} · ${locale} · ${side}`;
        if (body === raw) {
          fail(where, `nothing in src/lib/api.ts recognises this message:\n        ${body}`);
        }
        if (locale === "ko") {
          /* The address the reader asked for is data, wherever it came from: the id in the
             route. The app prints those back verbatim, in either language, exactly as it
             prints an agent handle or a tag (check-i18n.mjs). */
          const data = [testCase.id].filter(Boolean);
          const latin = [...latinIn(title, data), ...latinIn(body, data)];
          if (latin.length) fail(where, `English on a Korean screen: ${latin.join(", ")}`);
        }
        const joined = runOn(`${body}`, locale) ?? runOn(`${title}`, locale);
        if (joined) fail(where, `two clauses with no boundary between them: “…${joined}…”`);
        if (VERBOSE) {
          console.log(`  ${locale} ${side.padEnd(7)} ${title}`);
          console.log(`  ${" ".repeat(3 + 7)} ${body}`);
        }
      }
    }

    if (!VERBOSE) {
      setLocale("ko", { persist: false });
      const sample = desktop ?? browser;
      const got = gotDesktop ?? gotBrowser;
      console.log(
        `  ok  ${testCase.name.padEnd(38)} ${String(got).padEnd(11)} ${failureTitle(sample.message, browser?.status, testCase.id)}`
      );
      console.log(`      ${" ".repeat(38)} ${" ".repeat(11)} ${projectErrorMessage(sample.message)}`);
    }
  }
} catch (err) {
  failures += 1;
  console.error(`[check-errors] FAILED: ${err.stack ?? err.message}`);
} finally {
  if (server) await stopServer(server);
}

log(
  failures === 0
    ? `clean: ${checked} failures, ${LANGS.join(" + ")} — one condition, one sentence`
    : `${failures} problem(s) across ${checked} failures`
);
process.exit(failures === 0 ? 0 : 1);
