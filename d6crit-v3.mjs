/**
 * D6 desktop critic (v3, fresh pass) — the four checks against the REAL WebView2 window.
 *
 *   node d6crit-v3.mjs [ko|en]
 *
 * The app is launched as the desktop binary with
 * WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 (note
 * verify-desktop-via-cdp) and driven over CDP. Every screen grab is an OS grab of the app's
 * own HWND (d6crit-v2-shot.mjs), so a shot cannot be of a hidden window or a stale frame.
 *
 * 1  four record kinds — worklog, bug, note, app-feedback board: the Agent/사람 toggle is
 *    there, Human is what opens where there is a retelling, the human half draws beats +
 *    numbered landmarks + the lifted takeaway, and the agent half is the sectioned page.
 * 2  session persistence — pin Agent, walk (by clicking) to two records and back; and the
 *    empty box's escape must not rewrite the pin.
 * 3  ko and en (this file runs once per locale).
 * 4  the longest retelling at the shipped 1440x900: it scrolls and nothing is clipped.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { shot, wheelOver } from "./d6crit-v2-shot.mjs";

const LOCALE = (process.argv[2] || "ko").trim();
const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const LEGACY = "/p/prj-18cdc504775d1ea8"; // ElmwoodOnline — records older than the human area
const sfx = LOCALE === "ko" ? "-ko" : "-en";
const WORDS = LOCALE === "ko" ? { agent: "에이전트", human: "사람" } : { agent: "Agent", human: "Human" };

const report = [];
const fail = [];
const ok = (name, pass, detail) => {
  report.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) fail.push(`${name}${detail ? `: ${detail}` : ""}`);
};

class Reloaded extends Error {}

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const snap = async (name, forCheck) => {
  const s = await shot(page, name);
  if (!s.ok) ok(`${forCheck}: the grab is of the real window, now`, false, `${s.file} — ${s.note}`);
  else console.log(`      shot ${s.file} — ${s.note}`);
  return s.file;
};

const read = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const main = document.getElementById("main");
    const tabs = [...document.querySelectorAll('.view-toggle [role="tab"]')];
    return {
      href: location.pathname,
      lang: document.documentElement.lang,
      spa: window.__d6v3 ?? null,
      toggle: !!q(".view-toggle"),
      toggleLabel: q(".view-toggle")?.getAttribute("aria-label") ?? null,
      segments: tabs.map((b) => b.dataset.value + (b.getAttribute("aria-selected") === "true" ? "*" : "")),
      segText: tabs.map((b) => b.textContent.replace(/\s+/g, " ").trim()),
      segTips: tabs.map((b) => b.getAttribute("title") || b.getAttribute("aria-description") || ""),
      humanView: !!q(".human-view"),
      sheets: document.querySelectorAll(".human-sheet").length,
      humanEmpty: !!q(".human-empty"),
      humanNotice: !!q(".human-notice"),
      viewPeek: q(".view-peek")?.textContent.replace(/\s+/g, " ").trim().slice(0, 130) ?? null,
      beats: document.querySelectorAll(".human-beat").length,
      nums: [...document.querySelectorAll(".human-beat-num")].map((n) => n.textContent.trim()),
      leads: [...document.querySelectorAll(".human-beat-lead")].map((n) => n.textContent.trim().slice(0, 40)),
      lede: q(".human-lede")?.textContent.trim().slice(0, 70) ?? null,
      takeaway: q(".human-takeaway")?.textContent.trim() ?? null,
      foot: q(".human-foot")?.textContent.trim().slice(0, 80) ?? null,
      agentIds: ["what", "why", "how", "files", "outcome", "updates", "report", "thread", "resolution", "body"].filter(
        (id) => document.getElementById(id)
      ),
      rail: !!q(".side-card.contents"),
      feedbackRows: document.querySelectorAll(".feedback-row").length,
      feedbackHuman: document.querySelectorAll(".feedback-human").length,
      feedbackBodies: document.querySelectorAll(".feedback-body").length,
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

const plant = () => page.evaluate(() => (window.__d6v3 = "planted"));
const guard = async () => {
  const alive = (await page.evaluate(() => window.__d6v3 ?? null).catch(() => null)) === "planted";
  if (!alive) throw new Reloaded("the page reloaded mid-walk (vite HMR from another agent's write)");
};

const click = async (selector, waitFor) => {
  await page.locator(selector).first().click({ timeout: 15000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 });
  await page.waitForTimeout(450);
  await guard();
};
const press = (value, waitFor) => click(`.view-toggle [role="tab"][data-value="${value}"]`, waitFor);

async function goFresh(path, waitFor) {
  await page.goto(ORIGIN + path, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("agentmon.recordView");
    } catch {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(waitFor, { timeout: 20000 });
  await page.waitForTimeout(600);
  await plant();
}

/* The language is settled before anything is asserted: a press inside the boot window is
   thrown away (BUG-0026, filed against i18n boot, not the human area). */
