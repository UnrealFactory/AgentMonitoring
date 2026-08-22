import { chromium } from "playwright";
const ORIGIN = "http://localhost:5199";
const b = await chromium.launch();
for (const w of [1600, 1152, 960]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, deviceScaleFactor: 1.5 });
  const p = await ctx.newPage();
  await p.goto(`${ORIGIN}/p/prj-agent-monitoring/bugs/BUG-0025`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".human-sheet");
  await p.waitForFunction(() => !document.querySelector(".skeleton"));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `C:/tmp/d3crit/shots/w${w}-bug-human.png` });
  const m = await p.evaluate(() => {
    const sheet = document.querySelector(".human-sheet");
    const r = sheet.getBoundingClientRect();
    const bodyP = document.querySelector(".human-beat-body p");
    const fig = document.querySelector(".human-beat-body .figure");
    const cs = (e) => e ? getComputedStyle(e) : null;
    const bp = cs(bodyP), fp = cs(fig);
    const lead = cs(document.querySelector(".human-beat-lead"));
    const num = cs(document.querySelector(".human-beat-num"));
    const main = document.querySelector(".main") || document.body;
    return { sheetW: Math.round(r.width), sheetLeft: Math.round(r.left), sheetRight: Math.round(r.right),
      contentW: Math.round((document.querySelector(".detail-doc,.record-body,.detail-main")||main).getBoundingClientRect().width),
      bodyColor: bp?.color, bodySize: bp?.fontSize, figColor: fp?.color, figWeight: fp?.fontWeight, figSize: fp?.fontSize,
      leadSize: lead?.fontSize, leadWeight: lead?.fontWeight, leadColor: lead?.color,
      numColor: num?.color, numSize: num?.fontSize, numBg: num?.backgroundColor,
      sideVisible: !!document.querySelector(".detail-side")?.offsetParent };
  });
  console.log(w, JSON.stringify(m));
  await ctx.close();
}
await b.close();
