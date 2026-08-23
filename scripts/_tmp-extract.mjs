import fs from 'fs';
// reads a record markdown on stdin or from argv[2], prints the human area
const src = process.argv[2] === '-' || !process.argv[2]
  ? fs.readFileSync(0, 'utf8')
  : fs.readFileSync(process.argv[2], 'utf8');
const lines = src.split(/\r?\n/);
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^##\s+For humans\s*$/.test(lines[i])) { start = i + 1; break; }
}
if (start < 0) { console.error('NO HUMAN AREA'); process.exit(2); }
let end = lines.length;
for (let i = start; i < lines.length; i++) {
  if (/^##\s+/.test(lines[i])) { end = i; break; }
}
const body = lines.slice(start, end).join('\n').trim();
process.stdout.write(body + '\n');
process.stderr.write('WORDS: ' + body.split(/\s+/).filter(Boolean).length + '\n');
