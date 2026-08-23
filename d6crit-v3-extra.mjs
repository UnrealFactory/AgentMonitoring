/**
 * D6 critic v3 — the follow-ups the four-check pass does not cover, in the same real window.
 *
 *   node d6crit-v3-extra.mjs
 *
 * a  the other side of "Human is the default": a record with no retelling and no stored
 *    choice must open on the AGENT half, with its Human segment marked as having none.
 * b  the language toggle pressed while a retelling is on screen: the half survives, the
 *    chrome changes language, and the retelling is the author's text either way.
 * c  the segments answer the keyboard (← →), which is how the app says they are a tablist.
 * d  the pin survives a reload of the same window (sessionStorage scope; the desktop app
 *    reloads itself on update).
 */
import { chromium } from "playwright";
import { shot } from "./d6crit-v2-shot.mjs";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const LEGACY = "/p/prj-18cdc504775d1ea8";

const fail = [];
const ok = (name, pass, detail) => {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) fail.push(`${name}${detail ? `: ${detail}` : ""}`);
};

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const snap = async (name, forCheck) => {
  const s = await shot(page, name);
  if (!s.ok) ok(`${forCheck}: the grab is of the real window, now`, false, `${s.file} — ${s.note}`);
  else console.log(`      shot ${s.file} — ${s.note}`);
};

const read = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const tabs = [...document.querySelectorAll('.view-toggle [role="tab"]')];
    return {
      href: location.pathname,
      lang: document.documentElement.lang,
      segments: tabs.map((b) => b.dataset.value + (b.getAttribute("aria-selected") === "true" ? "*" : "")),
      segText: tabs.map((b) => b.textContent.replace(/\s+/g, " ").trim()),
      humanSegThin: tabs.some((b) => b.dataset.value === "human" && b.className.includes("is-thin")),
      humanSegTitle: tabs.find((b) => b.dataset.value === "human")?.getAttribute("title") ?? null,
      humanView: !!q(".human-view"),
      humanEmpty: !!q(".human-empty"),
      emptyTitle: q(".human-empty-title")?.textContent.trim() ?? null,
      sheets: document.querySelectorAll(".human-sheet").length,
      beats: document.querySelectorAll(".human-beat").length,
      lede: q(".human-lede")?.textContent.trim().slice(0, 60) ?? null,
      foot: q(".human-foot")?.textContent.trim().slice(0, 80) ?? null,
      crumb: q(".crumbs")?.textContent.replace(/\s+/g, " ").trim().slice(0, 60) ?? null,
      agentIds: ["what", "why", "how", "report", "body"].filter((id) => document.getElementById(id)),
      session: (() => {
        try {
          return sessionStorage.getItem("agentmon.recordView");
        } catch {
          return "denied";
        }
      })(),
      focus: document.activeElement?.dataset?.value ?? document.activeElement?.tagName ?? null,
    };
  });

async function goFresh(path, waitFor) {
  await page.goto(ORIGIN + path, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    try {
      sessionStorage.removeItem("agentmon.recordView");
    } catch {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(waitFor, { timeout: 20000 });
  await page.waitForTimeout(700);
}

/* ------------------------------------------------------------------- (a) */
console.log("\n[a] a record nobody retold, with nothing stored, opens on the agent half");
await goFresh(`${LEGACY}/work/WORK-0015`, ".view-toggle");
let st = await read();
ok(
  "a: no retelling + no stored choice → the agent half opens",
  st.segments.includes("agent*") && !st.humanView && !st.humanEmpty && st.agentIds.includes("what") && st.session === null,
  `segments=${JSON.stringify(st.segments)} humanEmpty=${st.humanEmpty} session=${st.session}`
);
ok(
  "a: the Human segment says on its face that this record has none",
  st.humanSegThin && !!st.humanSegTitle,
  `is-thin=${st.humanSegThin} title=${JSON.stringify(st.humanSegTitle)} text=${JSON.stringify(st.segText)}`
);
await snap("v3-5-a-legacy-default-agent", "a");

await page.locator('.view-toggle [role="tab"][data-value="human"]').first().click();
await page.waitForSelector(".human-empty", { timeout: 10000 });
await page.waitForTimeout(400);
st = await read();
ok(
  "a: pressing Human on it answers with the empty box, and stores the choice",
  st.humanEmpty && st.session === "human" && !!st.emptyTitle,
  `empty="${st.emptyTitle}" session=${st.session}`
);
await snap("v3-5-b-legacy-human-empty", "a");

/* ------------------------------------------------------------------- (b) */
console.log("\n[b] the language toggle pressed while a retelling is on screen");
await goFresh(`${PRJ}/bugs/BUG-0009`, ".human-sheet");
st = await read();
const before = { lang: st.lang, beats: st.beats, lede: st.lede, foot: st.foot };
ok("b: the retelling is up in the language the window is in", st.humanView && st.beats > 0, `lang=${st.lang} beats=${st.beats}`);
const other = st.lang === "ko" ? "en" : "ko";
await page.locator(`.locale-toggle [data-value="${other}"]`).first().click();
await page.waitForTimeout(1600);
st = await read();
ok(
  `b: after switching to ${other} the same half is still drawn`,
  st.lang === other && st.humanView && st.beats === before.beats,
  `lang=${st.lang} humanView=${st.humanView} beats=${st.beats} (was ${before.beats})`
);
ok(
  "b: the chrome changed language and the author's words did not",
  st.foot !== before.foot && st.lede === before.lede,
  `foot now ${JSON.stringify(st.foot)} (was ${JSON.stringify(before.foot)})`
);
await snap(`v3-5-c-locale-switch-${other}-keeps-human`, "b");
await page.locator(`.locale-toggle [data-value="${before.lang}"]`).first().click();
await page.waitForTimeout(1600);
st = await read();
ok(`b: and back to ${before.lang}`, st.lang === before.lang && st.humanView, `lang=${st.lang} humanView=${st.humanView}`);
await snap(`v3-5-d-locale-back-${before.lang}`, "b");

/* ------------------------------------------------------------------- (c) */
console.log("\n[c] the segments answer the keyboard");
await page.locator('.view-toggle [role="tab"][data-value="human"]').first().focus();
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(600);
st = await read();
ok(
  "c: ← moves to Agent and presses it",
  st.segments.includes("agent*") && !st.humanView && st.session === "agent",
  `segments=${JSON.stringify(st.segments)} focus=${st.focus} session=${st.session}`
);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(600);
st = await read();
ok(
  "c: → moves back to Human",
  st.segments.includes("human*") && st.humanView && st.session === "human",
  `segments=${JSON.stringify(st.segments)} session=${st.session}`
);

/* ------------------------------------------------------------------- (d) */
console.log("\n[d] the pin survives a reload of the same window");
await page.locator('.view-toggle [role="tab"][data-value="agent"]').first().click();
await page.waitForSelector("#report", { timeout: 10000 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".view-toggle", { timeout: 20000 });
await page.waitForTimeout(900);
st = await read();
ok(
  "d: after a reload the pinned Agent half is what opens",
  st.session === "agent" && !st.humanView && st.agentIds.includes("report"),
  `session=${st.session} humanView=${st.humanView}`
);
await snap("v3-5-e-pin-survives-reload", "d");

console.log(fail.length ? `\nFAILURES:\n  - ${fail.join("\n  - ")}` : "\nall follow-ups held");
await browser.close();
process.exit(fail.length ? 1 : 0);
