/**
 * D6: a small nav/report helper used by the checks, run standalone for exploration.
 *   node d6crit-nav.mjs <url-path>
 */
import { chromium } from "playwright";

const target = process.argv[2];
const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

if (target) {
  await page.goto("http://localhost:5173" + target, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

const state = await page.evaluate(() => {
  const main = document.getElementById("main");
  const toggle = document.querySelector(".view-toggle");
  const seg = [...document.querySelectorAll('.view-toggle [role="tab"]')].map((b) => ({
    v: b.dataset.value,
    text: b.textContent.trim(),
    selected: b.getAttribute("aria-selected"),
    title: b.getAttribute("title"),
  }));
  return {
    href: location.href,
    lang: document.documentElement.lang,
    scrollTop: main ? main.scrollTop : null,
    scrollHeight: main ? main.scrollHeight : null,
    clientHeight: main ? main.clientHeight : null,
    toggle: !!toggle,
    toggleTop: toggle ? Math.round(toggle.getBoundingClientRect().top) : null,
    segments: seg,
    humanSheet: !!document.querySelector(".human-sheet"),
    humanEmpty: !!document.querySelector(".human-empty"),
    humanNotice: !!document.querySelector(".human-notice"),
    beats: document.querySelectorAll(".human-beat").length,
    nums: [...document.querySelectorAll(".human-beat-num")].map((n) => n.textContent.trim()),
    takeaway: document.querySelector(".human-takeaway")?.textContent.trim().slice(0, 90) ?? null,
    figures: document.querySelectorAll(".human-sheet b.figure").length,
    agentIds: ["what", "why", "how", "files", "outcome", "updates", "report", "thread", "body", "resolution"].filter(
      (id) => document.getElementById(id)
    ),
    session: (() => {
      try {
        return sessionStorage.getItem("agentmon.recordView");
      } catch {
        return "denied";
      }
    })(),
  };
});
console.log(JSON.stringify(state, null, 1));
await browser.close();
