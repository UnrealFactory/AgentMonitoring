#!/usr/bin/env node
/**
 * Hold every control on the two triage screens to the number printed on it.
 *
 *   npm run check:counts
 *   node scripts/check-counts.mjs [--port 5173] [--url ORIGIN] [--project relay]
 *
 * One rule, checked by clicking: **a number a control offers is the number of rows you get
 * after choosing it.** Not the project total — the rows, here, with every other filter still
 * on. Round 3 shipped a board whose severity menu said "Critical 2" while the chip row 40px
 * below said "Critical 0", and choosing Critical emptied the screen. Both numbers were on
 * screen at once; nothing warned the reader which one was lying.
 *
 * That failure is invisible to a screenshot and to a type checker, so it gets a gate. For
 * every project, on both screens, in several filter states, this walks every tab, every
 * severity chip and every option of every filter menu:
 *
 *   read the number  →  click the control  →  count the rows  →  compare  →  put it back
 *
 * A control already holding the value it offers is not clicked (that is the view already on
 * screen); its number is compared against the rows in front of it. "N matches" in the filter
 * summary is checked the same way, against the same rows.
 *
 * Boots its own dev server when none is listening. A builder's tool, not part of the app.
 */
import { chromium } from "playwright";
import { ensureServer, stopServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--help") || flag("-h")) {
  console.log(`Check that every count on a filter control matches the rows choosing it gives.

  npm run check:counts
  node scripts/check-counts.mjs --project relay

Options:
  --project <slug>   only this project (default: every project in the vault)
  --port <n>         dev-server port to boot on / check against (default 5173)
  --url <origin>     check an already-running server instead of booting one
  --verbose          print every control probed, not only the failures`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const WANT_PROJECT = (value("--project", "") || "").trim();
const VERBOSE = flag("--verbose");

const log = (...m) => console.log("[check-counts]", ...m);

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET /vault-api${path} -> ${res.status}`);
  return res.json();
};

let failures = 0;
let probes = 0;
const fail = (where, detail) => {
  failures += 1;
  console.error(`  MISMATCH ${where}\n           ${detail}`);
};
const pass = (where, detail) => {
  probes += 1;
  if (VERBOSE) console.log(`  ok       ${where}  ${detail}`);
};

// -- driving the app ----------------------------------------------------------------------

const ready = async (page) => {
  await page.waitForSelector(".page-title", { state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
};

/** Rows on screen. Zero is a real answer: the empty state replaces the list entirely. */
const rows = (page) => page.locator(".work-rows .work-row").count();

/**
 * The filter state is the query string, so waiting for it is waiting for the render that
 * produced it — no sleeps, no "did React flush yet".
 */
const settled = (page, key, expected) =>
  page.waitForFunction(
    ([k, v]) => new URLSearchParams(location.search).get(k) === v,
    [key, expected],
    { timeout: 5000 },
  );

const number = (text) => {
  const m = /-?\d+/.exec(text ?? "");
  return m ? Number(m[0]) : null;
};

/**
 * Every control on the screen worth checking, described the same way: which query parameter
 * it writes, what it offers, and how to choose one of them.
 */
const CONTROLS = {
  /**
   * Tabs and severity chips: one flat row of buttons, each with its count inside it.
   * `toggle` is the chip row, where the row has no "all" button of its own — clicking the
   * active chip is how a reader turns the filter off, so that is how this puts it back.
   */
  buttons: (page, { key, selector, countSelector, activeClass, deflt, toggle = false }) => ({
    key,
    deflt,
    read: () =>
      page.locator(selector).evaluateAll(
        (els, [countSel, active]) =>
          els.map((el) => ({
            value: el.dataset.value,
            label: (el.textContent || "").trim(),
            count: (el.querySelector(countSel)?.textContent || "").trim(),
            active: el.classList.contains(active) || el.getAttribute("aria-selected") === "true",
          })),
        [countSelector, activeClass],
      ),
    choose: async (v) => {
      if (toggle && v === deflt) {
        const active = page.locator(`${selector}.${activeClass}`);
        if (await active.count()) await active.click();
        return;
      }
      await page.locator(`${selector}[data-value="${v}"]`).click();
    },
  }),

  /** A filter menu: open it, read every option, click one. */
  menu: (page, { key, label, deflt }) => {
    const button = page.locator(`button.select-button[aria-label="${label}"]`);
    return {
      key,
      deflt,
      read: async () => {
        await button.click();
        const options = await page.locator(".select-menu .select-option").evaluateAll((els) =>
          els.map((el) => ({
            value: el.dataset.value,
            label: (el.querySelector(".select-option-label")?.textContent || "").trim(),
            count: (el.querySelector(".select-option-hint")?.textContent || "").trim(),
            active: el.getAttribute("aria-selected") === "true",
          })),
        );
        // Closed by clicking the button again rather than by Escape: Escape is also the
        // list's "clear the search box", and this must not change the state it is reading.
        await button.click();
        await page.locator(".select-menu").waitFor({ state: "detached" });
        return options;
      },
      choose: async (v) => {
        await button.click();
        await page.locator(`.select-menu .select-option[data-value="${v}"]`).click();
      },
    };
  },
};

/**
 * Walk one control in one filter state.
 *
 * `current` is the value the state holds for this control, so the probe can put it back
 * without a reload, and can recognise the option that is already selected.
 */
async function probeControl(page, control, where, current, baseRows) {
  const options = await control.read();
  for (const o of options) {
    if (!o.value) continue;
    const offered = number(o.count);
    if (offered === null) continue; // "All severities" and friends print no number

    const name = `${where} · ${control.key}=${o.value}`;
    if (o.active) {
      // Already the view on screen: the number has to be the rows in front of the reader.
      if (offered !== baseRows) {
        fail(name, `the selected option says ${offered}; the screen holds ${baseRows} row(s)`);
      } else {
        pass(name, `${offered} (already selected)`);
      }
      continue;
    }

    await control.choose(o.value);
    await settled(page, control.key, o.value === control.deflt ? null : o.value);
    const got = await rows(page);
    if (got !== offered) {
      fail(name, `the control offers ${offered}; choosing it gives ${got} row(s)`);
    } else {
      pass(name, `${offered}`);
    }

    // Back to the state this probe started from, by the same route a reader would take.
    await control.choose(current);
    await settled(page, control.key, current === control.deflt ? null : current);
    const restored = await rows(page);
    if (restored !== baseRows) {
      throw new Error(
        `restoring ${control.key}=${current} left ${restored} rows, not the ${baseRows} it started with`,
      );
    }
  }
}

/** The "N matches" line, when filters are on, against the rows underneath it. */
async function probeSummary(page, where, baseRows) {
  const el = page.locator(".filter-count");
  if (!(await el.count())) return;
  const said = number(await el.textContent());
  if (said !== baseRows) {
    fail(`${where} · filter summary`, `says ${said}; the screen holds ${baseRows} row(s)`);
  } else {
    pass(`${where} · filter summary`, `${said} matches`);
  }
}

/** The board prints its severity numbers twice — the chip row and the menu must agree. */
async function probeSeverityAgreement(page, where) {
  const chips = await page
    .locator(".sev-chip")
    .evaluateAll((els) =>
      els.map((el) => `${el.dataset.value}=${(el.querySelector(".sev-chip-count")?.textContent || "").trim()}`),
    );
  const menu = CONTROLS.menu(page, { key: "severity", label: "Filter by severity", deflt: "all" });
  const options = (await menu.read())
    .filter((o) => o.value !== "all")
    .map((o) => `${o.value}=${o.count}`);
  if (chips.join(" ") !== options.join(" ")) {
    fail(
      `${where} · severity is printed twice`,
      `chips: ${chips.join(" ")}\n           menu:  ${options.join(" ")}`,
    );
  } else {
    pass(`${where} · severity chips = severity menu`, chips.join(" "));
  }
}

// -- what to walk ---------------------------------------------------------------------------

/** A word from real data, so the query states are not vacuous. */
const token = (records) => {
  for (const r of records) {
    const m = /[a-z]{6,}/.exec((r.title || "").toLowerCase());
    if (m) return m[0];
  }
  return "the";
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
  const wanted = WANT_PROJECT ? projects.filter((p) => p.slug === WANT_PROJECT) : projects;
  if (!wanted.length) {
    throw new Error(
      `no project '${WANT_PROJECT}' in this vault. Known slugs: ${projects.map((p) => p.slug).join(", ")}`,
    );
  }

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  for (const p of wanted) {
    const bugs = await api(`/projects/${p.slug}/bugs`);
    const works = await api(`/projects/${p.slug}/worklogs`);

    /**
     * States chosen to make the filters interact: the default view, the dense one, one with
     * another filter already narrowing the board, and one with a search query — the four
     * shapes in which "the whole project" and "what is on screen" differ.
     */
    const screens = [
      {
        path: `/p/${p.slug}/bugs`,
        board: true,
        states: [
          { q: "", state: { tab: "unresolved" } },
          { q: "?tab=all", state: { tab: "all" } },
          { q: "?tab=all&severity=high", state: { tab: "all", severity: "high" } },
          {
            q: `?tab=all&q=${encodeURIComponent(token(bugs))}`,
            state: { tab: "all", q: token(bugs) },
          },
        ],
        controls: (page) => [
          CONTROLS.buttons(page, {
            key: "tab",
            selector: ".segmented .segment",
            countSelector: ".segment-count",
            activeClass: "is-active",
            deflt: "unresolved",
          }),
          CONTROLS.buttons(page, {
            key: "severity",
            selector: ".sev-bar .sev-chip",
            countSelector: ".sev-chip-count",
            activeClass: "is-active",
            deflt: "all",
            toggle: true,
          }),
          CONTROLS.menu(page, { key: "severity", label: "Filter by severity", deflt: "all" }),
          CONTROLS.menu(page, { key: "label", label: "Filter by label", deflt: "all" }),
          CONTROLS.menu(page, { key: "assignee", label: "Filter by assignee", deflt: "all" }),
          CONTROLS.menu(page, { key: "reporter", label: "Filter by reporter", deflt: "all" }),
        ],
      },
      {
        path: `/p/${p.slug}/work`,
        board: false,
        states: [
          { q: "", state: { status: "all" } },
          { q: "?status=done", state: { status: "done" } },
          { q: "?status=in_progress", state: { status: "in_progress" } },
          { q: `?q=${encodeURIComponent(token(works))}`, state: { status: "all", q: token(works) } },
        ],
        controls: (page) => [
          CONTROLS.buttons(page, {
            key: "status",
            selector: ".segmented .segment",
            countSelector: ".segment-count",
            activeClass: "is-active",
            deflt: "all",
          }),
          CONTROLS.menu(page, { key: "agent", label: "Filter by agent", deflt: "all" }),
          CONTROLS.menu(page, { key: "tag", label: "Filter by tag", deflt: "all" }),
        ],
      },
    ];

    for (const screen of screens) {
      for (const { q, state } of screen.states) {
        const where = `${screen.path}${q}`;
        await page.goto(`${ORIGIN}${screen.path}${q}`, { waitUntil: "domcontentloaded" });
        await ready(page);
        const baseRows = await rows(page);
        log(`${where} — ${baseRows} row(s)`);

        await probeSummary(page, where, baseRows);
        // The severity chips only exist once the board has bugs in it.
        if (screen.board && (await page.locator(".sev-bar").count())) {
          await probeSeverityAgreement(page, where);
        }
        for (const control of screen.controls(page)) {
          // A control whose row is not on screen (no chips on an empty project) is skipped.
          const current = state[control.key] ?? control.deflt;
          await probeControl(page, control, where, current, baseRows);
        }
      }
    }
  }
} catch (err) {
  failures += 1;
  console.error(`[check-counts] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}

log(
  failures === 0
    ? `clean: ${probes} control counts, every one of them the rows you get`
    : `${failures} control(s) print a number the screen does not honour (${probes} clean)`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
