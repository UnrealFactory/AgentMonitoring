#!/usr/bin/env node
/**
 * Find text this app destroys: ink that is cut in half, and ink painted on top of other ink.
 *
 *   npm run check:clipping
 *   node scripts/check-clipping.mjs [--port 5173] [--widths 1600,1280,1104,960]
 *                                  [--project relay] [--url ORIGIN]
 *
 * Four defects, one gate, because they are the same failure seen from four sides — a box
 * that is smaller than what it holds:
 *
 *   CLIPPED  a fixed-width box with `overflow: hidden` guillotines whatever sticks out, and
 *            `text-overflow: ellipsis` on an inner element does not fire — that element
 *            believes it fits, because it does; it is the *ancestor* that is too small. The
 *            reader gets "p3-bugs-builc" with nothing to warn them.
 *   OVERLAP  the same overflow with `overflow: visible` does not cut anything: it paints the
 *            escaping text over its neighbour. At 960px the bug strip printed
 *            "18 Aug 2026p0+f0undation-builder" — two facts in one set of pixels, and a
 *            clipping test sees nothing wrong because nothing was clipped (BUG-0007).
 *   TRUNCATED a *heading* that ellipsises itself. An honest ellipsis is the right answer for
 *            a name out of the vault; it is the wrong answer for the app's own vocabulary,
 *            which the reader needs whole to know what the numbers under it mean. The
 *            Agents table's RESOLVED column shipped as "RESOL…" through two rounds of this
 *            gate, because an ellipsis was present and no ancestor was doing the cutting.
 *   TIP      a chart tooltip whose text is painted outside its own card. The same failure
 *            again — a 168px box holding a 180px row — but on a surface that is not on a
 *            loaded screen: the tip exists only under a pointer or a focus ring, so for
 *            eight rounds this gate walked past it, and the round it was given `flex: none`
 *            it started printing "…or abandoned" over the plot at every width from 1280 up.
 *            It is opened at nine crosshairs per chart now, both ends included.
 *   TIPCUT   …and the same tooltip with the failure the other way round: not ink escaping
 *            the tip, but the tip escaping its **card**, which hides overflow and takes a
 *            slice off it. TIP could not see it by construction — it clips the ink by every
 *            ancestor that bounds overflow *before* comparing it to the tip's own box, so a
 *            tip cut in half reads as a tip whose text is all inside it. At 1072px, where
 *            the two chart cards sit side by side and the plot is 346px, the crosshair at
 *            0.35 anchored a 260px tip at x=122 and the card sliced 19px off its right edge
 *            — border, ids and all, in both languages (P9 round 8 critic).
 *
 * All three are correctness bugs on screens whose whole job is to show a record faithfully, so
 * this walks EVERY record of EVERY project (not just the first one: the row that breaks is
 * always the one with the longest agent name) at every width, and exits non-zero if any
 * screen cuts text or stacks it.
 *
 * Overlap is measured on *painted ink*: the client rects of the text itself, clipped by any
 * ancestor that hides overflow — so a real ellipsis is not reported as an overlap, and text
 * below the fold is still measured.
 *
 * Every screen is gated, the dashboard included. It used to be walked but excused, because
 * its Agents table overflowed its own card (vault BUG-0006) and would have kept this gate
 * permanently red for everyone else. That bug is fixed, so the excuse is gone: a gate with
 * a hole in it is a gate that says nothing about the hole.
 *
 * Boots its own dev server when none is listening. Not part of the product; a builder's
 * tool, like shoot-region.mjs.
 */
