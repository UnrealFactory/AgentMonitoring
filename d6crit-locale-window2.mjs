/**
 * D6: how long after the window draws is a press of the language toggle still thrown away?
 *
 * Empirical, because the thing being raced is an IPC round trip and not a number in the
 * source: settle the app on one language, reload, wait N ms, press the other, and see which
 * language is on screen three seconds later.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";
const WAITS = [0, 100, 200, 300, 400, 600, 900];

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const lang = () => page.evaluate(() => document.documentElement.lang);

async function settle(loc) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle");
  await page.waitForTimeout(2000);
  if ((await lang()) !== loc) {
    await page.locator(`.locale-toggle [data-value="${loc}"]`).click();
    await page.waitForTimeout(2000);
  }
}

for (const wait of WAITS) {
  await settle("ko");
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  if (wait) await page.waitForTimeout(wait);
  await page.locator('.locale-toggle [data-value="en"]').click();
  const immediate = await lang();
  await page.waitForTimeout(3000);
  const settled = await lang();
  console.log(
    `pressed English ${String(wait).padStart(3)}ms after the toggle appeared: ` +
      `screen went ${immediate}, three seconds later it is ${settled} ` +
      `${settled === "en" ? "(held)" : "<-- DISCARDED"}`
  );
}

await browser.close();
