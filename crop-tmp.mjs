import { chromium } from "playwright";
const ORIGIN = "http://localhost:5199";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 3 });
const p = await ctx.newPage();
await p.goto(`${ORIGIN}/p/prj-agent-monitoring/bugs/BUG-0025`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".human-sheet");
await p.waitForFunction(() => !document.querySelector(".skeleton"));
await p.evaluate(() => document.fonts.ready);
await p.locator(".record-head-top, .record-head").first().screenshot({ path: "C:/tmp/d3crit/shots/crop-head.png" });
await p.locator(".human-beat").nth(0).screenshot({ path: "C:/tmp/d3crit/shots/crop-beat1.png" });
await p.locator(".human-takeaway").screenshot({ path: "C:/tmp/d3crit/shots/crop-takeaway.png" });
// agent view head for comparison
await p.locator('.view-toggle [data-value="agent"]').click();
await p.waitForTimeout(300);
await p.locator(".record-head-top, .record-head").first().screenshot({ path: "C:/tmp/d3crit/shots/crop-head-agent.png" });
// existing segmented control on the bugs board, for the native comparison
await p.goto(`${ORIGIN}/p/prj-agent-monitoring/bugs`, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".segmented");
await p.evaluate(() => document.fonts.ready);
await p.locator(".segmented").first().screenshot({ path: "C:/tmp/d3crit/shots/crop-boardtabs.png" });
await b.close();