import { chromium } from "playwright";
import { ensureServer, stopServer } from "./dev-server.mjs";
import { useLocale } from "./i18n.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--help") || flag("-h")) {
  console.log(`Find text this app cuts in half, paints on top of itself, or paints outside its box.

  npm run check:clipping                       ko then en
  node scripts/check-clipping.mjs --widths 1600,960 --project relay

Options:
  --widths a,b,c        viewport widths to walk (default 1600,1440,1280,1152,1104,1072,1024,960)
  --port <n>            dev-server port to boot on / check against (default 5173)
  --url <origin>        check an already-running server instead of booting one
  --project <slug>      only this project (default: every project in the vault)
  --slack <px>          how much overflow is rounding rather than a defect (default 0.75)
  --locale ko|en        which language to measure (default ko)`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
/* 1072 is not an ordinary width: it is the narrowest at which the dashboard still puts its
   two chart cards side by side, so it is where a plot is at its smallest and a tooltip has
   the least room to be laid out in — which is exactly where the card was found cutting it
   (see TIPCUT). The other six are the ones this gate has always walked. */
const WIDTHS = value("--widths", "1600,1440,1280,1152,1104,1072,1024,960")
  .split(",")
  .map((w) => Number(w.trim()))
  .filter(Boolean);
const WANT_PROJECT = (value("--project", "") || "").trim();
const SLACK = Number(value("--slack", "0.75"));
/* Which language's strings are being measured. Korean is shorter in most labels and wider
   per glyph, so a box that fits one can cut the other: both are walked (`--locale en`). */
const LOCALE = value("--locale", process.env.SHOT_LOCALE || "ko");

const log = (...m) => console.log("[check-clipping]", ...m);

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/project-api${path}`);
  if (!res.ok) throw new Error(`GET /project-api${path} -> ${res.status}`);
  return res.json();
};

/**
 * Runs in the page. Returns `{ clipped, overlaps }`.
 *
 * `slack` (px) is the tolerance: sub-pixel rounding of a rect against a padding box is not
 * a clip, a third of a character is.
 */
const PROBE = (slack) => {
  const style = (el) => getComputedStyle(el);
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };
  // `hidden`/`clip` cut; `auto`/`scroll` can be reached by the reader, so they do not.
  const cutsHorizontally = (el) => {
    const o = style(el).overflowX;
    return o === "hidden" || o === "clip";
  };
  const boundsHorizontally = (el) => cutsHorizontally(el) || /auto|scroll/.test(style(el).overflowX);
  /** The padding box: overflow is clipped there, not at the border edge. */
  const padBox = (el) => {
    const b = el.getBoundingClientRect();
    const s = style(el);
    return {
      left: b.left + parseFloat(s.borderLeftWidth || "0"),
      right: b.right - parseFloat(s.borderRightWidth || "0"),
      top: b.top + parseFloat(s.borderTopWidth || "0"),
      bottom: b.bottom - parseFloat(s.borderBottomWidth || "0"),
    };
  };

  // -- 1. clipped: a box cuts a descendant that is not the one truncating ----------------
  const clipped = [];
  for (const el of document.querySelectorAll("*")) {
    if (!cutsHorizontally(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0) continue;
    const { left: padLeft, right: padRight } = padBox(el);

    for (const child of el.querySelectorAll("*")) {
      if (child.children.length) continue; // only leaves carry ink
      const text = (child.textContent || "").trim();
      if (!text) continue;
      // Purely geometric on purpose. `text-overflow: ellipsis` on the child proves
      // nothing: when the child fits its own box and the box is what sticks out, the
      // ellipsis never fires and the ancestor cuts a glyph in half — the exact defect
      // this script exists to catch.
      let r = child.getBoundingClientRect();
      if (r.width === 0) continue;
      // …but a box between the two that bounds the child — a `pre` that scrolls its own
      // code, a table in its own scroller — already decides what reaches this one. Only
      // the part it lets through can be cut, and if that box itself sticks out, this still
      // catches it (the clamped ink sticks out with it).
      for (let up = child.parentElement; up && up !== el; up = up.parentElement) {
        if (!boundsHorizontally(up)) continue;
        const p = padBox(up);
        r = { left: Math.max(r.left, p.left), right: Math.min(r.right, p.right) };
      }
      if (r.right - r.left <= 0) continue;
      const over = Math.max(r.right - padRight, padLeft - r.left);
      if (over > slack) {
        clipped.push({
          clipper: label(el),
          cut: label(child),
          text: text.slice(0, 60),
          px: Math.round(over * 10) / 10,
        });
      }
    }
  }

  // -- 2. overlap: two pieces of ink in the same pixels -----------------------------------
  /**
   * The rectangles the text actually paints in, clipped by every ancestor that bounds
   * horizontal overflow — hidden and clip, but scrollports too: a `pre` scrolling a long
   * line paints nothing outside itself, so that line cannot be lying on top of the sidebar.
   * An honest ellipsis therefore reports the width the reader sees, not the width the
   * string wanted.
   *
   * Vertically the rule is the same but it stops at the first scrollport. A two-line clamp
   * (`-webkit-line-clamp`, which is `overflow-y: hidden` plus a height) paints two lines and
   * nothing else — the third line exists in the layout but never reaches a pixel, so it
   * cannot be lying on top of the row beneath it. The walk stops at the first `auto`/`scroll`
   * ancestor because content below the fold of the scrolling `.main` is off screen, not
   * broken, and must still be measured — without that stop, `.app { overflow: hidden }`
   * would excuse every overlap below 1000px.
   *
   * (A clamp hides words, so anything clamped must carry the whole string in a `title`; that
   * is a rule for the screens, not something this geometric probe can check.)
   */
  const cutsVertically = (el) => {
    const o = style(el).overflowY;
    return o === "hidden" || o === "clip";
  };
  const scrollsVertically = (el) => /auto|scroll/.test(style(el).overflowY);

  const inkRects = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    let rects = [...range.getClientRects()].map((r) => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    }));
    for (let el = node.parentElement; el && rects.length; el = el.parentElement) {
      if (!boundsHorizontally(el)) continue;
      const p = padBox(el);
      rects = rects
        .map((r) => ({ ...r, left: Math.max(r.left, p.left), right: Math.min(r.right, p.right) }))
        .filter((r) => r.right - r.left > 0.5);
    }
    for (let el = node.parentElement; el && rects.length; el = el.parentElement) {
      if (scrollsVertically(el)) break;
      if (!cutsVertically(el)) continue;
      const p = padBox(el);
      rects = rects
        .map((r) => ({ ...r, top: Math.max(r.top, p.top), bottom: Math.min(r.bottom, p.bottom) }))
        .filter((r) => r.bottom - r.top > 0.5);
    }
    return rects;
  };

  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || "").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const s = style(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
    for (const r of inkRects(node)) {
      if (r.right - r.left > 0.5 && r.bottom - r.top > 0.5) items.push({ el, text, r });
    }
  }

  // Sweep by left edge: only rectangles that start before the current one ends can touch it.
  items.sort((a, b) => a.r.left - b.r.left);
  const overlaps = [];
  const seen = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j];
      if (b.r.left >= a.r.right - 1) break;
      if (a.el === b.el) continue;
      // A nested element's text is laid out inside its ancestor's, never on top of it.
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const dx = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const dy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (dx <= 1 || dy <= 1) continue;
      const key = `${label(a.el)}|${a.text}|${label(b.el)}|${b.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      overlaps.push({
        a: label(a.el),
        b: label(b.el),
        textA: a.text.slice(0, 40),
        textB: b.text.slice(0, 40),
        px: Math.round(dx * 10) / 10,
      });
    }
  }

  // -- 3. truncated: a heading that shortens its own word ---------------------------------
  /**
   * The two checks above are about a box cutting something *else*. This one is about a box
   * that is honestly too small for its own text and says so with an ellipsis — which is the
   * right answer for a project name or an agent name (the reader can hover, and the whole
   * string is in a `title`), and the wrong answer for a heading.
   *
   * A column heading, a card title or a `dt` is the app's own vocabulary: fixed strings the
   * reader has to be able to read to know what the numbers under them mean. "RESOL…" over a
   * column of bug counts shipped twice — 46px, then a 62px guess — and passed this gate both
   * times, because an ellipsis was present and the ancestor was not the one doing the
   * cutting. So headings are held to a stricter rule than the rest of the screen: they must
   * fit.
   */
  const HEADINGS = [
    ".agent-head > *",
    "th",
    "dt",
    ".card-title",
    ".section-title",
    ".side-card-title",
    ".rec-fact-label",
    ".field-label",
    ".now-label",
    ".vault-bar-label",
  ].join(", ");

  const truncated = [];
  for (const el of document.querySelectorAll(HEADINGS)) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    const s = style(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    // Only a single-line box can truncate horizontally; a wrapping heading is fine.
    if (!cutsHorizontally(el)) continue;
    const over = el.scrollWidth - el.clientWidth;
    if (over > slack) {
      truncated.push({ el: label(el), text: text.slice(0, 40), px: Math.round(over * 10) / 10 });
    }
  }

  return { clipped, overlaps, truncated };
};

