#!/usr/bin/env node
/**
 * The boot read of settings.json must lose to the reader.
 *
 *   npm run check:locale
 *   node scripts/check-locale-race.mjs [-v]
 *
 * ## Why this gate exists
 *
 * `loadDesktopLocale()` in src/lib/i18n/index.ts is a long await run against a person who
 * can already see the language toggle. It used to apply what it read unconditionally, and
 * BUG-0026 is what that cost: a press inside the read window was thrown away, and thrown
 * away *unevenly* — `remember(saved)` put localStorage back on the file's value while
 * `persist: false` left settings.json holding the discarded press. The two stores then
 * disagreed, so the next window opened in one language and flipped to the other in front of
 * the reader.
 *
 * That is a race, and no screenshot gate can hold it still: `npm run check:i18n` walks the
 * rendered screens, but it presses the toggle long after boot, which is the one moment the
 * defect cannot happen in. So this gate drives the module itself, headless, with the clock
 * in its hand.
 *
 * ## What it drives
 *
 * The real `src/lib/i18n/index.ts` — imported through scripts/ts-hooks.mjs, not a copy —
 * and through it the real `src/lib/api.ts` and the real `@tauri-apps/api/core`. Only the
 * bottom of the stack is stubbed: a fake `window` carrying a Map-backed `localStorage` and
 * a `__TAURI_INTERNALS__.invoke` that stands in for the Rust side. `get_locale` **snapshots
 * the file when the command runs and answers milliseconds later**, which is the shape of
 * the bug: the value in flight predates the press it overwrites.
 *
 * Each case gets its own instance of the module (`?case=N` on the import), because the
 * locale, and the count of choices that guards it, are module state read once at load.
 *
 * ## What it requires
 *
 *   1. A press inside the read window wins — in the `import("../api")` await as well as in
 *      the `getLocale()` one — and the screen, localStorage and settings.json all end on it.
 *   2. With no press, the saved value is applied, and the two stores end up agreeing. When
 *      the file already agrees, no write is made at all.
 *   3. Everything outside the race is exactly as before: `?lang=` wins and does not let the
 *      file re-answer, browser mode never asks the desktop store, a missing or failed read
 *      leaves DEFAULT_LOCALE standing, and an ordinary press persists to both stores.
 *   4. **Never one store without the other.** Every desktop case ends with localStorage and
 *      settings.json holding the same language.
 */
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./ts-hooks.mjs", import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const I18N = pathToFileURL(join(here, "..", "src", "lib", "i18n", "index.ts")).href;
const STORAGE_KEY = "agentmon.locale";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Prove the settings.json boot read loses to a toggle press (BUG-0026).

  npm run check:locale
  node scripts/check-locale-race.mjs -v

