import { chromium } from "playwright";
const ORIGIN = "http://localhost:5417";
const FX = "prj-18ce598acf270c64";
const LIVE = "prj-agent-monitoring";
const OUT = "C:/tmp/d3r5/shots/probe3";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const settle = async () => { await page.waitForFunction(() => !document.querySelector(".skeleton")); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150); };
const show = async (mode) => {
  const seg = page.locator(`.view-toggle [role="tab"][data-value="${mode}"]`).first();
  await seg.waitFor({ state: "visible" }); await seg.click();
  await page.waitForFunction((m) => document.querySelector(`.view-toggle [role="tab"][data-value="${m}"]`)?.getAttribute("aria-selected") === "true", mode);
  await page.waitForTimeout(150);
};
const FULL = `html,body,#root{height:auto}.app{height:auto;min-height:100vh}.main,.sidebar{overflow:visible}.detail-side,.detail-side .side-card{position:static}`;

for (const w of [960, 1152, 1900]) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.goto(`${ORIGIN}/p/${LIVE}/work/WORK-0067`, { waitUntil: "domcontentloaded" });
  await settle(); await show("human");
  await page.screenshot({ path: `${OUT}/human-${w}.png` });
  const st = await page.addStyleTag({ content: FULL });
  await page.screenshot({ path: `${OUT}/human-${w}-full.png`, fullPage: true });
  await st.evaluate((e) => e.remove());
  // head geometry: title vs toggle
  const g = await page.evaluate(() => {
    const t = document.querySelector(".record-title");
    const tg = document.querySelector(".view-toggle");
    const r1 = t.getBoundingClientRect(), r2 = tg.getBoundingClientRect();
    return { title: [Math.round(r1.x), Math.round(r1.y), Math.round(r1.right), Math.round(r1.bottom)], toggle: [Math.round(r2.x), Math.round(r2.y), Math.round(r2.right), Math.round(r2.bottom)], overlap: r1.right > r2.left && r1.bottom > r2.top && r1.top < r2.bottom };
  });
  console.log(`@${w}`, JSON.stringify(g));
}

// mixed feedback board: one retold, one not
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(`${ORIGIN}/app-feedback`, { waitUntil: "domcontentloaded" }); await settle();
await show("human");
await page.screenshot({ path: `${OUT}/fb-human-mixed.png` });
await show("agent");
await page.screenshot({ path: `${OUT}/fb-agent.png` });

// in-progress work record, human half
await page.goto(`${ORIGIN}/p/${FX}/work/WORK-0002`, { waitUntil: "domcontentloaded" }); await settle();
await show("human");
await page.screenshot({ path: `${OUT}/work-inprogress-human.png` });

// thin bug BUG-0023 human at 1600
await page.goto(`${ORIGIN}/p/${LIVE}/bugs/BUG-0023`, { waitUntil: "domcontentloaded" }); await settle();
await show("human");
const st2 = await page.addStyleTag({ content: FULL });
await page.screenshot({ path: `${OUT}/bug-0023-human-full.png`, fullPage: true });
await st2.evaluate((e) => e.remove());

await browser.close();
console.log("done");