/**
 * Where the crosshair is put on each plot, as a fraction of its width.
 *
 * The two near the ends are the point. A tooltip is laid out in the room left between the
 * crosshair and the edge of the plot, so near the right edge it comes out at its 168px floor
 * rather than its 260px ceiling — which is the only width at which the defect below exists.
 * The five in the middle are there so a finding can be told apart from "this tip is always
 * broken".
 *
 * 0.35 and 0.65 are the round-8 pair, and they are here because they are *not* ordinary
 * middles: they are where the tip's anchor changes hands. Left-anchored below 130px from the
 * left edge, right-anchored above 130px from the right, centred between — on a 346px plot
 * those bands overlap nowhere and touch nowhere, and the two crosshairs that fall in the
 * seams were the two this list stepped over (0.2 and 0.4 sit either side of 0.35). A gate
 * that samples round fractions samples the middle of the states, never their boundaries.
 */
const CROSSHAIRS = [0.03, 0.2, 0.35, 0.4, 0.6, 0.65, 0.8, 0.94, 0.99];

/**
 * Runs in the page. Returns every piece of tooltip text painted outside its own card.
 *
 * The three questions above walk a *loaded screen*, and a tooltip is not on one: it exists
 * only while a chart is hovered or focused, so nothing in this repo had ever measured one.
 * Round 6 shipped `flex: none` on the tip's value and label to stop Korean breaking inside
 * them, and it stopped them wrapping at all: at the 168px floor an English label wider than
 * the room left painted its last letters over the plot, outside the rounded border — 48 of
 * 1792 readings, every one English, every one "10 done or abandoned" near the right edge
 * (P9 round 6 critic). This gate passed it, because nothing was clipped: the card does not
 * hide its overflow, it lets it out. `ChartTip`'s own doc comment promises the tip "flips
 * rather than leaving the card", so the promise is now measured.
 *
 * Ink, not boxes, and clipped by any ancestor that bounds horizontal overflow — `.tip-added`
 * ellipsises the ids on purpose, and an honest ellipsis is not an escape.
 *
 * …and then the question that clipping makes it blind to, which is why both live in one
 * probe: **is the tip itself inside the boxes that clip it?** The loop above deliberately
 * intersects each run of ink with every ancestor that hides overflow before comparing it to
 * the tip, so a tooltip with 19px sliced off its right edge by its own card reports nothing
 * at all — the ink that survived is inside the tip, and the ink that did not is gone.
 * `kind: "cut"` measures the tip's border box against those same ancestors' content boxes,
 * which is the reader's question: is any of this tooltip missing? (P9 round 8 critic.)
 */
