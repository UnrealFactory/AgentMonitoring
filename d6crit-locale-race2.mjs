/**
 * D6: the same race, isolated, with the desktop's own settings.json read at each step —
 * because the interesting part is not that the screen flips back, it is what the three
 * places that remember the language end up saying.
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
  } catch (e) {
    return "unreadable:" + String(e).slice(0, 40);
  }
};

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const state = async () => {
  const s = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    stored: (() => {
      try {
        return localStorage.getItem("agentmon.locale");
      } catch {
        return "denied";
      }
    })(),
    sidebar: document.querySelector(".locale-toggle")?.getAttribute("aria-label") ?? null,
    onSegment: [...document.querySelectorAll(".locale-toggle button")]
      .filter((b) => b.getAttribute("aria-pressed") === "true" || b.className.includes("is-on"))
      .map((b) => b.dataset.value),
  }));
  return { ...s, settingsJson: file() };
};

async function settle(loc) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle");
  await page.waitForTimeout(2500);
  if ((await page.evaluate(() => document.documentElement.lang)) !== loc) {
    await page.locator(`.locale-toggle [data-value="${loc}"]`).click();
    await page.waitForTimeout(2500);
  }
  console.log(`settled on ${loc}: ${JSON.stringify(await state())}`);
}

for (const [from, to] of [
  ["ko", "en"],
  ["en", "ko"],
]) {
  await settle(from);
  console.log(`\n=== window opens on ${from}; the reader presses ${to} straight away ===`);
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  await page.locator(`.locale-toggle [data-value="${to}"]`).click();
  console.log(`  right after the press: ${JSON.stringify(await state())}`);
  await page.waitForTimeout(3000);
  const after = await state();
  console.log(`  three seconds later:   ${JSON.stringify(after)}`);
  console.log(
    `  VERDICT: reader asked for ${to} — screen says ${after.lang}, localStorage says ${after.stored}, settings.json says ${after.settingsJson}`
  );
  if (after.lang !== to) {
    const png = shot(`3-x-locale-toggle-reverted-${from}-to-${to}`);
    console.log(`  evidence: ${png}`);
  }
}

await browser.close();
