/**
 * D6 (v2): the four checks passed on one record of each kind. This walks every record of this
 * project in the real desktop window and asks the same questions of all of them — a retelling
 * that renders with no beats, unnumbered landmarks, no takeaway or a sideways overflow is a
 * defect a four-record sample would miss.
 *
 *   node d6crit-v2-corpus.mjs
 */
import { chromium } from "playwright";

const ORIGIN = "http://localhost:5173";
const PRJ = "/p/prj-agent-monitoring";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

/** every record id on each board, read off the boards themselves */
async function ids(board, prefix) {
  await page.goto(`${ORIGIN}${PRJ}/${board}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 20000 });
  await page.waitForTimeout(600);
  const seg = await page.locator(`.segmented [role="tab"][data-value="all"]`).count();
  if (seg) {
    await page.locator(`.segmented [role="tab"][data-value="all"]`).first().click();
    await page.waitForTimeout(600);
  }
  return page.evaluate(
    (p) => [...new Set([...document.querySelectorAll(`a[href*="${p}/"]`)].map((a) => a.getAttribute("href")))].filter((h) => h.startsWith(p + "/")),
    `${PRJ}/${board}`.replace(/\/$/, "")
  );
}

const work = await ids("work");
const bugs = await ids("bugs");
const notes = await ids("notes");
const all = [...work, ...bugs, ...notes];
console.log(`records on the boards: ${work.length} work, ${bugs.length} bugs, ${notes.length} notes`);

const bad = [];
let retold = 0;
let empty = 0;

for (const href of all) {
  await page.goto(ORIGIN + href, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector(".human-sheet, .human-empty", { timeout: 15000 });
  } catch {
    bad.push({ href, why: "neither a retelling nor the empty box appeared" });
    continue;
  }
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const main = document.getElementById("main");
    return {
      sheet: !!q(".human-sheet"),
      emptyBox: !!q(".human-empty"),
      toggle: !!q(".view-toggle"),
      humanDefault: !!q(".human-view"),
      beats: document.querySelectorAll(".human-beat").length,
      nums: [...document.querySelectorAll(".human-beat-num")].map((n) => n.textContent.trim()),
      leads: [...document.querySelectorAll(".human-beat-lead")].filter((e) => !e.textContent.trim()).length,
      takeaway: (q(".human-takeaway")?.textContent ?? "").trim().length,
      foot: (q(".human-foot")?.textContent ?? "").trim().length,
      lede: (q(".human-lede")?.textContent ?? "").trim().length,
      overflowX: main ? main.scrollWidth - main.clientWidth : -1,
      clipped: [...document.querySelectorAll(".human-sheet *")].filter(
        (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible"
      ).length,
    };
  });

  if (!r.toggle) bad.push({ href, why: "no Agent/Human toggle" });
  if (r.emptyBox) {
    empty++;
    continue;
  }
  retold++;
  const numbering = r.nums.join(",") === Array.from({ length: r.beats }, (_, i) => String(i + 1)).join(",");
  if (!r.humanDefault) bad.push({ href, why: "did not open on the human half" });
  if (r.beats < 3) bad.push({ href, why: `only ${r.beats} beats` });
  if (!numbering) bad.push({ href, why: `landmarks not numbered 1..${r.beats}: ${r.nums.join(",")}` });
  if (r.leads) bad.push({ href, why: `${r.leads} landmark(s) with no lead sentence` });
  if (!r.takeaway) bad.push({ href, why: "no lifted takeaway" });
  if (!r.foot) bad.push({ href, why: "no byline" });
  if (!r.lede) bad.push({ href, why: "no opening paragraph" });
  if (r.overflowX > 0) bad.push({ href, why: `${r.overflowX}px of sideways overflow` });
  if (r.clipped) bad.push({ href, why: `${r.clipped} clipped element(s) inside the sheet` });
}

console.log(`\nwalked ${all.length}: ${retold} retold, ${empty} showing the empty box`);
if (!bad.length) console.log("every retelling rendered with beats, 1..n landmarks, a takeaway and a byline, and nothing overflowed");
else {
  console.log(`PROBLEMS (${bad.length}):`);
  for (const b of bad) console.log(`  ${b.href} — ${b.why}`);
}
await browser.close();
