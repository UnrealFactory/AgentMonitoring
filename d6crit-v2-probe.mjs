/**
 * D6 critic, second pass — is this really the desktop window, and what is in it?
 * Nothing is asserted here; it is the "where am I" read before the checks.
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const ctx = browser.contexts();
console.log(`contexts=${ctx.length} pages=${ctx.map((c) => c.pages().length).join(",")}`);
const page = ctx[0].pages()[0];

const info = await page.evaluate(async () => {
  const ipc = window.__TAURI_INTERNALS__;
  let visible = "no-ipc";
  let cfg = null;
  try {
    visible = await ipc.invoke("plugin:window|is_visible");
  } catch (e) {
    visible = "invoke-failed:" + String(e).slice(0, 60);
  }
  try {
    cfg = await ipc.invoke("plugin:window|inner_size");
  } catch {}
  return {
    href: location.href,
    ua: navigator.userAgent.slice(0, 60),
    hasIpc: !!ipc,
    visible,
    innerSize: cfg,
    win: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
    lang: document.documentElement.lang,
    localeStore: localStorage.getItem("agentmon.locale"),
    session: sessionStorage.getItem("agentmon.recordView"),
    title: document.title,
  };
});
console.log(JSON.stringify(info, null, 2));

/* what live records exist to test against */
await page.goto("http://localhost:5173/app-feedback", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
const fb = await page.evaluate(() => ({
  rows: document.querySelectorAll(".feedback-row").length,
  retold: document.querySelectorAll(".feedback-human").length,
  none: document.querySelectorAll(".feedback-none").length,
  toggle: !!document.querySelector(".view-toggle"),
  ids: [...document.querySelectorAll(".feedback-id")].map((e) => e.textContent.trim()),
}));
console.log("app-feedback:", JSON.stringify(fb));

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
const projects = await page.evaluate(() =>
  [...document.querySelectorAll('a[href^="/p/"]')].map((a) => a.getAttribute("href")).slice(0, 12)
);
console.log("projects:", JSON.stringify(projects));

await browser.close();
