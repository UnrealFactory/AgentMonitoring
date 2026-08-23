/**
 * D6 critic, checks 1 + 2, driven through the REAL desktop window over CDP.
 *
 *   node d6crit-run1.mjs [ko|en]
 *
 * Every screenshot is a grab of the actual WebView2 HWND (scripts/win-window.ps1), not a
 * headless render: the point of this pass is that it happened in the window people install.
 */
import { chromium } from "playwright";
import { shot } from "./d6crit-shot.mjs";

const LOCALE = (process.argv[2] || "ko").trim();
const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const LEGACY = "/p/prj-18cdc504775d1ea8"; // ElmwoodOnline — zero human areas, all legacy
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

/** Read everything the checks care about off the screen that is up. */
const read = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const main = document.getElementById("main");
    const sheets = [...document.querySelectorAll(".human-sheet")];
    return {
      href: location.href,
      lang: document.documentElement.lang,
      toggle: !!q(".view-toggle"),
      toggleLabel: q(".view-toggle")?.getAttribute("aria-label") ?? null,
      segments: [...document.querySelectorAll('.view-toggle [role="tab"]')].map((b) => ({
        v: b.dataset.value,
        text: b.textContent.trim(),
        selected: b.getAttribute("aria-selected") === "true",
      })),
      humanView: !!q(".human-view"),
      sheets: sheets.length,
      humanEmpty: !!q(".human-empty"),
      humanNotice: !!q(".human-notice"),
      viewPeek: q(".view-peek")?.textContent.trim().slice(0, 120) ?? null,
      beats: document.querySelectorAll(".human-beat").length,
      nums: [...document.querySelectorAll(".human-beat-num")].map((n) => n.textContent.trim()),
      leads: [...document.querySelectorAll(".human-beat-lead")].map((n) => n.textContent.trim().slice(0, 46)),
      lede: q(".human-lede")?.textContent.trim().slice(0, 80) ?? null,
      takeaway: q(".human-takeaway")?.textContent.trim() ?? null,
      figures: document.querySelectorAll(".human-sheet b.figure").length,
      foot: q(".human-foot")?.textContent.trim() ?? null,
      head: {
        title: q(".detail-title, .record-title, h1")?.textContent.trim().slice(0, 60) ?? null,
        id: q(".detail-id, .record-id")?.textContent.trim() ?? null,
      },
      agentIds: ["what", "why", "how", "files", "outcome", "updates", "report", "thread", "body", "resolution"].filter(
        (id) => document.getElementById(id)
      ),
      rail: !!q(".side-card.contents"),
      feedbackNone: document.querySelectorAll(".feedback-none").length,
      feedbackHuman: document.querySelectorAll(".feedback-human").length,
      feedbackRows: document.querySelectorAll(".feedback-list > *").length,
      session: (() => {
        try {
          return sessionStorage.getItem("agentmon.recordView");
        } catch {
          return "denied";
        }
      })(),
      scroll: main ? { top: main.scrollTop, height: main.scrollHeight, client: main.clientHeight } : null,
    };
  });

async function goFresh(path) {
  await page.goto(ORIGIN + path, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("agentmon.recordView");
    } catch {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".view-toggle", { timeout: 15000 });
  await page.waitForTimeout(700);
}

/** By the control in the sidebar, the way a reader changes it — not by writing storage. */
async function setLocale(loc) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  if ((await page.evaluate(() => document.documentElement.lang)) !== loc) {
    await page.locator(`.locale-toggle [data-value="${loc}"]`).first().click();
    await page.waitForTimeout(700);
  }
}

const press = async (value) => {
  await page.locator(`.view-toggle [role="tab"][data-value="${value}"]`).first().click();
  await page.waitForTimeout(500);
};

console.log(`\n=== D6 desktop critic — locale ${LOCALE} ===`);
await setLocale(LOCALE);
{
  const lang = await page.evaluate(() => document.documentElement.lang);
  ok("locale is " + LOCALE, lang === LOCALE, `document.lang=${lang}`);
}

