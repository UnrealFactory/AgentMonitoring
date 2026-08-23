/**
 * D6 critic, checks 2 (session persistence, in-app), 3 (both locales) and 4 (a long
 * retelling at the default window size) — driven through the REAL desktop window over CDP.
 *
 *   node d6crit-run2.mjs [ko|en]
 *
 * Navigation here is by clicking what is on screen, never `goto`: the claim under test is
 * that a reader who pins one half keeps it while walking the app, and a reload is not a
 * walk. `window.__d6spa` is planted once and asserted after every hop — if it is gone, the
 * document was replaced and the hop was not in-app.
 *
 * Screenshots are grabs of the actual WebView2 HWND (scripts/win-window.ps1).
 */
import { chromium } from "playwright";
import { shot, wheel } from "./d6crit-shot.mjs";

const LOCALE = (process.argv[2] || "ko").trim();
const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const LEGACY = "/p/prj-18cdc504775d1ea8"; // ElmwoodOnline — no human areas anywhere
const SHOTS = "C:/Code/AgentMonitoring/progress/critic-d6";
const sfx = LOCALE === "ko" ? "" : "-en";

const report = [];
const fail = [];
const ok = (name, pass, detail) => {
  report.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) fail.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const read = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const main = document.getElementById("main");
    return {
      href: location.pathname + location.search,
      lang: document.documentElement.lang,
      spa: window.__d6spa ?? null,
      toggle: !!q(".view-toggle"),
      segments: [...document.querySelectorAll('.view-toggle [role="tab"]')].map((b) => ({
        v: b.dataset.value,
        text: b.textContent.trim(),
        selected: b.getAttribute("aria-selected") === "true",
      })),
      humanView: !!q(".human-view"),
      sheet: !!q(".human-sheet"),
      humanEmpty: !!q(".human-empty"),
      humanNotice: !!q(".human-notice"),
      viewPeek: q(".view-peek")?.textContent.trim().slice(0, 140) ?? null,
      beats: document.querySelectorAll(".human-beat").length,
      nums: [...document.querySelectorAll(".human-beat-num")].map((n) => n.textContent.trim()),
      takeaway: q(".human-takeaway")?.textContent.trim() ?? null,
      foot: q(".human-foot")?.textContent.trim() ?? null,
      rail: !!q(".side-card.contents"),
      agentIds: ["what", "why", "how", "files", "outcome", "updates", "report", "thread", "body"].filter((id) =>
        document.getElementById(id)
      ),
      session: (() => {
        try {
          return sessionStorage.getItem("agentmon.recordView");
        } catch {
          return "denied";
        }
      })(),
      scroll: main
        ? {
            top: Math.round(main.scrollTop),
            height: Math.round(main.scrollHeight),
            client: Math.round(main.clientHeight),
            overflowX: main.scrollWidth - main.clientWidth,
          }
        : null,
      win: [window.innerWidth, window.innerHeight],
    };
  });

const plant = () => page.evaluate(() => (window.__d6spa = "planted"));

const click = async (selector, waitFor) => {
  await page.locator(selector).first().click();
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 });
  await page.waitForTimeout(650);
};

const press = async (value) => click(`.view-toggle [role="tab"][data-value="${value}"]`);

/* ------------------------------------------------------------------ locale */
console.log(`\n=== D6 desktop critic, checks 2-4 — locale ${LOCALE} ===`);
await page.goto(`${ORIGIN}${PRJ}`, { waitUntil: "domcontentloaded" });
/* 2.5s, not 0.9: a press inside the first ~300ms of a window is undone by the boot read of
   settings.json (d6crit-locale-race2.mjs). This pass is about the four checks, so it waits
   out the defect rather than tripping over it. */
await page.waitForTimeout(2500);
const before = await page.evaluate(() => document.documentElement.lang);
if (before !== LOCALE) {
  await click(`.locale-toggle [data-value="${LOCALE}"]`);
}
{
  const st = await read();
  ok(`3: the locale toggle put the app in ${LOCALE}`, st.lang === LOCALE, `document.lang=${st.lang} (was ${before})`);
}