Options:
  -v   print every check, not only the failing ones`);
  process.exit(0);
}
const VERBOSE = argv.includes("-v") || argv.includes("--verbose");
const log = (msg) => console.log(`[check-locale] ${msg}`);

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------------------
   A desktop window, minus the desktop
   ----------------------------------------------------------------------- */

/**
 * @param {object} o
 * @param {string|null} o.storage   what localStorage holds when the window opens
 * @param {string|null} o.settings  what settings.json holds
 * @param {string} [o.search]       the address bar's query string
 * @param {boolean} [o.tauri]       false = browser mode: no desktop store at all
 * @param {number} [o.readMs]       how long `get_locale` takes to answer
 * @param {number} [o.writeMs]      how long `set_locale` takes to reach the file
 * @param {boolean} [o.failRead]    `get_locale` rejects, as it does with no settings file
 */
function openWindow({
  storage = null,
  settings = null,
  search = "",
  tauri = true,
  readMs = 60,
  writeMs = 15,
  failRead = false,
}) {
  const store = new Map();
  if (storage !== null) store.set(STORAGE_KEY, storage);
  /** settings.json, as far as this module can tell. */
  const file = { locale: settings };
  const calls = [];
  const pending = [];

  const answerLater = (ms, produce) => {
    const p = new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(produce());
        } catch (err) {
          reject(err);
        }
      }, ms)
    );
    pending.push(p.catch(() => {}));
    return p;
  };

  const win = {
    location: { search },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => void store.set(key, String(value)),
      removeItem: (key) => void store.delete(key),
    },
  };

  if (tauri) {
    win.__TAURI_INTERNALS__ = {
      invoke(cmd, args) {
        calls.push(cmd);
        if (cmd === "get_locale") {
          if (failRead) return answerLater(readMs, () => { throw "no settings file"; });
          /* Read the file now, answer later — the value is already stale when it lands. */
          const snapshot = file.locale;
          return answerLater(readMs, () => snapshot);
        }
        if (cmd === "set_locale") {
          return answerLater(writeMs, () => {
            file.locale = args.locale;
            return null;
          });
        }
        return Promise.reject(`unexpected command ${cmd}`);
      },
    };
  }

  return {
    win,
    doc: { documentElement: { lang: "" } },
    file,
    calls,
    stored: () => (store.has(STORAGE_KEY) ? store.get(STORAGE_KEY) : null),
    /**
     * Let every answer still in flight land — including a write the press fired and left.
     * A `void saveLocaleToDesktop()` has two dynamic imports to get through before it even
     * reaches `invoke`, so quiet has to be seen twice before it counts as quiet.
     */
    settled: async () => {
      let quiet = 0;
      for (let round = 0; round < 40 && quiet < 2; round += 1) {
        await tick(0);
        if (pending.length) {
          quiet = 0;
          while (pending.length) await Promise.all(pending.splice(0));
        } else {
          quiet += 1;
        }
      }
    },
  };
}

/* --------------------------------------------------------------------------
   The run
   ----------------------------------------------------------------------- */

let failures = 0;
let checks = 0;
let cases = 0;

async function scenario(name, options, body) {
  cases += 1;
  const failedBefore = failures;
  const env = openWindow(options);
  globalThis.window = env.win;
  globalThis.document = env.doc;
  /* A fresh instance: the locale and the choice count are module state, read once at load. */
  const i18n = await import(`${I18N}?case=${cases}`);

  const check = (claim, ok, detail = "") => {
    checks += 1;
    if (ok) {
      if (VERBOSE) console.log(`  ok    ${name} · ${claim}`);
      return;
    }
    failures += 1;
    console.error(`  FAIL  ${name} · ${claim}${detail ? `\n        ${detail}` : ""}`);
  };

  /** The three places an answer can live, for the one-line summary each case prints. */
  const state = () => ({ screen: i18n.getLocale(), stored: env.stored(), file: env.file.locale });

  try {
    await body({ i18n, env, check, state });
    await env.settled();
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name} · threw\n        ${err?.stack ?? err}`);
  }

  if (!VERBOSE) {
    const s = state();
    const mark = failures === failedBefore ? "  ok" : "FAIL";
    console.log(
      `  ${mark}  ${name.padEnd(56)} screen=${String(s.screen).padEnd(4)} localStorage=${String(
        s.stored
      ).padEnd(5)} settings.json=${s.file}`
    );
  }
}

/** The invariant BUG-0026 broke: one language, in both places, whatever happened. */
const bothAgree = (check, env) =>
  check(
    "localStorage and settings.json hold the same language",
    env.stored() === env.file.locale,
    `localStorage=${env.stored()} settings.json=${env.file.locale}`
  );

log("driving src/lib/i18n/index.ts headless, with a stubbed settings.json");

/* 1. The reported defect, from the reader's side. */
await scenario(
  "a press while the file is being read wins",
  { storage: "ko", settings: "ko" },
  async ({ i18n, env, check }) => {
    const booted = i18n.loadDesktopLocale();
    await tick(15);
    check("the window opened on the stored language", i18n.getLocale() === "ko");
    i18n.setLocale("en"); // the toggle, mid-read
    await booted;
    await env.settled();
    check("the screen keeps the press", i18n.getLocale() === "en", `screen=${i18n.getLocale()}`);
    check("the page element follows it", env.doc.documentElement.lang === "en");
    check("localStorage holds the press", env.stored() === "en");
    check("settings.json holds the press", env.file.locale === "en");
    bothAgree(check, env);
  }
);

/* 2. The same press, one await earlier — before `get_locale` is even sent. The file's own
      write is slow enough here that the read still snapshots the old value. */
await scenario(
  "a press before the file is asked wins too",
  { storage: "ko", settings: "ko", writeMs: 45 },
  async ({ i18n, env, check }) => {
    const booted = i18n.loadDesktopLocale(); // still inside `await import("../api")`
    i18n.setLocale("en");
    await booted;
    await env.settled();
    check("the file was read all the same", env.calls.includes("get_locale"));
    check("and stood down", i18n.getLocale() === "en", `screen=${i18n.getLocale()}`);
    check("localStorage holds the press", env.stored() === "en");
    check("settings.json holds the press", env.file.locale === "en");
    bothAgree(check, env);
  }
);

