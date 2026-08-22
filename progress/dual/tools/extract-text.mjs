// Extracts the reader-visible text of an eli5 HTML explainer so A/B judges compare
// content on equal footing (visual concept is judged separately, in piece D3).
// Usage: node extract-text.mjs <in.html> <out.txt>
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
let html = readFileSync(inPath, "utf8");

// Drop non-visible containers wholesale.
html = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ");
// Keep the text an image carries.
html = html.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, " [image: $1] ");
// Emoji/symbol spans and everything else: strip tags, keep text; block-ish tags become breaks.
html = html.replace(/<\/(p|div|h[1-6]|li|section|article|tr|blockquote|figcaption)>/gi, "\n");
html = html.replace(/<(br|hr)[^>]*>/gi, "\n");
html = html.replace(/<[^>]+>/g, " ");
// Entities that matter for reading.
html = html
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&rarr;/g, "→")
  .replace(/&mdash;/g, "—");
// Collapse whitespace but keep line structure.
const text = html
  .split("\n")
  .map((l) => l.replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .join("\n");

writeFileSync(outPath, text + "\n");
console.log(`${outPath}: ${text.length} chars`);
