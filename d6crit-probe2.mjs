/** D6: find the AgentMonitoring project + its records, from inside the real window. */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const links = await page.evaluate(() =>
  [...document.querySelectorAll("a[href]")].map((a) => ({
    href: a.getAttribute("href"),
    text: a.textContent.trim().slice(0, 40),
  }))
);
console.log("sidebar links:");
for (const l of links) console.log(" ", l.href, "|", l.text);

await browser.close();
