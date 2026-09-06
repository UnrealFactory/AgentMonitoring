import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const checker = fileURLToPath(new URL("./check-scenes.mjs", import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "agentmon-scene-tests-"));
mkdirSync(join(fixture, "assets"));
// No records or registry entries: --asset must work before a draft is published.
test.after(() => {
  assert.equal(dirname(resolve(fixture)), resolve(tmpdir()));
  assert.ok(basename(fixture).startsWith("agentmon-scene-tests-"));
  rmSync(fixture, { recursive: true, force: true });
});

const svg = (body, attrs = 'width="700" height="180" viewBox="0 0 700 180"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="100%" height="100%" fill="#121317"/>${body}</svg>`;

function check(name, content) {
  writeFileSync(join(fixture, "assets", name), content);
  const result = spawnSync(process.execPath, [checker, "--dir", fixture, "--asset", name], { encoding: "utf8" });
  assert.ifError(result.error);
  return { code: result.status, output: result.stdout + result.stderr };
}

test("an unpublished draft with translated actor lanes has no false overlap", () => {
  const result = check("lanes.svg", svg('<g font-size="22" font-family="Arial" fill="white"><g transform="translate(50 65)"><text>Object A</text></g><g transform="translate(350 65)"><text>Object B</text></g></g>'));
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /geometry, not explanatory quality/);
});

test("scaled labels are checked at their displayed size", () => {
  const result = check("scaled.svg", svg('<g transform="translate(100 70) scale(.5)"><text font-size="22">Too small</text></g>'));
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /6\.2px/);
});

test("small text in a tspan is not hidden by the parent font size", () => {
  const result = check("span.svg", svg('<text x="50" y="65" font-size="22">A <tspan font-size="10">small label</tspan></text>'));
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /5\.6px/);
});

test("the wide-face pass reaches inherited fonts without CSS classes", async () => {
  const browser = await chromium.launch();
  let edge;
  try {
    const page = await browser.newPage();
    await page.setContent(svg('<text x="50" y="65" font-family="Arial" font-size="22">iiiiiiiiiiii</text>'));
    edge = await page.evaluate(async () => {
      const t = document.querySelector("text");
      await document.fonts.ready;
      const narrow = t.getBBox().width;
      t.setAttribute("font-family", "Verdana");
      await document.fonts.ready;
      const wide = t.getBBox().width;
      return { narrow, wide, secondX: 50 + (narrow + wide) / 2 };
    });
  } finally {
    await browser.close();
  }
  assert.ok(edge.wide > edge.narrow + 2, `fixture needs wider Verdana: ${JSON.stringify(edge)}`);
  const result = check("inherited.svg", svg(`<g font-family="Arial" font-size="22"><text x="50" y="65">iiiiiiiiiiii</text><text x="${edge.secondX}" y="65">next</text></g>`));
  assert.equal(result.code, 1, result.output);
  const overlaps = result.output.split(/\r?\n/).filter(line => line.includes("overlaps"));
  assert.ok(overlaps.length > 0, result.output);
  assert.ok(overlaps.every(line => line.includes("(wide face)")), result.output);
});

test("missing root size and absent viewBox are rejected", () => {
  const missingSize = check("unsized.svg", svg('<text x="50" y="65" font-size="22">Label</text>', 'viewBox="0 0 700 180"'));
  assert.equal(missingSize.code, 1, missingSize.output);
  assert.match(missingSize.output, /no width\/height/);
  const missingViewBox = check("no-viewbox.svg", svg('', 'width="700" height="180"'));
  assert.equal(missingViewBox.code, 1, missingViewBox.output);
  assert.match(missingViewBox.output, /positive viewBox/);
});

test("intrinsic proportions and an offset viewBox use the actual image geometry", () => {
  const letterboxed = check("letterboxed.svg", svg('<text x="50" y="65" font-size="22">Unreadable</text>', 'width="700" height="180" viewBox="0 0 700 700"'));
  assert.equal(letterboxed.code, 1, letterboxed.output);
  assert.match(letterboxed.output, /3\.2px/);
  const offset = check("offset.svg", svg('<text x="150" y="165" font-size="22">Readable</text>', 'width="700" height="180" viewBox="100 100 700 180"'));
  assert.equal(offset.code, 0, offset.output);
  for (const dimension of ['width="0" height="0"', 'width="100%" height="180"']) {
    const zero = check("zero.svg", svg('', `${dimension} viewBox="0 0 700 180"`));
    assert.equal(zero.code, 1, zero.output);
    assert.match(zero.output, /positive fixed lengths/);
  }
});

test("a draft selector cannot leave the assets directory or silently skip a missing file", () => {
  for (const name of ["../outside.svg", "missing.svg"]) {
    const result = spawnSync(process.execPath, [checker, "--dir", fixture, "--asset", name], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /without a path|selected asset is not there/);
  }
});
