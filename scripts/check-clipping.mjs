#!/usr/bin/env node
/**
 * Find text this app destroys: ink that is cut in half, and ink painted on top of other ink.
 *
 *   npm run check:clipping
 *   node scripts/check-clipping.mjs [--port 5173] [--widths 1600,1280,1104,960]
 *                                  [--project relay] [--include-dashboard] [--url ORIGIN]
 *
 * Two defects, one gate, because they are the same failure seen from two sides — a box that
 * is smaller than what it holds:
 *
 *   CLIPPED  a fixed-width box with `overflow: hidden` guillotines whatever sticks out, and
 *            `text-overflow: ellipsis` on an inner element does not fire — that element
 *            believes it fits, because it does; it is the *ancestor* that is too small. The
 *            reader gets "p3-bugs-builc" with nothing to warn them.
 *   OVERLAP  the same overflow with `overflow: visible` does not cut anything: it paints the
 *            escaping text over its neighbour. At 960px the bug strip printed
 *            "18 Aug 2026p0+f0undation-builder" — two facts in one set of pixels, and a
 *            clipping test sees nothing wrong because nothing was clipped (BUG-0007).
 *
 * Both are correctness bugs on screens whose whole job is to show a record faithfully, so
 * this walks EVERY record of EVERY project (not just the first one: the row that breaks is
 * always the one with the longest agent name) at every width, and exits non-zero if any
 * screen cuts text or stacks it.
 *
 * Overlap is measured on *painted ink*: the client rects of the text itself, clipped by any
 * ancestor that hides overflow — so a real ellipsis is not reported as an overlap, and text
 * below the fold is still measured.
 *
 * The dashboard is walked but excluded from the verdict (vault BUG-0006, still open, P4's
 * scope): its Agents table overflows its card, which would keep this gate permanently red
 * and therefore meaningless for everyone else. `--include-dashboard` puts it back in.
 *
 * Boots its own dev server when none is listening. Not part of the product; a builder's
 * tool, like shoot-region.mjs.
 */
import { chromium } from "playwright";
import { ensureServer, stopServer } from "./dev-server.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag("--help") || flag("-h")) {
  console.log(`Find text this app cuts in half or paints on top of itself.

  npm run check:clipping
  node scripts/check-clipping.mjs --widths 1600,960 --project relay

Options:
  --widths a,b,c        viewport widths to walk (default 1600,1440,1280,1152,1104,1024,960)
  --port <n>            dev-server port to boot on / check against (default 5173)
  --url <origin>        check an already-running server instead of booting one
  --project <slug>      only this project (default: every project in the vault)
  --include-dashboard   also fail on the dashboard (vault BUG-0006 keeps it red today)
  --slack <px>          how much overflow is rounding rather than a defect (default 0.75)`);
  process.exit(0);
}

const PORT = Number(value("--port", process.env.SHOT_PORT || 5173));
const ORIGIN = value("--url", `http://localhost:${PORT}`).replace(/\/$/, "");
const WIDTHS = value("--widths", "1600,1440,1280,1152,1104,1024,960")
  .split(",")
  .map((w) => Number(w.trim()))
  .filter(Boolean);
const WANT_PROJECT = (value("--project", "") || "").trim();
const INCLUDE_DASHBOARD = flag("--include-dashboard");
const SLACK = Number(value("--slack", "0.75"));

const log = (...m) => console.log("[check-clipping]", ...m);

const api = async (path) => {
  const res = await fetch(`${ORIGIN}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET /vault-api${path} -> ${res.status}`);
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
   * string wanted. Vertical clipping is deliberately not applied: content below the fold of
   * the scrolling `.main` is off screen, not broken, and must still be measured.
   */
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

  return { clipped, overlaps };
};

let browser = null;
let server = null;
let failures = 0;
let warnings = 0;
let checked = 0;

try {
  ({ server } = await ensureServer({
    origin: ORIGIN,
    port: PORT,
    requireRunning: args.includes("--url"),
    log,
  }));

  const projects = await api("/projects");
  const wanted = WANT_PROJECT ? projects.filter((p) => p.slug === WANT_PROJECT) : projects;
  if (!wanted.length) {
    throw new Error(
      `no project '${WANT_PROJECT}' in this vault. Known slugs: ${projects.map((p) => p.slug).join(", ")}`,
    );
  }

  /** Every screen of the app, and every record in it. `gate: false` = walked but not judged. */
  const screens = [];
  for (const p of wanted) {
    const bugs = await api(`/projects/${p.slug}/bugs`);
    const works = await api(`/projects/${p.slug}/worklogs`);
    screens.push({ path: `/p/${p.slug}`, gate: INCLUDE_DASHBOARD, why: "vault BUG-0006, P4" });
    screens.push({ path: `/p/${p.slug}/work` });
    screens.push({ path: `/p/${p.slug}/bugs` });
    // The board opens on the bugs that still need someone; the dense view is All.
    screens.push({ path: `/p/${p.slug}/bugs?tab=all` });
    for (const w of works) screens.push({ path: `/p/${p.slug}/work/${w.id}` });
    for (const b of bugs) screens.push({ path: `/p/${p.slug}/bugs/${b.id}` });
  }
  screens.push({ path: "/projects" });

  const records = screens.filter((s) => /\/(work|bugs)\/[A-Z]/.test(s.path)).length;
  log(
    `${screens.length} screens (${records} records in ${wanted.length} project(s)) × ${WIDTHS.length} widths`,
  );

  browser = await chromium.launch();

  /** One page per width, walked in parallel: the widths do not interact. */
  const walk = async (width) => {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const lines = [];
    try {
      for (const screen of screens) {
        await page.goto(`${ORIGIN}${screen.path}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".page-title, .record-title", { state: "visible" });
        await page.waitForFunction(() => !document.querySelector(".skeleton"));
        await page.evaluate(() => document.fonts.ready);
        const { clipped, overlaps } = await page.evaluate(PROBE, SLACK);
        const gated = screen.gate !== false;
        const where = `${String(width).padEnd(5)} ${screen.path.padEnd(38)}`;
        const note = gated ? "" : `  [not gated: ${screen.why}]`;
        for (const f of clipped) {
          if (gated) failures += 1;
          else warnings += 1;
          lines.push(
            `${gated ? "CLIPPED" : "clipped"} ${where} ${f.clipper} cuts ${f.cut} by ${f.px}px — "${f.text}"${note}`,
          );
        }
        for (const o of overlaps) {
          if (gated) failures += 1;
          else warnings += 1;
          lines.push(
            `${gated ? "OVERLAP" : "overlap"} ${where} ${o.a} over ${o.b} by ${o.px}px — ` +
              `"${o.textA}" / "${o.textB}"${note}`,
          );
        }
        checked += 1;
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

log(`${checked} screen loads`);
if (warnings) log(`${warnings} finding(s) on screens that are not gated (see the notes above)`);
log(
  failures === 0
    ? "clean: nothing is cut without an ellipsis, nothing is painted over anything"
    : `${failures} finding(s)`,
);
await new Promise((r) => setTimeout(r, 60));
process.exit(failures === 0 ? 0 : 1);
