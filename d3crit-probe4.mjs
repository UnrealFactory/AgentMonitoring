import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const ORIGIN = "http://localhost:5417";
const OUT = "C:/tmp/d3r5/shots/probe4";
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
for (const loc of ["en", "ko"]) {
  await page.goto(`${ORIGIN}/app-feedback`, { waitUntil: "domcontentloaded" });
  await page.evaluate((l) => { localStorage.setItem("agentmon.locale", l); sessionStorage.clear(); }, loc);
  await page.reload({ waitUntil: "domcontentloaded" }); await settle();
  const seg = await page.evaluate(() => [...document.querySelectorAll('.view-toggle [role="tab"]')].map((t) => ({ v: t.getAttribute("data-value"), t: t.textContent.trim(), sel: t.getAttribute("aria-selected") })));
  console.log(loc, "default segments:", JSON.stringify(seg));
  await show("human");
  await page.screenshot({ path: `${OUT}/fb-mixed-${loc}.png` });
  const rows = await page.evaluate(() => [...document.querySelectorAll(".feedback-list > *")].map((r) => ({ h: Math.round(r.getBoundingClientRect().height), none: !!r.querySelector(".feedback-none"), noneText: r.querySelector(".feedback-none")?.textContent?.trim() ?? null })));
  console.log(loc, "rows:", JSON.stringify(rows));
  const notice = await page.evaluate(() => { const n = document.querySelector(".human-notice"); return n ? n.textContent.trim().slice(0, 200) : null; });
  console.log(loc, "notice:", notice);
}
await browser.close();
console.log("done");
