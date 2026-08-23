import fs from 'fs';
const files = process.argv.slice(2);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const i = t.indexOf('\n## For humans');
  if (i < 0) { console.log(f, 'NO HUMAN AREA'); continue; }
  let body = t.slice(i + '\n## For humans'.length);
  const m = body.search(/\n## /);
  if (m >= 0) body = body.slice(0, m);
  body = body.trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  const base = f.split(/[\\/]/).pop();
  console.log(base, words);
}
