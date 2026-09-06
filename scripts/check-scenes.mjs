#!/usr/bin/env node
/**
 * The pictures inside records, measured — because nothing else here can see inside one.
 *
 *   npm run check:scenes
 *   node scripts/check-scenes.mjs [--dir <project folder>] [--verbose]
 *
 * ## Why this gate exists
 *
 * A record's picture explains a relationship, sequence or visible change. Its layout
 * follows that question, not a prescribed stack of panels. This checks geometry,
 * never whether the explanation is meaningful (docs/HUMAN_STYLE.md, policy v4):
 *
 *   * **label bounds** — transformed into the same SVG coordinates before comparison;
 *   * **a type floor** — the labels are sized for the narrowest column a record page ever
 *     gives a picture, and 11 is the bottom of this app's type scale (tokens.css);
 *   * **a fifth of every label's box left empty** — the picture is an `<img>`, so it is set
 *     in the reader's own interface face, which is a different width on every machine.
 *
 * `scripts/check-clipping.mjs` reads the *page*. The words in a scene sit inside an image,
 * which is a document of its own: two labels that clear each other by a hair are a silent
 * defect there, and the round before this one shipped exactly that — scaled diagram text
 * under the 11px floor in a width band nobody had photographed.
 *
 * So this opens each scene in a real browser, transforms `getBBox()` for every `<text>`, and
 * fails on an overlap, a label within {@link MARGIN} units of the edge, or type that comes
 * back under 11 at the narrow column. Then it does the whole pass again with the two faces
 * forced to wide ones (Verdana, Lucida Console), standing in for a reader whose interface
 * face is wider than this machine's — which is what "leave a fifth of the box empty" is
 * asking for, checked rather than estimated. It also fails a root that carries a `viewBox`
 * and no `width`/`height`: an `<img>` has no intrinsic size for such a file and draws it
 * small — a scene shipped exactly that way (owner feedback, 2026-08-25), green here
 * because this gate read the geometry and never the root.
 *
 * What it measures is every scene-named file **and every SVG any record cites** — not the
 * name pattern alone, which skipped the drawings notes cite (their names carry no record
 * id). --asset selects a draft without requiring a premature record. A full scan also
 * keeps the folder honest in both directions: a scene a record points at must
 * exist, and a scene file no record points at is a leftover from a rework (three were, the
 * day per-beat scenes replaced one diagram per record).
 *
 * Reads a project folder and a browser. Writes nothing.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Measure diagram geometry in a project's assets/ folder.

  npm run check:scenes
  node scripts/check-scenes.mjs [--dir <project folder>] [--asset <filename.svg>] [--verbose]

Opens every scene SVG a record cites (and every scene-named one) in Chromium and fails on
a label that overlaps another, one that sits within ${14} units of the edge, or type that
comes back under 11 at the narrowest column a record page gives a picture — twice, the
second time in a deliberately wider face. Also fails on an <svg> root with no
width/height (an <img> has no size for it), on a scene no record references, and on a
reference to a scene that is not there. --asset checks just that draft, even before
a record cites it. Passing checks geometry, not explanatory quality.`);
  process.exit(0);
}

const VERBOSE = args.includes("--verbose") || args.includes("-v");
const dirArg = args.indexOf("--dir");
const projectDir = dirArg >= 0 && args[dirArg + 1] ? args[dirArg + 1] : join(root, "AgentMonitoring");
const assets = join(projectDir, "assets");
const assetArg = args.indexOf("--asset");
const selectedAsset = assetArg >= 0 ? args[assetArg + 1] : null;

/** How close a label may come to the edge of its own drawing. */
const MARGIN = 14;
/**
 * The narrowest column a record page gives a picture, and the ceiling the page puts on its
 * height (`.prose-img`, app.css). Both are in the scale, because a tall drawing is shrunk
 * by the height rather than by the column — the arithmetic in docs/HUMAN_STYLE.md.
 */
const NARROW = 395;
const MAX_HEIGHT = 560;
/** The bottom of this app's type scale (tokens.css, `--text-2xs`). */
const FLOOR = 11;
/** Legacy scene names remain included in a full scan. */
const SCENE = /^(?:bug|work)-\d{4}-\d{1,2}-.+\.svg$/i;

