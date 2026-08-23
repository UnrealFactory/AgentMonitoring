/**
 * D6 (v2), check 3, the honest version: a REAL cold start of the desktop app.
 *
 * The race was measured inside one running window by reloading its document. A reader does
 * not reload; they launch the app. So: quit the app, launch the exe again with the debugging
 * port, attach as the window appears, and press the language toggle the way somebody would
 * who wants English — straight away.
 *
 * Screens here are captured two ways on purpose: the OS grab of the window (proof it is the
 * desktop window) costs ~2s and cannot catch a sub-second state, so the moments inside the
 * race are captured through CDP — still the real WebView2's own rendering of the real window.
 *
 *   node d6crit-v2-coldstart.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { shot } from "./d6crit-v2-shot.mjs";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const SHOTS = "C:/Code/AgentMonitoring/progress/critic-d6";
const SETTINGS = `${process.env.APPDATA}/com.agentmonitoring.app/settings.json`;
const disk = () => {
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf8")).locale ?? null;
  } catch {
    return null;
  }
};

/* wait for the freshly launched window to answer on the debugging port */
let browser = null;
for (let i = 0; i < 40 && !browser; i++) {
  try {
    browser = await chromium.connectOverCDP("http://localhost:9223");
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!browser) throw new Error("the app never opened the debugging port");
const page = browser.contexts()[0].pages()[0];

const lang = () => page.evaluate(() => document.documentElement.lang);
const store = () => page.evaluate(() => localStorage.getItem("agentmon.locale"));
const say = async (label) => console.log(`  ${label}: screen=${await lang()} localStorage=${await store()} settings.json=${disk()}`);

console.log(`\n=== a cold start of the desktop app; settings.json says ${disk()} ===`);
await page.waitForSelector(".locale-toggle", { timeout: 30000 });
console.log(`  the window is up at ${await page.evaluate(() => location.pathname)}`);
await say("at first paint");
await page.screenshot({ path: `${SHOTS}/v2-3-cold-1-opened.png` });

/* the press a reader makes the moment they see the wrong language */
await page.locator('.locale-toggle [data-value="en"]').first().click();
await page.waitForTimeout(120);
await say("120ms after pressing English");
await page.screenshot({ path: `${SHOTS}/v2-3-cold-2-pressed-english.png` });

await page.waitForTimeout(3000);
await say("3s later");
await page.screenshot({ path: `${SHOTS}/v2-3-cold-3-three-seconds-later.png` });
const held = (await lang()) === "en";
const split = (await store()) !== disk();
console.log(`  VERDICT: the press ${held ? "held" : "was DISCARDED"}; the two stores ${split ? "DISAGREE" : "agree"}`);

const s = await shot(page, "v2-3-cold-4-window-after-the-press");
console.log(`  window grab: ${s.file} ok=${s.ok} — ${s.note}`);

/* and what the reader gets when they open the app again: navigating is a new document, the
   same boot path the next launch takes */
if (split) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 20000 });
  const early = await lang();
  await page.screenshot({ path: `${SHOTS}/v2-3-cold-5-next-start-opens.png` });
  await page.waitForTimeout(3000);
  const late = await lang();
  await page.screenshot({ path: `${SHOTS}/v2-3-cold-6-next-start-flipped.png` });
  console.log(`  the next start opened in ${early} and turned ${late} under the reader`);
}

await browser.close();
