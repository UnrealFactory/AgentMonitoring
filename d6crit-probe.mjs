/** D6 critic: attach to the real desktop window over CDP and report what is there. */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const ctxs = browser.contexts();
const pages = ctxs.flatMap((c) => c.pages());
console.log("contexts:", ctxs.length, "pages:", pages.length);
for (const p of pages) console.log("  page url:", p.url());

const page = pages.find((p) => !p.url().startsWith("devtools://")) ?? pages[0];
await page.waitForLoadState("domcontentloaded");

const info = await page.evaluate(async () => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  let visible = "no-tauri";
  try {
    if (inv) visible = await inv("plugin:window|is_visible");
  } catch (e) {
    visible = "err:" + String(e);
  }
  return {
    href: location.href,
    tauri: !!window.__TAURI_INTERNALS__,
    visible,
    inner: [window.innerWidth, window.innerHeight],
    outer: [window.outerWidth, window.outerHeight],
    dpr: window.devicePixelRatio,
    lang: document.documentElement.lang,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 400),
    sessionView: (() => {
      try {
        return sessionStorage.getItem("agentmon.recordView");
      } catch {
        return "denied";
      }
    })(),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