const log = (...m) => console.log("[check-scenes]", ...m);
const die = (msg) => {
  console.error(`[check-scenes] FAILED: ${msg}`);
  process.exit(1);
};

if (assetArg >= 0 && (!selectedAsset || !/^[^/\\:]+\.svg$/i.test(selectedAsset))) {
  die("--asset needs an SVG filename within assets/, without a path");
}
if (selectedAsset && !existsSync(join(assets, selectedAsset))) {
  die(`selected asset is not there: ${join(assets, selectedAsset)}`);
}

if (!existsSync(assets)) {
  log(`no assets folder at ${assets} — nothing to measure`);
  process.exit(0);
}

/* ── which scenes are there, and does anything point at them ────────────────── */
const records = (selectedAsset ? [] : ["bugs", "worklogs", "notes", "feedback"])
  .map((d) => join(projectDir, d))
  .filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => join(d, f)));

/**
 * Every asset a record really points at.
 *
 * Fences and code spans come off first, because a record that *documents* the syntax is not
 * citing a file: `![alt](assets/diagram.svg)` inside backticks is what the agent manual's
 * own record (WORK-0040) writes to explain the feature, and the app draws it as code, not as
 * a picture. Reading those as citations turned this gate red on two records that are right.
 */
const referenced = new Map();
for (const file of records) {
  const text = readFileSync(file, "utf8")
    .replace(/^(?:```|~~~)[\s\S]*?^(?:```|~~~)\s*$/gm, "")
    .replace(/`[^`]*`/g, "");
  for (const m of text.matchAll(/!\[[^\]]*\]\((assets\/[^)\s]+)\)/g)) {
    referenced.set(m[1].slice("assets/".length), file.split(/[\\/]/).slice(-1)[0]);
  }
}

/**
 * What gets measured: every scene-named file, and every SVG any record actually cites —
 * a note's drawing carries no record id in its name, and skipping it left a whole class
 * of shipped pictures that nothing ever measured.
 */
const files = selectedAsset ? [selectedAsset] : readdirSync(assets).filter(
  (f) => /\.svg$/i.test(f) && (SCENE.test(f) || referenced.has(f)),
);

const problems = [];
for (const [asset, record] of referenced) {
  if (!existsSync(join(assets, asset))) {
    problems.push(`${record} points at assets/${asset}, which is not there`);
  }
}
for (const file of files) {
  if (!selectedAsset && !referenced.has(file)) {
    problems.push(`${file} is a scene no record points at — a rework left it behind`);
  }
}

if (!files.length) {
  log(`no referenced diagrams in ${assets} — nothing to measure`);
  if (problems.length) problems.forEach((p) => console.error(`        ${p}`));
  process.exit(problems.length ? 1 : 0);
}

/* ── and do their labels hold, in two faces ─────────────────────────────────── */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
let smallestDisplayed = Infinity;

try {
  for (const file of files) {
    const svg = readFileSync(join(assets, file), "utf8");
    for (const wide of [false, true]) {
      await page.setContent(`<body style="margin:0">${svg}</body>`);
      const found = await page.evaluate(async (wide) => {
        const root = document.querySelector("svg");
        if (!root) return null;
        // Presentation attributes, inline styles and inherited fonts all occur in
        // real diagrams. Overriding only .s/.m silently skipped many wide-font checks.
        const labels = [...root.querySelectorAll("text")];
        if (wide) {
          for (const label of labels) {
            for (const node of [label, ...label.querySelectorAll("tspan")]) {
              const mono = /monospace|console|courier|consolas/i.test(getComputedStyle(node).fontFamily);
              node.style.setProperty("font-family", mono ? '"Lucida Console", monospace' : "Verdana, sans-serif", "important");
            }
          }
        }
        await document.fonts.ready;
        const vb = root.viewBox.baseVal;
        const width = root.width.baseVal, height = root.height.baseVal;
        const fixedSize = [width, height].every(length => length.value > 0 && ![0, 2, 3, 4].includes(length.unitType));
        const rootMatrix = root.getCTM();
        const rootInverse = root.getCTM()?.inverse();
        const smallestScale = matrix => {
          const sum = matrix.a ** 2 + matrix.b ** 2 + matrix.c ** 2 + matrix.d ** 2;
          const det = matrix.a * matrix.d - matrix.b * matrix.c;
          return Math.sqrt(Math.max(0, (sum - Math.sqrt(Math.max(0, sum ** 2 - 4 * det ** 2))) / 2));
        };
        return {
          w: vb.width,
          h: vb.height,
          pixelWidth: width.value,
          pixelHeight: height.value,
          fixedSize,
          sized: root.hasAttribute("width") && root.hasAttribute("height"),
          texts: !fixedSize || !rootMatrix || !(vb.width > 0 && vb.height > 0) ? [] : labels.map((t) => {
            const b = t.getBBox();
            const rendered = t.getCTM();
            const matrix = rootInverse.multiply(rendered);
            const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
              .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
            const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
            // Smallest singular value includes ancestor scales (and shear), so a
            // 22px label inside scale(.5) cannot pass as if it were still 22px.
            // Include the root's viewport/viewBox transform too: different aspect
            // ratios can letterbox the drawing far below its apparent canvas size.
            const fontScale = smallestScale(rendered);
            return {
              text: t.textContent.trim().slice(0, 40),
              size: Math.min(...[t, ...t.querySelectorAll("tspan")].map(node => parseFloat(getComputedStyle(node).fontSize))) * fontScale,
              x: Math.min(...xs) - vb.x,
              y: Math.min(...ys) - vb.y,
              w: Math.max(...xs) - Math.min(...xs),
              h: Math.max(...ys) - Math.min(...ys),
            };
          }),
        };
      }, wide);
      const where = `${file}${wide ? " (wide face)" : ""}`;
      if (!found) {
        problems.push(`${where}: no <svg> element — the file is not a drawing`);
        continue;
      }
      if (!(found.w > 0 && found.h > 0)) {
        problems.push(`${where}: a positive viewBox width and height are required`);
        continue;
      }
      // The root's own size, once per file: a viewBox-only root gives an <img> no
      // intrinsic size, and every page that hangs the drawing in one draws it small.
      if (!wide && !found.sized) {
        problems.push(
          `${where}: the <svg> root has no width/height, so an <img> has no size for it — ` +
            `write the grid onto the root (width="${found.w}" height="${found.h}")`,
        );
      }
      if (!found.fixedSize) {
        if (found.sized) problems.push(`${where}: width/height must be positive fixed lengths, not percentages or font-relative units`);
        continue;
      }
      const scale = Math.min(NARROW / found.pixelWidth, MAX_HEIGHT / found.pixelHeight);
      for (const t of found.texts) {
        smallestDisplayed = Math.min(smallestDisplayed, t.size * scale);
        if (t.size * scale < FLOOR - 0.001) {
          problems.push(
            `${where}: “${t.text}” is ${t.size} on the grid → ${(t.size * scale).toFixed(1)}px at ${NARROW} wide`,
          );
        }
        if (t.x < MARGIN || t.y < MARGIN || t.x + t.w > found.w - MARGIN || t.y + t.h > found.h - MARGIN) {
          problems.push(`${where}: “${t.text}” is outside the drawing, or within ${MARGIN} of its edge`);
        }
      }
      for (let i = 0; i < found.texts.length; i += 1) {
        for (let j = i + 1; j < found.texts.length; j += 1) {
          const a = found.texts[i];
          const b = found.texts[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
            problems.push(`${where}: “${a.text}” overlaps “${b.text}”`);
          }
        }
      }
      if (VERBOSE) {
        log(
          `${where}: ${found.texts.length} labels, ${found.w}x${found.h}, ` +
            `smallest displayed label ${Math.min(...found.texts.map(t => t.size * scale)).toFixed(1)}px at ${NARROW}`,
        );
      }
    }
  }
} finally {
  await browser.close();
}

if (problems.length) {
  for (const p of problems) console.error(`        ${p}`);
  die(
    `${problems.length} problem(s) in ${files.length} diagram(s). Keep labels readable ` +
      `and separate in the displayed layout (docs/HUMAN_STYLE.md).`,
  );
}

log(
  `clean: ${files.length} diagram(s) in ${assets}, measured in two faces — no label overlap ` +
    `or edge intrusion; ${Number.isFinite(smallestDisplayed) ? `smallest displayed label ${smallestDisplayed.toFixed(1)}px` : "no text labels"}. ` +
    `This checks geometry, not explanatory quality.`,
);