/* ---------------------------------------------------------------- check 1 */
const surfaces = [
  { key: "work", path: `${PRJ}/work/WORK-0018`, agentWant: ["what", "why", "how"] },
  { key: "bug", path: `${PRJ}/bugs/BUG-0009`, agentWant: ["report"] },
  { key: "note", path: `${PRJ}/notes/human-area-enforcement`, agentWant: ["body"] },
  { key: "feedback", path: `/app-feedback`, agentWant: [] },
];

const agentSnapshots = {};
for (const s of surfaces) {
  console.log(`\n[1] ${s.key} — ${s.path}`);
  await goFresh(s.path);
  const h = await read();
  const file = shot(`1-${s.key}-human-default${sfx}`);
  ok(`${s.key}: toggle present`, h.toggle && h.segments.length === 2, `${file} segments=${JSON.stringify(h.segments.map((x) => x.v + (x.selected ? "*" : "")))}`);
  ok(`${s.key}: Human is the default view`, h.segments.find((x) => x.v === "human")?.selected === true && h.humanView, `${file} session=${h.session}`);
  if (s.key === "feedback") {
    ok(`${s.key}: board human half renders`, h.sheets >= 1 || h.humanNotice, `${file} sheets=${h.sheets} notice=${h.humanNotice}`);
  }
  ok(`${s.key}: beats + numbered landmarks`, h.beats >= 3 && h.nums.length === h.beats && h.nums[0] === "1" && h.nums[h.beats - 1] === String(h.beats), `${file} beats=${h.beats} nums=${h.nums.join(",")}`);
  ok(`${s.key}: lifted takeaway`, !!h.takeaway && h.takeaway.length > 8, `${file} "${(h.takeaway || "").slice(0, 70)}"`);
  ok(`${s.key}: session untouched by the default`, h.session === null, `session=${h.session}`);
  console.log(`      lede: ${JSON.stringify((h.lede || "").slice(0, 60))} figures=${h.figures} foot=${JSON.stringify(h.foot)}`);

  await press("agent");
  const a = await read();
  const afile = shot(`1-${s.key}-agent${sfx}`);
  agentSnapshots[s.key] = a;
  const wants = s.agentWant.every((id) => a.agentIds.includes(id));
  ok(`${s.key}: agent view renders its own sections`, !a.humanView && (s.key === "feedback" ? true : wants), `${afile} ids=${a.agentIds.join(",")} humanView=${a.humanView}`);
  /* The rail belongs to the agent half — on the two screens that ever had one. The note
     screen never drew one (it has one body, not sections; true before the toggle existed
     too, `git show 4bb67f4:src/pages/NoteDetailPage.tsx`), and a board has no rail at all. */
  const wantsRail = s.key === "work" || s.key === "bug";
  ok(
    `${s.key}: the agent half is the one the app always drew`,
    a.sheets === 0 && !a.humanEmpty && (s.key === "feedback" ? a.feedbackRows > 0 : true) && (!wantsRail || a.rail),
    `${afile} sheets=${a.sheets} rail=${a.rail}${wantsRail ? "" : " (never had one)"} rows=${a.feedbackRows}`
  );
  ok(`${s.key}: pressing a segment stores the choice`, a.session === "agent", `session=${a.session}`);
  if (s.key === "feedback")
    console.log(`      board: rows=${h.feedbackRows} retold=${h.feedbackHuman} none=${h.feedbackNone} notice=${h.humanNotice}`);
  console.log(`      toggle label: ${JSON.stringify(h.toggleLabel)} segments=${JSON.stringify(h.segments.map((x) => x.text))}`);
}

/* Checks 2, 3 and 4 live in d6crit-run2.mjs — this file is check 1 on the four surfaces. */

console.log(`
=== ${report.filter((r) => r.pass).length}/${report.length} passed (${LOCALE}) ===`);
if (fail.length) {
  console.log("FAILURES:");
  for (const f of fail) console.log("  - " + f);
}
await browser.close();
process.exit(fail.length ? 1 : 0);