/* ------------------------------------------------------- check 2: the pin */
console.log(`\n[2] pin Agent, then walk the app`);
await page.goto(`${ORIGIN}${PRJ}/work/WORK-0018`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".view-toggle", { timeout: 15000 });
await page.evaluate(() => {
  try {
    sessionStorage.removeItem("agentmon.recordView");
  } catch {}
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".view-toggle", { timeout: 15000 });
await page.waitForTimeout(700);
await plant();

let st = await read();
ok("2: WORK-0018 opens on Human with no choice stored", st.humanView && st.session === null, `session=${st.session}`);
await press("agent");
st = await read();
ok(
  "2: pressing Agent pins it",
  st.session === "agent" && !st.humanView && st.segments.find((s) => s.v === "agent")?.selected === true,
  `session=${st.session} ids=${st.agentIds.join(",")} rail=${st.rail}`
);
const shotPin = shot(`2-a-pin-agent-work0018${sfx}`);

/* hop 1: the bug board (all tab, BUG-0009 is resolved) → BUG-0009 */
await click(`a[href="${PRJ}/bugs"]`, ".segmented");
await click(`.segmented [role="tab"][data-value="all"]`);
await click(`a[href="${PRJ}/bugs/BUG-0009"]`, ".view-toggle");
st = await read();
ok(
  "2: hop 1 (BUG-0009) held the pin, in-app",
  st.session === "agent" && !st.humanView && st.spa === "planted" && st.agentIds.includes("report"),
  `href=${st.href} session=${st.session} humanView=${st.humanView} spa=${st.spa}`
);
const shotHop1 = shot(`2-b-hop1-bug0009-agent${sfx}`);

/* hop 2: the notes board → a note that has a human area */
await click(`a[href="${PRJ}/notes"]`, ".segmented");
await click(`a[href="${PRJ}/notes/human-area-enforcement"]`, ".view-toggle");
st = await read();
ok(
  "2: hop 2 (note) held the pin, in-app",
  st.session === "agent" && !st.humanView && st.spa === "planted" && st.agentIds.includes("body"),
  `href=${st.href} session=${st.session} humanView=${st.humanView} spa=${st.spa}`
);
const shotHop2 = shot(`2-c-hop2-note-agent${sfx}`);

/* hop 3: back to WORK-0018 */
await click(`a[href="${PRJ}/work"]`, ".work-list, .segmented, main");
await click(`a[href="${PRJ}/work/WORK-0018"]`, ".view-toggle");
st = await read();
ok(
  "2: back on WORK-0018 the pin still holds, in-app",
  st.session === "agent" && !st.humanView && st.spa === "planted" && st.agentIds.includes("what"),
  `href=${st.href} session=${st.session} humanView=${st.humanView} spa=${st.spa}`
);
const shotBack = shot(`2-d-back-work0018-agent${sfx}`);

/* --------------------------------------------- check 2b: the empty escape */
console.log(`\n[2b] the empty-state escape must not rewrite the pin`);
await press("human");
st = await read();
ok("2b: pin flipped to Human", st.session === "human" && st.humanView, `session=${st.session}`);

/* walk to a legacy record — ElmwoodOnline, nothing retold */
await click(`a[href="${LEGACY}"]`, "main");
await click(`a[href="${LEGACY}/work"]`, "main");
const legacyRow = await page.locator(`a[href^="${LEGACY}/work/WORK-"]`).first().getAttribute("href");
await click(`a[href="${legacyRow}"]`, ".view-toggle");
st = await read();
ok(
  "2b: a legacy record answers the pin with the empty box (not a silent swap)",
  st.humanEmpty && st.session === "human" && st.spa === "planted",
  `href=${st.href} humanEmpty=${st.humanEmpty} session=${st.session}`
);
const shotEmpty = shot(`2-e-legacy-empty${sfx}`);

const escape = page.locator(".human-empty-action button");
const escapes = await escape.count();
if (escapes) await click(".human-empty-action button");
st = await read();
ok(
  "2b: the escape shows this record's agent half and says so",
  escapes > 0 && !st.humanView && !!st.viewPeek && st.agentIds.includes("what"),
  `peek=${JSON.stringify((st.viewPeek || "").slice(0, 90))}`
);
ok("2b: the escape did NOT rewrite the stored choice", st.session === "human", `session=${st.session}`);
const shotEscape = shot(`2-f-escape-peek${sfx}`);

/* the next record must open on the pinned half */
await click(`a[href="${PRJ}"]`, "main");
await click(`a[href="${PRJ}/notes"]`, ".segmented");
await click(`a[href="${PRJ}/notes/record-screens-have-two-halves"]`, ".view-toggle");
st = await read();
ok(
  "2b: the record after the escape still opens on the pinned Human half",
  st.humanView && st.session === "human" && st.spa === "planted",
  `href=${st.href} humanView=${st.humanView} session=${st.session}`
);
const shotAfter = shot(`2-g-after-escape-human${sfx}`);

/* ------------------------------------- check 4: a long retelling, default size */
console.log(`\n[4] the longest retelling at the default window size`);
await click(`a[href="${PRJ}/work"]`, "main");
await click(`a[href="${PRJ}/work/WORK-0018"]`, ".view-toggle");
await press("human");
st = await read();
ok("4: WORK-0018 human half is up", st.humanView && st.sheet, `beats=${st.beats}`);
ok(
  "4: the window is the shipped default",
  st.win[0] === 1440 && st.win[1] === 900,
  `inner=${st.win.join("x")} (tauri.conf.json 1440x900)`
);
ok(
  "4: it is longer than the window, so it must scroll",
  st.scroll.height > st.scroll.client + 200,
  `scrollHeight=${st.scroll.height} client=${st.scroll.client}`
);
ok("4: nothing overflows sideways", st.scroll.overflowX === 0, `scrollWidth-clientWidth=${st.scroll.overflowX}`);
const shotTop = shot(`4-a-long-top${sfx}`);

/* the real wheel, over the reading column, not scrollTop= */
console.log("      " + wheel(700, 500, -1200).split("\n").pop());
await page.waitForTimeout(700);
const midSt = await read();
ok("4: the wheel moves the reading column", midSt.scroll.top > 0, `scrollTop=${midSt.scroll.top}`);
const shotMid = shot(`4-b-long-middle${sfx}`);

/* to the end, and check the last beat + takeaway + byline are really reachable */
const tail = await page.evaluate(() => {
  const main = document.getElementById("main");
  main.scrollTop = main.scrollHeight;
  return new Promise((r) =>
    setTimeout(() => {
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      const take = document.querySelector(".human-takeaway");
      const foot = document.querySelector(".human-foot");
      const beats = [...document.querySelectorAll(".human-beat")];
      const last = beats[beats.length - 1];
      const sheet = document.querySelector(".human-sheet");
      const clipped = [...document.querySelectorAll(".human-sheet *")].filter(
        (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible"
      ).length;
      r({
        top: Math.round(main.scrollTop),
        atEnd: Math.abs(main.scrollTop + main.clientHeight - main.scrollHeight) < 4,
        takeaway: box(take) && box(take).top < main.clientHeight && box(take).bottom > 0,
        takeawayText: take?.textContent.trim().slice(0, 90) ?? null,
        foot: box(foot) && box(foot).top < main.clientHeight,
        footText: foot?.textContent.trim().slice(0, 90) ?? null,
        lastBeat: last?.querySelector(".human-beat-lead")?.textContent.trim().slice(0, 60) ?? null,
        sheetWidth: sheet ? Math.round(sheet.getBoundingClientRect().width) : null,
        mainWidth: document.querySelector(".detail-main")
          ? Math.round(document.querySelector(".detail-main").getBoundingClientRect().width)
          : null,
        measure: sheet ? Math.round(sheet.querySelector("p")?.getBoundingClientRect().width ?? 0) : null,
        fontSize: sheet ? getComputedStyle(sheet.querySelector("p") ?? sheet).fontSize : null,
        lineHeight: sheet ? getComputedStyle(sheet.querySelector("p") ?? sheet).lineHeight : null,
        clipped,
      });
    }, 500)
  );
});
ok("4: it scrolls to its own end", tail.atEnd, `scrollTop=${tail.top}`);
ok("4: the takeaway is reachable and on screen at the end", tail.takeaway, `"${tail.takeawayText}"`);
ok("4: the byline closes it", !!tail.footText, `"${tail.footText}"`);
ok("4: nothing inside the sheet is clipped horizontally", tail.clipped === 0, `clipped=${tail.clipped}`);
ok(
  "4: the sheet fills the record column (measure is padding, not max-width)",
  tail.sheetWidth === tail.mainWidth,
  `sheet=${tail.sheetWidth} main=${tail.mainWidth} measure=${tail.measure} font=${tail.fontSize}/${tail.lineHeight}`
);
const shotEnd = shot(`4-c-long-end${sfx}`);

console.log(
  `\nshots: ${shotPin} ${shotHop1} ${shotHop2} ${shotBack} ${shotEmpty} ${shotEscape} ${shotAfter} ${shotTop} ${shotMid} ${shotEnd}`
);
console.log(`\n=== ${report.filter((r) => r.pass).length}/${report.length} passed (${LOCALE}) ===`);
if (fail.length) {
  console.log("FAILURES:");
  for (const f of fail) console.log("  - " + f);
}
await browser.close();
process.exit(fail.length ? 1 : 0);
