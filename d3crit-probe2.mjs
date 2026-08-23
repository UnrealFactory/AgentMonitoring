import { chromium } from "playwright";
const ORIGIN = "http://localhost:5417";
const FX = "prj-18ce598acf270c64";
const LIVE = "prj-agent-monitoring";
const out = (...a) => console.log(...a);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const settle = async () => { await page.waitForFunction(() => !document.querySelector(".skeleton")); await page.waitForTimeout(120); };
const show = async (mode) => {
  const seg = page.locator(`.view-toggle [role="tab"][data-value="${mode}"]`).first();
  await seg.waitFor({ state: "visible" });
  await seg.click();
  await page.waitForFunction((m) => document.querySelector(`.view-toggle [role="tab"][data-value="${m}"]`)?.getAttribute("aria-selected") === "true", mode);
  await page.waitForTimeout(120);
};

// ---- the escape button on the empty box, done right ----
out("=== EMPTY BOX ESCAPE BUTTON ===");
await page.goto(`${ORIGIN}/p/${FX}/work/WORK-0001`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => sessionStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" }); await settle();
await show("human");
await page.goto(`${ORIGIN}/p/${FX}/bugs/BUG-0003`, { waitUntil: "domcontentloaded" }); await settle();
const btns = await page.evaluate(() => [...document.querySelectorAll(".human-empty button")].map((b) => ({ t: b.textContent.trim(), cls: b.className })));
out("  buttons in the box:", JSON.stringify(btns));
const back = page.locator(".human-empty button").last();
out("  pressing:", (await back.textContent()).trim());
await back.click(); await page.waitForTimeout(250);
out("  after:", JSON.stringify(await page.evaluate(() => ({
  selected: document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value"),
  session: sessionStorage.getItem("agentmon.recordView"),
  peek: document.querySelector(".view-peek")?.textContent?.trim() ?? null,
  focus: document.activeElement?.getAttribute?.("data-value") ?? document.activeElement?.className,
}))));
await page.goto(`${ORIGIN}/p/${FX}/bugs/BUG-0001`, { waitUntil: "domcontentloaded" }); await settle();
out("  next retold record:", await page.evaluate(() => document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value")));

// ---- TYPE SCALE: agent .prose vs human sheet, at 5 widths ----
out("\n=== TYPE SCALE: agent .prose vs human sheet ===");
for (const w of [960, 1152, 1400, 1600, 1900]) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.goto(`${ORIGIN}/p/${LIVE}/work/WORK-0067`, { waitUntil: "domcontentloaded" }); await settle();
  await show("agent");
  const agent = await page.evaluate(() => {
    const p = document.querySelector(".prose p") || document.querySelector(".prose");
    const s = getComputedStyle(p);
    return { fs: s.fontSize, lh: s.lineHeight, color: s.color, w: Math.round(p.getBoundingClientRect().width) };
  });
  await show("human");
  const human = await page.evaluate(() => {
    const sheet = document.querySelector(".human-sheet");
    const view = document.querySelector(".human-view");
    const g = (sel) => { const e = sheet.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); return { fs: s.fontSize, lh: s.lineHeight, w: Math.round(e.getBoundingClientRect().width), color: s.color, weight: s.fontWeight }; };
    return {
      lede: g(".human-lede > p:first-child"),
      ledeRest: g(".human-lede > p:nth-child(2)"),
      lead: g(".human-beat-lead"),
      body: g(".human-beat-body p"),
      take: g(".human-takeaway"),
      foot: g(".human-foot"),
      sheetW: Math.round(sheet.getBoundingClientRect().width),
      viewW: view ? Math.round(view.getBoundingClientRect().width) : null,
      sheetBg: getComputedStyle(sheet).backgroundColor,
      sheetBorder: getComputedStyle(sheet).borderTopWidth + " " + getComputedStyle(sheet).borderTopColor,
      sheetRadius: getComputedStyle(sheet).borderTopLeftRadius,
      sheetPad: getComputedStyle(sheet).paddingTop + "/" + getComputedStyle(sheet).paddingLeft,
    };
  });
  out(`  @${w}: agent ${agent.fs}/${agent.lh} w${agent.w} | lede ${human.lede?.fs} lead ${human.lead?.fs} body ${human.body?.fs}/${human.body?.lh} w${human.body?.w} take ${human.take?.fs} foot ${human.foot?.fs} | sheet ${human.sheetW} view ${human.viewW} dead=${human.viewW - human.sheetW}`);
  if (w === 1600) out(`     sheet bg=${human.sheetBg} border=${human.sheetBorder} radius=${human.sheetRadius} pad=${human.sheetPad}`);
}

// ---- NATIVE surface comparison at 1600 ----
out("\n=== NATIVE: sheet vs the app's own cards, same screen ===");
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(`${ORIGIN}/p/${LIVE}/work/WORK-0067`, { waitUntil: "domcontentloaded" }); await settle();
await show("human");
const cmp = await page.evaluate(() => {
  const grab = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e);
    return { sel, bg: s.backgroundColor, border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`, radius: s.borderTopLeftRadius, pad: s.paddingTop, shadow: s.boxShadow }; };
  return [grab(".human-sheet"), grab(".side-card"), grab(".human-takeaway"), grab(".human-beat-badge")];
});
out(JSON.stringify(cmp, null, 1));
const noteLead = await page.evaluate(() => {
  const e = document.querySelector(".note-lead"); if (!e) return null; const s = getComputedStyle(e);
  return { bg: s.backgroundColor, borderLeft: `${s.borderLeftWidth} ${s.borderLeftColor}`, radius: s.borderTopLeftRadius, fs: s.fontSize };
});
await page.goto(`${ORIGIN}/p/${LIVE}/notes/start-here`, { waitUntil: "domcontentloaded" }); await settle();
await show("agent");
out("note-lead (agent view of a note):", JSON.stringify(await page.evaluate(() => { const e = document.querySelector(".note-lead"); if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, borderLeft: `${s.borderLeftWidth} ${s.borderLeftColor}`, radius: s.borderTopLeftRadius, fs: s.fontSize }; })));
await show("human");
out("takeaway (human view of the same note):", JSON.stringify(await page.evaluate(() => { const e = document.querySelector(".human-takeaway"); if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, borderLeft: `${s.borderLeftWidth} ${s.borderLeftColor}`, radius: s.borderTopLeftRadius, fs: s.fontSize, weight: s.fontWeight }; })));

// ---- FEEDBACK BOARD: title vs body size ----
out("\n=== FEEDBACK BOARD hierarchy ===");
await page.goto(`${ORIGIN}/app-feedback`, { waitUntil: "domcontentloaded" }); await settle();
await show("agent");
out("  agent:", JSON.stringify(await page.evaluate(() => {
  const t = document.querySelector(".feedback-title, .feedback-item-title, .feedback-row h3, .feedback-list h3");
  const b = document.querySelector(".feedback-list .prose p, .feedback-body p, .feedback-list p");
  const g = (e) => e ? { cls: e.className, fs: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight, t: e.textContent.slice(0, 30) } : null;
  return { title: g(t), body: g(b) };
})));
await show("human");
out("  human:", JSON.stringify(await page.evaluate(() => {
  const row = document.querySelector(".feedback-list > *");
  const all = [...row.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent.trim()).slice(0, 12);
  return all.map((e) => ({ cls: e.className || e.tagName, fs: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight, t: e.textContent.trim().slice(0, 34) }));
}), null, 1));

await browser.close();
