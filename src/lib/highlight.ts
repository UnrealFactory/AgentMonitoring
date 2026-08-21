/**
 * Syntax colour for fenced code blocks — hand-rolled, dependency-free, and deliberately
 * modest about what it claims to know.
 *
 * Four token classes only: comments, strings, numbers, keywords. That is the level of
 * colour that makes a transcript scannable without pretending to be a language server, and
 * it is achievable with one tokenizer that cannot lie about the bytes: the spans it
 * returns always concatenate back to exactly the source (asserted in
 * scripts/markdown-smoke.mjs), and a language it has no table for renders plain rather
 * than half-guessed. No highlight.js/prism/shiki — this repo ships four runtime
 * dependencies and a bundled highlighter earns its place only at this size (~1KB of
 * keyword tables, one regex walk).
 */

export type Tone = "com" | "str" | "num" | "kw";

export interface Span {
  text: string;
  tone: Tone | null;
}

interface Lang {
  /** Line-comment openers, longest first. */
  line: string[];
  /** Block comment pair, or null. */
  block: [string, string] | null;
  /** String-opening quote characters. */
  quotes: string[];
  /** Python's `"""` / `'''`, matched before the single-line quotes. */
  triple?: boolean;
  keywords: Set<string>;
  /** SQL compares keywords case-insensitively. */
  foldCase?: boolean;
}

const kw = (words: string) => new Set(words.split(" "));

const JS: Lang = {
  line: ["//"],
  block: ["/*", "*/"],
  quotes: ['"', "'", "`"],
  keywords: kw(
    "const let var function return if else for while do switch case break continue new " +
      "class extends import export from default try catch finally throw await async yield " +
      "typeof instanceof in of delete void this super static get set null undefined true " +
      "false interface type enum implements readonly public private protected abstract as " +
      "satisfies keyof infer never unknown any string number boolean object symbol bigint"
  ),
};

const LANGS: Record<string, Lang> = {
  js: JS, jsx: JS, ts: JS, tsx: JS, javascript: JS, typescript: JS, mjs: JS, cjs: JS,
  json: { line: ["//"], block: ["/*", "*/"], quotes: ['"'], keywords: kw("true false null") },
  rust: {
    line: ["//"],
    block: ["/*", "*/"],
    // Double quotes only: colouring `'a` lifetimes as open strings would lie constantly.
    quotes: ['"'],
    keywords: kw(
      "fn let mut const pub use mod struct enum impl trait for while loop if else match " +
        "return self Self crate super where async await move ref static type dyn box true " +
        "false in as unsafe extern continue break"
    ),
  },
  python: {
    line: ["#"],
    block: null,
    quotes: ['"', "'"],
    triple: true,
    keywords: kw(
      "def return if elif else for while import from as class try except finally raise " +
        "with lambda pass break continue global nonlocal yield async await True False None " +
        "not and or in is del assert match case"
    ),
  },
  bash: {
    line: ["#"],
    block: null,
    quotes: ['"', "'"],
    keywords: kw(
      "if then else elif fi for while until do done case esac function in local return " +
        "export echo cd set read exit shift trap source true false"
    ),
  },
  sql: {
    line: ["--"],
    block: ["/*", "*/"],
    quotes: ["'"],
    foldCase: true,
    keywords: kw(
      "select from where insert update delete into values set join left right inner outer " +
        "cross on group by order having limit offset as and or not null is in like between " +
        "create table drop alter index primary key foreign references distinct union all " +
        "case when then else end exists begin commit rollback returning with"
    ),
  },
  go: {
    line: ["//"],
    block: ["/*", "*/"],
    quotes: ['"', "`"],
    keywords: kw(
      "func package import return if else for range var const type struct interface map " +
        "chan go defer select switch case break continue fallthrough goto true false nil " +
        "make new len cap append"
    ),
  },
  yaml: { line: ["#"], block: null, quotes: ['"', "'"], keywords: kw("true false null yes no") },
  toml: { line: ["#"], block: null, quotes: ['"', "'"], keywords: kw("true false") },
  css: { line: [], block: ["/*", "*/"], quotes: ['"', "'"], keywords: kw("") },
};

// The names agents actually write on fences, folded onto the tables above.
const ALIASES: Record<string, string> = {
  rs: "rust", py: "python", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  golang: "go", yml: "yaml", jsonc: "json", scss: "css", markdown: "", md: "", text: "", txt: "",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One alternation per token class, in priority order; built once per language. */
const compiled = new Map<string, { re: RegExp; lang: Lang } | null>();

function tokenizerFor(name: string): { re: RegExp; lang: Lang } | null {
  const id = ALIASES[name] ?? name;
  if (!id) return null;
  if (compiled.has(id)) return compiled.get(id) ?? null;
  const lang = LANGS[id];
  if (!lang) {
    compiled.set(id, null);
    return null;
  }
  const parts: string[] = [];
  if (lang.block) parts.push(`${escapeRe(lang.block[0])}[\\s\\S]*?(?:${escapeRe(lang.block[1])}|$)`);
  for (const open of lang.line) parts.push(`${escapeRe(open)}[^\\n]*`);
  if (lang.triple) parts.push(`"""[\\s\\S]*?(?:"""|$)`, `'''[\\s\\S]*?(?:'''|$)`);
  for (const q of lang.quotes) {
    // A string closes on its quote or dies at the newline — an unterminated one must not
    // eat the rest of the block. Backtick strings may span lines (JS templates, Go raws).
    parts.push(q === "`" ? "`[^`]*(?:`|$)" : `${q}(?:\\\\.|[^\\\\${q}\\n])*(?:${q}|$|(?=\\n))`);
  }
  parts.push("\\b0[xXbBoO][0-9a-fA-F_]+\\b", "\\b\\d[\\d_]*(?:\\.\\d+)?\\b");
  parts.push("[A-Za-z_][A-Za-z0-9_]*");
  const out = { re: new RegExp(parts.join("|"), "g"), lang };
  compiled.set(id, out);
  return out;
}

function toneOf(token: string, lang: Lang): Tone | null {
  const c = token[0];
  if (lang.block && token.startsWith(lang.block[0])) return "com";
  if (lang.line.some((open) => token.startsWith(open))) return "com";
  if (lang.quotes.includes(c) || (lang.triple && (token.startsWith('"""') || token.startsWith("'''"))))
    return "str";
  if (/\d/.test(c)) return "num";
  if (/[A-Za-z_]/.test(c)) {
    const word = lang.foldCase ? token.toLowerCase() : token;
    return lang.keywords.has(word) ? "kw" : null;
  }
  return null;
}

/**
 * Tokenize `code` for `langName`. Every character of the input appears in the output
 * exactly once, in order; unknown languages come back as one plain span.
 */
export function highlightCode(code: string, langName: string): Span[] {
  const t = tokenizerFor((langName || "").toLowerCase());
  if (!t || !code) return [{ text: code, tone: null }];
  const spans: Span[] = [];
  const re = new RegExp(t.re.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) spans.push({ text: code.slice(last, m.index), tone: null });
    spans.push({ text: m[0], tone: toneOf(m[0], t.lang) });
    last = m.index + m[0].length;
  }
  if (last < code.length) spans.push({ text: code.slice(last), tone: null });
  return spans;
}
