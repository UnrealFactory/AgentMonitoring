/**
 * D6: what the discarded press leaves behind.
 *
 * The press writes settings.json (the desktop's own memory) before it is undone, and the
 * undo rewrites localStorage instead. The two then disagree — so the *next* window opens in
 * the language the reader did not get, and changes to the one they asked for about half a
 * second in, under their eyes.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { shot } from "./d6crit-shot.mjs";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const SETTINGS = `${process.env.APPDATA}/com.agentmonitoring.app/settings.json`;
const file = () => {
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf8")).locale ?? null;
  } catch {
    return null;
  }
};

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

await page.addInitScript(() => {
  window.__langLog = [];
  const el = document.documentElement;
  window.__langLog.push({ at: 0, lang: el.lang });
  new MutationObserver(() => window.__langLog.push({ at: Math.round(performance.now()), lang: el.lang })).observe(el, {
    attributes: true,
    attributeFilter: ["lang"],
  });
});

const lang = () => page.evaluate(() => document.documentElement.lang);
const stored = () => page.evaluate(() => localStorage.getItem("agentmon.locale"));

/* 1. both memories agree on Korean */
await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".locale-toggle");
await page.waitForTimeout(2000);
if ((await lang()) !== "ko") {
  await page.locator('.locale-toggle [data-value="ko"]').click();
  await page.waitForTimeout(2000);
}
console.log(`1. settled: screen=${await lang()} localStorage=${await stored()} settings.json=${file()}`);

/* 2. a press inside the first half second */
await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".locale-toggle");
await page.locator('.locale-toggle [data-value="en"]').click();
await page.waitForTimeout(3000);
console.log(`2. after a discarded press for English: screen=${await lang()} localStorage=${await stored()} settings.json=${file()}`);

/* 3. the next window */
await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".locale-toggle");
const early = await lang();
const earlyShot = shot("3-y-next-window-opens-korean");
await page.waitForTimeout(3000);
const late = await lang();
const lateShot = shot("3-y-next-window-flips-english");
const log = await page.evaluate(() => window.__langLog);
console.log(`3. the next window opened in ${early} and settled on ${late}`);
console.log(`   lang timeline: ${JSON.stringify(log)}`);
console.log(`   evidence: ${earlyShot} then ${lateShot}`);
console.log(`   localStorage=${await stored()} settings.json=${file()}`);

await browser.close();
