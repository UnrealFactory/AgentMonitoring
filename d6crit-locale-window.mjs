/**
 * D6: how wide is the window in which a press of the language toggle is thrown away?
 *
 * Measured from the moment the page's own clock starts (performance.timeOrigin) to the
 * moment `document.documentElement.lang` is rewritten by the boot read of settings.json.
 * A press before that mark is undone; a press after it holds.
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

/* Watch the attribute from before the app's own script runs. */
await page.addInitScript(() => {
  window.__langLog = [];
  const start = () => {
    const el = document.documentElement;
    window.__langLog.push({ at: Math.round(performance.now()), lang: el.lang, why: "first-seen" });
    new MutationObserver((ms) => {
      for (const m of ms)
        if (m.attributeName === "lang")
          window.__langLog.push({ at: Math.round(performance.now()), lang: el.lang, why: "changed" });
    }).observe(el, { attributes: true, attributeFilter: ["lang"] });
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });
});

for (let i = 0; i < 3; i++) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  const paint = await page.evaluate(() => {
    return new Promise((r) => {
      const t = () => {
        const el = document.querySelector(".locale-toggle");
        if (el) r(Math.round(performance.now()));
        else requestAnimationFrame(t);
      };
      t();
    });
  });
  await page.waitForTimeout(4000);
  const log = await page.evaluate(() => window.__langLog ?? []);
  const boot = log.find((e) => e.why === "changed");
  console.log(
    `run ${i + 1}: the toggle is on screen at ${paint}ms; ` +
      (boot
        ? `settings.json rewrites lang at ${boot.at}ms -> a press in that ${boot.at - paint}ms is discarded`
        : `settings.json agreed with the opening language, so nothing was rewritten (log=${JSON.stringify(log)})`)
  );
  /* Flip the stored language so the next run has something to rewrite. */
  const now = await page.evaluate(() => document.documentElement.lang);
  await page.locator(`.locale-toggle [data-value="${now === "ko" ? "en" : "ko"}"]`).click();
  await page.waitForTimeout(1500);
}

await browser.close();
