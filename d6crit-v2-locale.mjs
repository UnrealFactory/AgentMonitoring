/**
 * D6 (v2), check 3: the language toggle itself.
 *
 * Both languages render (d6crit-v2-all.mjs ko|en). This file is about the control: press it
 * early in a window's life and the press is thrown away, and the two places the app remembers
 * the language are left disagreeing — localStorage says one thing, settings.json the other,
 * so the NEXT window opens in the language nobody asked for and changes under the reader.
 * Filed as BUG-0026; this re-proves it in the real window at HEAD and measures the window.
 *
 *   node d6crit-v2-locale.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { shot } from "./d6crit-v2-shot.mjs";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const SETTINGS = `${process.env.APPDATA}/com.agentmonitoring.app/settings.json`;
const onDisk = () => {
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf8")).locale ?? null;
  } catch (e) {
    return "unreadable";
  }
};

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const state = async () => ({
  screen: await page.evaluate(() => document.documentElement.lang),
  localStorage: await page.evaluate(() => localStorage.getItem("agentmon.locale")),
  settingsJson: onDisk(),
});

async function settle(loc) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  await page.waitForTimeout(3000);
  if ((await page.evaluate(() => document.documentElement.lang)) !== loc) {
    await page.locator(`.locale-toggle [data-value="${loc}"]`).first().click();
    await page.waitForTimeout(2500);
  }
  console.log(`settled on ${loc}: ${JSON.stringify(await state())}`);
}

/* 1 — the toggle works when the window has finished booting (the normal case) */
await settle("ko");
await page.locator('.locale-toggle [data-value="en"]').first().click();
await page.waitForTimeout(1200);
console.log(`\n[normal] pressed English on a settled window: ${JSON.stringify(await state())}`);
await settle("ko");

/* 2 — how late a press is still discarded */
console.log(`\n[race] press English N ms after the toggle appears in a new document:`);
for (const delay of [0, 200, 400, 700, 1000, 1500]) {
  await settle("ko");
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  if (delay) await page.waitForTimeout(delay);
  await page.locator('.locale-toggle [data-value="en"]').first().click();
  const right = await state();
  await page.waitForTimeout(2500);
  const after = await state();
  console.log(
    `  +${String(delay).padStart(4)}ms  right after: ${right.screen}  |  2.5s later: screen=${after.screen} localStorage=${after.localStorage} settings.json=${after.settingsJson}` +
      (after.screen === "en" ? "  (held)" : "  <-- the press was discarded")
  );
  if (after.screen !== "en" && after.localStorage !== after.settingsJson) {
    const s = await shot(page, `v2-3-race-discarded-at-${delay}ms`);
    console.log(`     the two stores now disagree; shot ${s.file} ok=${s.ok}`);
  }
}

/* 3 — what the split does to the next window */
console.log(`\n[split] the next document, with localStorage=${(await state()).localStorage} settings.json=${onDisk()}:`);
await page.addInitScript(() => {
  window.__langLog = [];
  const el = document.documentElement;
  new MutationObserver(() => window.__langLog.push({ at: Math.round(performance.now()), lang: el.lang })).observe(el, {
    attributes: true,
    attributeFilter: ["lang"],
  });
});
await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".locale-toggle", { timeout: 15000 });
const early = await page.evaluate(() => document.documentElement.lang);
const shotEarly = await shot(page, "v2-3-next-window-opens");
await page.waitForTimeout(3000);
const late = await page.evaluate(() => document.documentElement.lang);
const shotLate = await shot(page, "v2-3-next-window-flips");
console.log(`  opened in ${early}, settled on ${late}`);
console.log(`  lang changes: ${JSON.stringify(await page.evaluate(() => window.__langLog))}`);
console.log(`  evidence: ${shotEarly.file} (ok=${shotEarly.ok}) then ${shotLate.file} (ok=${shotLate.ok})`);

await settle("ko");
await browser.close();