const TIP_PROBE = (slack) => {
  const style = (el) => getComputedStyle(el);
  const bounds = (el) => /hidden|clip|auto|scroll/.test(style(el).overflowX);
  /** The content box: the card's own padding is where its text is allowed to end. */
  const contentBox = (el) => {
    const b = el.getBoundingClientRect();
    const s = style(el);
    return {
      left: b.left + parseFloat(s.borderLeftWidth || "0") + parseFloat(s.paddingLeft || "0"),
      right: b.right - parseFloat(s.borderRightWidth || "0") - parseFloat(s.paddingRight || "0"),
    };
  };
  const out = [];
  for (const tip of document.querySelectorAll(".chart-tip")) {
    const inner = contentBox(tip);

    /* The tip's own box against everything that clips it. */
    const own = tip.getBoundingClientRect();
    for (let el = tip.parentElement; el; el = el.parentElement) {
      if (!bounds(el)) continue;
      const p = contentBox(el);
      const cut = Math.max(p.left - own.left, own.right - p.right);
      if (cut <= slack) continue;
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
      out.push({
        kind: "cut",
        el: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
        text: (tip.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
        px: Math.round(cut * 10) / 10,
        tip: Math.round(own.width),
      });
    }
    const walker = document.createTreeWalker(tip, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent || "").trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      let rects = [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right }));
      for (let el = node.parentElement; el && el !== tip; el = el.parentElement) {
        if (!bounds(el)) continue;
        const p = contentBox(el);
        rects = rects
          .map((r) => ({ left: Math.max(r.left, p.left), right: Math.min(r.right, p.right) }))
          .filter((r) => r.right - r.left > 0.5);
      }
      for (const r of rects) {
        const over = Math.max(inner.left - r.left, r.right - inner.right);
        if (over > slack) {
          const el = node.parentElement;
          const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
          out.push({
            kind: "ink",
            el: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
            text: node.textContent.trim().slice(0, 40),
            px: Math.round(over * 10) / 10,
            tip: Math.round(tip.getBoundingClientRect().width),
          });
        }
      }
    }
  }
  return out;
};