/* 3. Nobody pressed: the file is the answer, and it reaches both stores. */
await scenario(
  "with no press the saved language is applied",
  { storage: null, settings: "en" },
  async ({ i18n, env, check }) => {
    check("the window opened on the default", i18n.getLocale() === i18n.DEFAULT_LOCALE);
    await i18n.loadDesktopLocale();
    await env.settled();
    check("the screen takes the saved language", i18n.getLocale() === "en");
    check("the page element follows it", env.doc.documentElement.lang === "en");
    check("it is mirrored into localStorage", env.stored() === "en");
    bothAgree(check, env);
  }
);

/* 4. …and when there is nothing to correct, nothing is written. */
await scenario(
  "a file that already agrees costs no write",
  { storage: "en", settings: "en" },
  async ({ i18n, env, check }) => {
    await i18n.loadDesktopLocale();
    await env.settled();
    check("the language is unchanged", i18n.getLocale() === "en");
    check("the file was read once", env.calls.filter((c) => c === "get_locale").length === 1);
    check("and never written", !env.calls.includes("set_locale"), env.calls.join(", "));
    bothAgree(check, env);
  }
);

/* 5. Outside the race, a press behaves exactly as it always did. */
await scenario(
  "a press after the read persists to both stores",
  { storage: "ko", settings: "ko" },
  async ({ i18n, env, check }) => {
    await i18n.loadDesktopLocale();
    await env.settled();
    i18n.setLocale("en");
    await env.settled();
    check("the screen changes", i18n.getLocale() === "en");
    check("localStorage is written", env.stored() === "en");
    check("settings.json is written", env.calls.includes("set_locale") && env.file.locale === "en");
    bothAgree(check, env);
  }
);

/* 6. `?lang=` still wins outright, and the file never gets to re-answer it. */
await scenario(
  "?lang= wins and the file is never asked",
  { storage: "ko", settings: "ko", search: "?lang=en" },
  async ({ i18n, env, check }) => {
    check("the address decided", i18n.getLocale() === "en");
    check("and survives the first navigation", env.stored() === "en");
    await i18n.loadDesktopLocale();
    await env.settled();
    check("the language is still the address's", i18n.getLocale() === "en");
    check("settings.json was not read", env.calls.length === 0, env.calls.join(", "));
    check("nor written", env.file.locale === "ko");
  }
);

/* 7. Browser mode has no desktop store; nothing in this path may reach for one. */
await scenario(
  "browser mode never reaches for the desktop store",
  { storage: "en", settings: "ko", tauri: false },
  async ({ i18n, env, check }) => {
    await i18n.loadDesktopLocale();
    await env.settled();
    check("the stored language stands", i18n.getLocale() === "en");
    i18n.setLocale("ko");
    await env.settled();
    check("a press still works", i18n.getLocale() === "ko" && env.stored() === "ko");
    check("and no command was ever sent", env.calls.length === 0, env.calls.join(", "));
  }
);

/* 8. No settings file yet — the first run of the app. */
await scenario(
  "a file with no language leaves the default standing",
  { storage: null, settings: null },
  async ({ i18n, env, check }) => {
    await i18n.loadDesktopLocale();
    await env.settled();
    check("the default stands", i18n.getLocale() === i18n.DEFAULT_LOCALE);
    check("and nothing was invented in localStorage", env.stored() === null, `${env.stored()}`);
    bothAgree(check, env);
  }
);

/* 9. …and an old build, where the command does not exist at all. */
await scenario(
  "a read that fails is survivable",
  { storage: null, settings: "en", failRead: true },
  async ({ i18n, env, check }) => {
    await i18n.loadDesktopLocale();
    await env.settled();
    check("the default stands", i18n.getLocale() === i18n.DEFAULT_LOCALE);
    check("localStorage was not touched", env.stored() === null);
  }
);

/* 10. Toggled away and back inside the read window: still a choice, counted not compared. */
await scenario(
  "toggling away and back still counts as choosing",
  { storage: "ko", settings: "ko" },
  async ({ i18n, env, check }) => {
    const booted = i18n.loadDesktopLocale();
    await tick(10);
    i18n.setLocale("en");
    i18n.setLocale("ko");
    await booted;
    await env.settled();
    check("the screen is where the reader left it", i18n.getLocale() === "ko");
    bothAgree(check, env);
  }
);

log(
  failures === 0
    ? `clean: ${checks} checks over ${cases} cases — the read loses to the reader`
    : `${failures} of ${checks} checks failed`
);
process.exit(failures === 0 ? 0 : 1);
