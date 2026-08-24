#!/usr/bin/env node
/**
 * The pictures inside records, measured — because nothing else here can see inside one.
 *
 *   npm run check:scenes
 *   node scripts/check-scenes.mjs [--dir <project folder>] [--verbose]
 *
 * ## Why this gate exists
 *
 * A record's picture is a **scene**: one drawing per beat of a retelling, drawn inside that
 * beat above its words (docs/HUMAN_STYLE.md, "A picture is one beat's scene"). The contract
 * asks three things of the drawing itself that no other check in this repo can reach:
 *
 *   * **bands** — icons in one band, the words naming them in the next, the closing line in
 *     its own; nothing crosses into another band *at any width the page draws it at*;
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
 * So this opens each scene in a real browser, takes `getBBox()` for every `<text>`, and
 * fails on an overlap, a label within {@link MARGIN} units of the edge, or type that comes
 * back under 11 at the narrow column. Then it does the whole pass again with the two faces
 * forced to wide ones (Verdana, Lucida Console), standing in for a reader whose interface
 * face is wider than this machine's — which is what "leave a fifth of the box empty" is
 * asking for, checked rather than estimated.
 *
 * It also keeps the folder honest in both directions: a scene a record points at must
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
  console.log(`Measure every per-beat scene in a project's assets/ folder.

  npm run check:scenes
  node scripts/check-scenes.mjs [--dir <project folder>] [--verbose]

Opens each scene SVG in Chromium and fails on a label that overlaps another, one that sits
within ${14} units of the edge, or type that comes back under 11 at the narrowest column a
record page gives a picture — twice, the second time in a deliberately wider face. Also
fails on a scene no record references, and on a reference to a scene that is not there.`);
  process.exit(0);
}

const VERBOSE = args.includes("--verbose") || args.includes("-v");
const dirArg = args.indexOf("--dir");
const projectDir = dirArg >= 0 && args[dirArg + 1] ? args[dirArg + 1] : join(root, "AgentMonitoring");
const assets = join(projectDir, "assets");

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
/** The size every label in a scene is drawn at on the contract's 700 grid. */
const GRID_TYPE = 22;

/** `<record>-<beat>-<what it shows>.svg` — the contract's own name for a scene. */
const SCENE = /^(?:bug|work)-\d{4}-\d{1,2}-.+\.svg$/i;

const log = (...m) => console.log("[check-scenes]", ...m);
const die = (msg) => {
  console.error(`[check-scenes] FAILED: ${msg}`);
  process.exit(1);
};

if (!existsSync(assets)) {
  log(`no assets folder at ${assets} — nothing to measure`);
  process.exit(0);
}

/* ── which scenes are there, and does anything point at them ────────────────── */
const files = readdirSync(assets).filter((f) => SCENE.test(f));
const records = ["bugs", "worklogs", "notes", "feedback"]
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

const problems = [];
for (const [asset, record] of referenced) {
  if (!existsSync(join(assets, asset))) {
    problems.push(`${record} points at assets/${asset}, which is not there`);
  }
}
for (const file of files) {
  if (!referenced.has(file)) {
    problems.push(`${file} is a scene no record points at — a rework left it behind`);
  }
}

if (!files.length) {
  log(`no per-beat scenes in ${assets} — nothing to measure`);
  if (problems.length) problems.forEach((p) => console.error(`        ${p}`));
  process.exit(problems.length ? 1 : 0);
}

/* ── and do their labels hold, in two faces ─────────────────────────────────── */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

try {
  for (const file of files) {
    const svg = readFileSync(join(assets, file), "utf8");
    for (const wide of [false, true]) {
      const doc = wide
        ? svg.replace(
            "</style>",
            `.s { font-family: Verdana, sans-serif !important; }
             .m { font-family: "Lucida Console", monospace !important; }</style>`,
          )
        : svg;
      await page.setContent(`<body style="margin:0">${doc}</body>`);
      const found = await page.evaluate(() => {
        const root = document.querySelector("svg");
        if (!root) return null;
        const vb = root.viewBox.baseVal;
        return {
          w: vb.width,
          h: vb.height,
          texts: [...root.querySelectorAll("text")].map((t) => {
            const b = t.getBBox();
            return {
              text: t.textContent.trim().slice(0, 40),
              size: parseFloat(getComputedStyle(t).fontSize),
              x: b.x,
              y: b.y,
              w: b.width,
              h: b.height,
            };
          }),
        };
      });
      const where = `${file}${wide ? " (wide face)" : ""}`;
      if (!found) {
        problems.push(`${where}: no <svg> element — the file is not a drawing`);
        continue;
      }
      const scale = Math.min(NARROW / found.w, MAX_HEIGHT / found.h);
      for (const t of found.texts) {
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
            `${GRID_TYPE} on the grid → ${(GRID_TYPE * scale).toFixed(1)}px at ${NARROW}`,
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
    `${problems.length} problem(s) in ${files.length} scene(s). A scene is bands — icons, ` +
      `then their labels, then the closing line — and nothing may cross one at any width ` +
      `(docs/HUMAN_STYLE.md).`,
  );
}

log(
  `clean: ${files.length} scene(s) in ${assets}, each measured in two faces — no overlap, ` +
    `nothing past the edge, and ${GRID_TYPE} on the grid comes back at ` +
    `${(GRID_TYPE * Math.min(NARROW / 700, 1)).toFixed(1)}px or more at the ${NARROW}-wide column`,
);