let browser = null;
let server = null;
let failures = 0;
let checked = 0;
/** How many open tooltips were measured — a screen load is not a reading of one. */
let tipReadings = 0;

try {
  ({ server } = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  }));

  const rows = await api("/projects");
  const projects = rows.filter((r) => r.available && r.project).map((r) => r.project);
  const wanted = WANT_PROJECT ? projects.filter((p) => p.name === WANT_PROJECT || p.id === WANT_PROJECT) : projects;
  if (!wanted.length) {
    throw new Error(
      `no project '${WANT_PROJECT}' on this list. Known projects: ${projects.map((p) => p.name).join(", ")}`,
    );
  }

  /** Every screen of the app, and every record in it. All of them count. */
  const screens = [];
  for (const p of wanted) {
    const bugs = await api(`/projects/${p.id}/bugs`);
    const works = await api(`/projects/${p.id}/worklogs`);
    const notes = await api(`/projects/${p.id}/notes`);
    // `tips` marks the screens that have charts, whose tooltips are opened and measured.
    screens.push({ path: `/p/${p.id}`, tips: true });
    // …and the same charts over a wider window, where a bucket holds more ids and the tip
    // has more to fit into the same 168px.
    screens.push({ path: `/p/${p.id}?range=all`, tips: true });
    screens.push({ path: `/p/${p.id}/work` });
    screens.push({ path: `/p/${p.id}/bugs` });
    // The board opens on the bugs that still need someone; the dense view is All.
    screens.push({ path: `/p/${p.id}/bugs?tab=all` });
    screens.push({ path: `/p/${p.id}/notes` });
    for (const w of works) screens.push({ path: `/p/${p.id}/work/${w.id}` });
    for (const b of bugs) screens.push({ path: `/p/${p.id}/bugs/${b.id}` });
    // Every note too: a note's id is its kebab name, so its screens are addressed by name.
    for (const n of notes) screens.push({ path: `/p/${p.id}/notes/${n.name}` });
  }
  screens.push({ path: "/projects" });

  /* A record screen is a work log's or a bug's (uppercase id) — or a note's, whose name is
     lowercase kebab, which is why the two shapes are matched apart. */
  const records = screens.filter(
    (s) => /\/(work|bugs)\/[A-Z]/.test(s.path) || /\/notes\/[a-z0-9-]+/.test(s.path),
  ).length;
  log(
    `${screens.length} screens (${records} records in ${wanted.length} project(s)) × ${WIDTHS.length} widths · ${LOCALE}`,
  );

  browser = await chromium.launch();

  /** One page per width, walked in parallel: the widths do not interact. */
  const walk = async (width) => {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await useLocale(page, LOCALE);
    const lines = [];
    try {
      for (const screen of screens) {
        await page.goto(`${ORIGIN}${screen.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".page-title, .record-title", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        // A chart is drawn at the measured pixel width of its container, so it lands one
        // frame after the data. Probing between the two would measure an empty card and
        // call it clean.
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".chart-plot")].every((p) => p.querySelector("svg")),
        );
        await page.evaluate(() => document.fonts.ready);
        const { clipped, overlaps, truncated } = await page.evaluate(PROBE, SLACK);
        const where = `${String(width).padEnd(5)} ${screen.path.padEnd(38)}`;
        for (const f of clipped) {
          failures += 1;
          lines.push(`CLIPPED ${where} ${f.clipper} cuts ${f.cut} by ${f.px}px — "${f.text}"`);
        }
        for (const t of truncated) {
          failures += 1;
          lines.push(`TRUNCATED ${where} ${t.el} shortens its own heading by ${t.px}px — "${t.text}"`);
        }
        for (const o of overlaps) {
          failures += 1;
          lines.push(
            `OVERLAP ${where} ${o.a} over ${o.b} by ${o.px}px — "${o.textA}" / "${o.textB}"`,
          );
        }
        checked += 1;

        // -- 4. a tooltip that leaves its card (see TIP_PROBE) ------------------------
        if (screen.tips) {
          const plots = page.locator(".chart-plot");
          for (let i = 0; i < (await plots.count()); i += 1) {
            const box = await plots.nth(i).boundingBox();
            if (!box) continue;
            for (const f of CROSSHAIRS) {
              await page.mouse.move(box.x + box.width * f, box.y + box.height / 2);
              /* The tip follows the crosshair one React commit later, so a probe that runs
                 straight after the move measures the *previous* bucket in the *previous*
                 position — which is how a 168px card at the right edge gets read as the
                 260px one in the middle, and how this check first passed a mutation that
                 puts `flex: none` back. So: wait until two frames running report the same
                 card in the same place, and give up after 300ms rather than trusting a page
                 whose frames are throttled to ever settle. */
              await page.evaluate(
                () =>
                  new Promise((resolve) => {
                    const read = () => {
                      const tip = document.querySelector(".chart-tip");
                      return tip
                        ? `${Math.round(tip.getBoundingClientRect().left)}|${tip.textContent}`
                        : "";
                    };
                    const deadline = performance.now() + 300;
                    let last = read();
                    const frame = () => {
                      const now = read();
                      if (now === last || performance.now() > deadline) return resolve();
                      last = now;
                      requestAnimationFrame(frame);
                    };
                    requestAnimationFrame(frame);
                  }),
              );
              if (!(await page.locator(".chart-tip").count())) continue;
              tipReadings += 1;
              for (const o of await page.evaluate(TIP_PROBE, SLACK)) {
                failures += 1;
                lines.push(
                  o.kind === "cut"
                    ? `TIPCUT  ${where} ${o.el} cuts ${o.px}px off the ${o.tip}px tooltip ` +
                      `(plot ${i + 1}, crosshair ${f}) — "${o.text}"`
                    : `TIP     ${where} ${o.el} paints ${o.px}px outside its ${o.tip}px card ` +
                      `(plot ${i + 1}, crosshair ${f}) — "${o.text}"`,
                );
              }
            }
          }
          await page.mouse.move(0, 0);
        }
      }
    } finally {
      await page.close();
    }
    for (const line of lines) console.log(line);
    log(`${width}px — ${screens.length} screens checked`);
  };

  await Promise.all(WIDTHS.map(walk));
} catch (err) {
  failures += 1;
  console.error(`[check-clipping] FAILED: ${err.message}`);
} finally {
  if (browser) await browser.close();
  if (server) await stopServer(server);
}

log(`${checked} screen loads, ${tipReadings} open tooltips`);
log(
  failures === 0
    ? "clean: nothing is cut without an ellipsis, no heading truncates itself, nothing is painted over anything, and no tooltip leaves its card or is cut by it"
    : `${failures} finding(s)`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
