/** D6: what a board's rows link to, so check 2 can navigate in-app instead of reloading. */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

for (const path of ["/p/prj-agent-monitoring/bugs", "/p/prj-agent-monitoring/notes", "/p/prj-agent-monitoring/work"]) {
  await page.goto("http://localhost:5173" + path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => ({
    href: location.href,
    tabs: [...document.querySelectorAll('.segmented [role="tab"], .segmented a')].map((b) => ({
      v: b.dataset.value ?? b.getAttribute("href"),
      t: b.textContent.trim().slice(0, 20),
      sel: b.getAttribute("aria-selected"),
    })),
    rows: [...document.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => /\/(work|bugs|notes)\/[^/?]+$/.test(h))
      .slice(0, 8),
  }));
  console.log(JSON.stringify(info, null, 1));
}
await browser.close();