async function settleLocale() {
  await page.goto(`${ORIGIN}${PRJ}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  await page.waitForTimeout(3000);
  if ((await page.evaluate(() => document.documentElement.lang)) !== LOCALE) {
    await page.locator(`.locale-toggle [data-value="${LOCALE}"]`).first().click();
    await page.waitForTimeout(2500);
  }
  return page.evaluate(() => document.documentElement.lang);
}

async function attempt(n) {
  console.log(`\n============ D6 critic v3 — ${LOCALE}, attempt ${n} ============`);
  report.length = 0;
  fail.length = 0;

  /* ------------------------------------------------- it is the desktop app */
  const env = await page.evaluate(async () => ({
    ua: navigator.userAgent,
    tauri: typeof window.__TAURI_INTERNALS__ === "object",
    visible: await window.__TAURI_INTERNALS__?.invoke("plugin:window|is_visible").catch((e) => "ERR " + e),
    title: document.title,
  }));
  ok(
    "0: this is the real desktop window, and it is on screen",
    env.tauri && env.visible === true && /WebView2|Edg\//.test(env.ua),
    `tauri=${env.tauri} is_visible=${env.visible} ua=${env.ua.slice(-60)}`
  );

  const lang = await settleLocale();
  ok(`3: the language toggle leaves the app in ${LOCALE}`, lang === LOCALE, `<html lang>=${lang}`);

  /* ------------------------------------------------------------- check 1 */
  const surfaces = [
    { key: "work", path: `${PRJ}/work/WORK-0018`, want: ["what", "why", "how", "outcome"], rail: true },
    { key: "bug", path: `${PRJ}/bugs/BUG-0009`, want: ["report"], rail: true },
    { key: "note", path: `${PRJ}/notes/human-area-enforcement`, want: ["body"], rail: false },
    { key: "feedback", path: `/app-feedback`, want: [], rail: false, board: true },
  ];

  for (const s of surfaces) {
    console.log(`\n[1] ${s.key} — ${s.path}`);
    await goFresh(s.path, ".human-sheet");
    const h = await read();
    ok(
      `1 ${s.key}: the Agent/${WORDS.human} toggle is on the screen, in ${LOCALE}`,
      h.toggle &&
        h.segments.length === 2 &&
        h.segText[0].startsWith(WORDS.agent) &&
        h.segText[1].startsWith(WORDS.human),
      `segments=${JSON.stringify(h.segments)} text=${JSON.stringify(h.segText)} label=${JSON.stringify(h.toggleLabel)}`
    );
    ok(
      `1 ${s.key}: Human is what opens, with nothing stored`,
      h.segments.includes("human*") && h.session === null && (s.board ? h.feedbackHuman > 0 : h.humanView),
      `humanView=${h.humanView} feedbackHuman=${h.feedbackHuman} session=${h.session}`
    );
    ok(
      `1 ${s.key}: beats carry numbered landmarks, 1..n`,
      h.beats >= 3 && h.nums.length === h.beats && h.nums.every((v, i) => v === String(i + 1)),
      `beats=${h.beats} nums=${h.nums.join(",")}`
    );
    ok(
      `1 ${s.key}: the takeaway is lifted out of the last beat`,
      !!h.takeaway && h.takeaway.length > 8,
      `"${(h.takeaway || "").slice(0, 70)}"`
    );
    console.log(`      lede=${JSON.stringify(h.lede)} foot=${JSON.stringify(h.foot)}`);
    console.log(`      leads=${JSON.stringify(h.leads.slice(0, 3))}`);
    await snap(`v3-1-${s.key}-human${sfx}`, `1 ${s.key}`);

    await press("agent", s.board ? ".feedback-row" : `#${s.want[0]}`);
    const a = await read();
    ok(
      `1 ${s.key}: the agent half is the sectioned page the app always drew`,
      !a.humanView &&
        a.sheets === 0 &&
        a.feedbackHuman === 0 &&
        s.want.every((id) => a.agentIds.includes(id)) &&
        (!s.rail || a.rail) &&
        (!s.board || a.feedbackRows > 0),
      `ids=${a.agentIds.join(",")} rail=${a.rail} sheets=${a.sheets} rows=${a.feedbackRows}`
    );
    ok(`1 ${s.key}: pressing a segment stores the choice`, a.session === "agent", `session=${a.session}`);
    await snap(`v3-1-${s.key}-agent${sfx}`, `1 ${s.key}`);
  }

  /* ------------------------------------------------- check 2: pin + walk */
  console.log(`\n[2] pin Agent on WORK-0018, walk to two records and back — by clicking`);
  await goFresh(`${PRJ}/work/WORK-0018`, ".human-sheet");
  let st = await read();
  ok("2: WORK-0018 opens on Human with nothing stored", st.humanView && st.session === null, `session=${st.session}`);
  await press("agent", "#what");
  st = await read();
  ok(
    "2: pressing Agent pins it",
    st.session === "agent" && !st.humanView && st.segments.includes("agent*"),
    `session=${st.session} segments=${JSON.stringify(st.segments)}`
  );
  await snap(`v3-2-a-pin-agent-work0018${sfx}`, "2");

  await click(`a[href="${PRJ}/bugs"]`, ".segmented");
  await click(`.segmented [role="tab"][data-value="all"]`, `a[href="${PRJ}/bugs/BUG-0009"]`);
  await click(`a[href="${PRJ}/bugs/BUG-0009"]`, ".view-toggle");
  st = await read();
  ok(
    "2: hop 1 — BUG-0009 opens on Agent",
    st.session === "agent" && !st.humanView && st.spa === "planted" && st.agentIds.includes("report"),
    `href=${st.href} humanView=${st.humanView} spa=${st.spa}`
  );
  await snap(`v3-2-b-hop1-bug0009${sfx}`, "2");

  await click(`a[href="${PRJ}/notes"]`, `a[href="${PRJ}/notes/human-area-enforcement"]`);
  await click(`a[href="${PRJ}/notes/human-area-enforcement"]`, ".view-toggle");
  st = await read();
  ok(
    "2: hop 2 — the note opens on Agent",
    st.session === "agent" && !st.humanView && st.spa === "planted" && st.agentIds.includes("body"),
    `href=${st.href} humanView=${st.humanView} spa=${st.spa}`
  );
  await snap(`v3-2-c-hop2-note${sfx}`, "2");

  await click(`a[href="${PRJ}/work"]`, `a[href="${PRJ}/work/WORK-0018"]`);
  await click(`a[href="${PRJ}/work/WORK-0018"]`, ".view-toggle");
  st = await read();
  ok(
    "2: back on WORK-0018 the pin still holds",
    st.session === "agent" && !st.humanView && st.spa === "planted" && st.agentIds.includes("what"),
    `href=${st.href} humanView=${st.humanView} spa=${st.spa}`
  );
  await snap(`v3-2-d-back-work0018${sfx}`, "2");

  /* --------------------------------------- check 2b: the empty-state escape */
  console.log(`\n[2b] the escape out of an un-retold record must not rewrite the pin`);
  await press("human", ".human-sheet");
  st = await read();
  ok("2b: the pin flips to Human", st.session === "human" && st.humanView, `session=${st.session}`);

  await click(`a[href="${LEGACY}"]`, "main");
  await click(`a[href="${LEGACY}/work"]`, `a[href^="${LEGACY}/work/WORK-"]`);
  const row = await page.locator(`a[href^="${LEGACY}/work/WORK-"]`).first().getAttribute("href");
  await click(`a[href="${row}"]`, ".view-toggle");
  st = await read();
  ok(
    "2b: a record with nothing retold answers with the empty box, not a silent swap",
    st.humanEmpty && st.session === "human" && st.spa === "planted",
    `href=${st.href} humanEmpty=${st.humanEmpty} session=${st.session}`
  );
  await snap(`v3-2-e-legacy-empty${sfx}`, "2b");

  const escapes = await page.locator(".human-empty-action button").count();
  if (escapes) await click(".human-empty-action button", ".view-peek");
  st = await read();
  ok(
    "2b: the escape shows this record's agent half and says so out loud",
    escapes > 0 && !st.humanView && !!st.viewPeek && st.agentIds.includes("what"),
    `peek=${JSON.stringify((st.viewPeek || "").slice(0, 80))}`
  );
  ok("2b: the escape did NOT rewrite the stored choice", st.session === "human", `session=${st.session}`);
  await snap(`v3-2-f-escape-peek${sfx}`, "2b");

  await click(`a[href="${PRJ}"]`, "main");
  await click(`a[href="${PRJ}/notes"]`, `a[href="${PRJ}/notes/record-screens-have-two-halves"]`);
  await click(`a[href="${PRJ}/notes/record-screens-have-two-halves"]`, ".view-toggle");
  st = await read();
  ok(
    "2b: the next record still opens on the pinned Human half",
    st.humanView && st.session === "human" && st.spa === "planted",
    `href=${st.href} humanView=${st.humanView} session=${st.session}`
  );
  await snap(`v3-2-g-after-escape-human${sfx}`, "2b");

  /* ----------------------------------- check 4: the long one, default size */
  console.log(`\n[4] the longest retelling (WORK-0018, ${4776} chars) at the shipped window size`);
  await click(`a[href="${PRJ}/work"]`, `a[href="${PRJ}/work/WORK-0018"]`);
  await click(`a[href="${PRJ}/work/WORK-0018"]`, ".human-sheet");
  st = await read();
  ok("4: the human half is up", st.humanView && st.sheets === 1 && st.beats >= 8, `beats=${st.beats}`);
  ok("4: the window is the shipped default", st.win[0] === 1440 && st.win[1] === 900, `inner=${st.win.join("x")}`);
  ok(
    "4: it is taller than the window, so it has to scroll",
    st.scroll.height > st.scroll.client + 200,
    `scrollHeight=${st.scroll.height} client=${st.scroll.client}`
  );
  ok("4: nothing overflows sideways", st.scroll.overflowX === 0, `scrollWidth-clientWidth=${st.scroll.overflowX}`);
  await snap(`v3-4-a-long-top${sfx}`, "4");

  const w = await wheelOver(page, 700, 500, -1200);
  ok("4: a wheel over the reading column moves it", w.top > 0, `scrollTop=${w.top} via ${w.how}`);
  await guard();
  await snap(`v3-4-b-long-middle${sfx}`, "4");

  const tail = await page.evaluate(() => {
    const main = document.getElementById("main");
    main.scrollTop = main.scrollHeight;
    return new Promise((r) =>
      setTimeout(() => {
        const box = (el) => (el ? el.getBoundingClientRect() : null);
        const take = document.querySelector(".human-takeaway");
        const foot = document.querySelector(".human-foot");
        const beats = [...document.querySelectorAll(".human-beat")];
        const sheet = document.querySelector(".human-sheet");
        const p = sheet?.querySelector("p");
        r({
          top: Math.round(main.scrollTop),
          atEnd: Math.abs(main.scrollTop + main.clientHeight - main.scrollHeight) < 4,
          takeawayOnScreen: !!take && box(take).top < main.clientHeight && box(take).bottom > 0,
          takeawayText: take?.textContent.trim().slice(0, 80) ?? null,
          footOnScreen: !!foot && box(foot).top < main.clientHeight,
          footText: foot?.textContent.trim().slice(0, 80) ?? null,
          lastBeat: beats.at(-1)?.querySelector(".human-beat-lead")?.textContent.trim().slice(0, 50) ?? null,
          clipped: [...document.querySelectorAll(".human-sheet *")].filter(
            (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible"
          ).length,
          measure: p ? Math.round(p.getBoundingClientRect().width) : null,
          font: p ? `${getComputedStyle(p).fontSize}/${getComputedStyle(p).lineHeight}` : null,
        });
      }, 500)
    );
  });
  await guard();
  ok("4: it scrolls to its own end", tail.atEnd, `scrollTop=${tail.top} lastBeat=${JSON.stringify(tail.lastBeat)}`);
  ok("4: the lifted takeaway is on screen at the end", tail.takeawayOnScreen, `"${tail.takeawayText}"`);
  ok("4: the byline closes it", tail.footOnScreen && !!tail.footText, `"${tail.footText}"`);
  ok("4: nothing inside the sheet is clipped sideways", tail.clipped === 0, `clipped=${tail.clipped}`);
  console.log(`      measure=${tail.measure}px font=${tail.font}`);
  await snap(`v3-4-c-long-end${sfx}`, "4");

  return true;
}

let done = false;
for (let n = 1; n <= 3 && !done; n++) {
  try {
    done = await attempt(n);
  } catch (e) {
    const why = String(e).split("\n")[0];
    if (e instanceof Reloaded || /Timeout|__d6v3|Target closed/.test(why)) {
      console.log(`\n  (attempt ${n} void: ${why}) — retrying`);
      await page.waitForTimeout(3000);
      continue;
    }
    throw e;
  }
}

console.log(`\n======== ${report.filter((r) => r.pass).length}/${report.length} passed (${LOCALE}) ========`);
if (!done) console.log("NOT COMPLETED: every attempt was voided by page reloads");
if (fail.length) {
  console.log("FAILURES:");
  for (const f of fail) console.log("  - " + f);
}
writeFileSync(`C:/Code/AgentMonitoring/progress/critic-d6/v3-report-${LOCALE}.json`, JSON.stringify({ locale: LOCALE, done, report }, null, 1));
await browser.close();
process.exit(!done || fail.length ? 1 : 0);
