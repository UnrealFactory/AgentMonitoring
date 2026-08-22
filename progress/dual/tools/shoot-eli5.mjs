// Renders each cached eli5 baseline HTML to a PNG so the D3 builder/critic can see
// the visual concept being reinterpreted. Usage: node shoot-eli5.mjs
import { chromium } from "playwright";
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "baselines");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
for (const dir of readdirSync(root)) {
  const html = join(root, dir, "eli5.html");
  if (!existsSync(html)) continue;
  await page.goto("file:///" + html.replaceAll("\\", "/"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(root, dir, "eli5.png"), fullPage: true });
  console.log(`${dir}/eli5.png`);
}
await browser.close();
