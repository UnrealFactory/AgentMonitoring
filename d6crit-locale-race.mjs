/**
 * D6: press the language toggle just after the desktop window opens, and watch.
 *
 * AppContext boots `loadDesktopLocale()`, which reads settings.json over the Tauri IPC and
 * then calls `setLocale(saved, { persist: false })` unconditionally. Nothing in that path
 * asks whether the reader has chosen in the meantime — so a press that lands before the
 * answer arrives is overwritten by the value the window opened with.
 *
 *   node d6crit-locale-race.mjs
 */
import { chromium } from "playwright";
import { shot } from "./d6crit-shot.mjs";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const state = () =>
  page.evaluate(() => ({
    lang: document.documentElement.lang,
    chrome: document.querySelector(".locale-toggle")?.getAttribute("aria-label") ?? null,
    stored: (() => {
      try {
        return localStorage.getItem("agentmon.locale");
      } catch {
        return "denied";
      }
    })(),
    pressed: [...document.querySelectorAll(".locale-toggle button")].map(
      (b) => b.dataset.value + (b.getAttribute("aria-pressed") === "true" || b.className.includes("is-on") ? "*" : "")
    ),
  }));

/** Settle on `loc` the slow way, so settings.json really holds it. */
async function settle(loc) {
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle");
  await page.waitForTimeout(2500);
  if ((await page.evaluate(() => document.documentElement.lang)) !== loc) {
    await page.locator(`.locale-toggle [data-value="${loc}"]`).click();
    await page.waitForTimeout(2500);
  }
  console.log(`settled on ${loc}:`, JSON.stringify(await state()));
}

async function race(from, to, waitBeforePress) {
  await settle(from);
  await page.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".locale-toggle", { timeout: 15000 });
  if (waitBeforePress) await page.waitForTimeout(waitBeforePress);
  const t0 = Date.now();
  await page.locator(`.locale-toggle [data-value="${to}"]`).click();
  const line = [];
  for (let i = 0; i < 30; i++) {
    const s = await state();
    line.push(`${String(Date.now() - t0).padStart(4)}ms lang=${s.lang} stored=${s.stored}`);
    await page.waitForTimeout(120);
  }
  const first = line[0];
  const last = line[line.length - 1];
  console.log(`\n--- press ${from} -> ${to}, ${waitBeforePress}ms after the window drew ---`);
  console.log("  " + first);
  /* only print where it changes */
  let prev = null;
  for (const l of line) {
    const key = l.split("lang=")[1];
    if (key !== prev) console.log("  " + l);
    prev = key;
  }
  console.log("  " + last);
  const s = await state();
  console.log(`  verdict: asked for ${to}, screen is ${s.lang}, storage is ${s.stored}`);
  return s;
}

/* A press a beat after the window drew — the case a reader hits by reaching straight for
   the control. */
const fast = await race("ko", "en", 0);
if (fast.lang !== "en") shot("3-x-locale-reverted-after-boot");

/* And the same press once the boot read has landed. */
const slow = await race("ko", "en", 2500);

console.log(`\nfast press: ${fast.lang} (wanted en)   slow press: ${slow.lang} (wanted en)`);
await browser.close();
