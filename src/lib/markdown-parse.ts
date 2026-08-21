/**
 * The parser behind `Markdown` (markdown.tsx): text in, plain data out.
 *
 * It is deliberately free of React and of the DOM, because the thing it must be is
 * *correct about the vault's bytes* — a record is evidence, and a renderer that silently
 * rewrites a number in it is worse than one that renders nothing. Being pure data means
 * scripts/markdown-smoke.mjs can run it under plain node and assert on real vault strings.
 *
 * Fidelity rules that earn their place here (each one came from real content):
 *
 *   * An ordered marker interrupts an open paragraph only when the number is 1, which is
 *     what CommonMark says. A wrapped sentence ending "…returns 503 for three hours, then
 *     / 200. Without jitter, …" is a sentence, not a list, and the 200 stays in it.
 *   * A list that genuinely starts at N reports `start: N`, so the renderer emits
 *     <ol start={N}> and a source number is never replaced by a counted one.
 *   * Inline markup nests: `code` inside **bold** is code, *emphasis* inside a link label
 *     is emphasis, and a record id inside any of them is still a cross-reference.
 */

/** An inline run. `ref` is a record id (WORK-0004 / BUG-0002) or a `[[note-name]]`
 * written in prose. */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  /** `wiki` marks a `[[name]]` spelling, so flattening can restore the author's brackets. */
  | { kind: "ref"; id: string; wiki?: boolean }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }
  /** `![alt](src)`. The renderer decides what a src is allowed to be (markdown.tsx). */
  | { kind: "image"; alt: string; src: string }
  | { kind: "link"; href: string; children: Inline[] };

/** One row of a list. `task` is the checkbox state, or null for an ordinary item. */
export interface ListItem {
  text: string;
  task: "open" | "done" | null;
}

/** The five callout tones GitHub's `> [!NOTE]` syntax names; anything else stays a quote. */
export type CalloutTone = "note" | "tip" | "important" | "warning" | "caution";

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; text: string }
  | { kind: "callout"; tone: CalloutTone; text: string }
  /** A paragraph that is exactly one image: drawn as a figure with the alt as caption. */
  | { kind: "figure"; alt: string; src: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] };

/** `- item`, `* item`, `1. item`, `2) item` — group 2 is the number when ordered. */
const LIST_MARKER = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;

/**
 * May this line break a paragraph that is already open? CommonMark: a bullet may, an
 * ordered item may only when it starts at 1, and an empty item never may.
 */
function interruptsParagraph(line: string): boolean {
  const m = line.match(LIST_MARKER);
  if (!m || !m[4].trim()) return false;
  return m[3] === undefined || Number(m[3]) === 1;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);

const cells = (l: string) =>
  l
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function parseBlocks(src: string): Block[] {
  const lines = (src ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(/^\s*(`{3,}|~{3,})\s*(\S*)/);
    if (fence) {
      const marker = fence[1][0];
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }

    // Indented code block. Agents use these for terminal transcripts and incident
    // timelines; joining those lines into a paragraph destroys the only thing they say.
    if (/^(?: {4}|\t)\S/.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        if (/^(?: {4}|\t)/.test(lines[i])) {
          body.push(lines[i].replace(/^(?: {4}|\t)/, ""));
          i += 1;
          continue;
        }
        if (!lines[i].trim()) {
          // A blank line only stays inside the block if indented content follows it.
          let j = i;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (j >= lines.length || !/^(?: {4}|\t)/.test(lines[j])) break;
          body.push(...lines.slice(i, j).map(() => ""));
          i = j;
          continue;
        }
        break;
      }
      blocks.push({ kind: "code", lang: "", text: body.join("\n").replace(/\s+$/, "") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const marker = line.match(LIST_MARKER);
    if (marker) {
      const ordered = marker[3] !== undefined;
      // The author's own numbering, kept: a list that opens at 3 renders as 3.
      const start = ordered ? Number(marker[3]) : 1;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_MARKER);
        if (m && (m[3] !== undefined) === ordered) {
          // `- [ ] item` / `- [x] item`: the checkbox is state, not words.
          const task = m[4].match(/^\[( |x|X)\]\s+(.*)$/);
          items.push(
            task
              ? { text: task[2], task: task[1] === " " ? "open" : "done" }
              : { text: m[4], task: null }
          );
          i += 1;
          // Wrapped continuation lines belong to the item they hang under.
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST_MARKER.test(lines[i])) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i += 1;
          }
        } else break;
      }
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      /* GitHub's callout dialect: a quote whose first line is exactly `[!NOTE]` (or tip /
         important / warning / caution) is an aside with a tone, and the marker line is
         consumed — it is state, like a task's checkbox. A marker with trailing words is
         not the syntax, and stays a quote, words and all. */
      const callout = body[0]?.match(/^\[!(note|tip|important|warning|caution)\]\s*$/i);
      if (callout) {
        blocks.push({
          kind: "callout",
          tone: callout[1].toLowerCase() as CalloutTone,
          text: body.slice(1).join("\n").trim(),
        });
        continue;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*(`{3,}|~{3,})/.test(lines[i]) &&
      !interruptsParagraph(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(?: {4}|\t)\S/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) {
      const text = para.join("\n");
      // A paragraph that is exactly one image is a figure — the way agents actually place
      // a diagram — and its alt is the caption. An image inside a sentence stays inline.
      const figure = text.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (figure) blocks.push({ kind: "figure", alt: figure[1], src: figure[2] });
      else blocks.push({ kind: "paragraph", text });
    } else i += 1;
  }

  return blocks;
}

/** `WORK-0004` / `BUG-0002` written in prose. */
const REF_RE = /\b(?:WORK|BUG)-\d{1,8}\b/g;

/** Split a plain run into text and record-id references. */
function withRefs(text: string, out: Inline[]): void {
  if (!text) return;
  let last = 0;
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "ref", id: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
}

/**
 * `[[note-name]]` — an explicit cross-reference to a note, the shape agents write by
 * Obsidian habit (a live UnrealNetCore vault indexes its notes exactly this way). Bare
 * kebab words in prose deliberately never link (they false-positive constantly); the
 * double brackets are the author saying "this one is a name". The inner shape mirrors
 * agentmon-core's `validate_note_name` — 2–64 letters/digits/hyphens, no edge hyphens —
 * so `[[0, 1], [2, 3]]` in a sentence about arrays stays the author's literal text.
 * `[[WORK-0004]]` also resolves: the renderer routes ids by prefix wherever they came from.
 */
const WIKILINK_RE = /^\[\[([A-Za-z0-9][A-Za-z0-9-]{0,62}[A-Za-z0-9])\]\]$/;

const INLINE_RE =
  /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(~~[^~\n]+~~)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[\[[A-Za-z0-9][A-Za-z0-9-]{0,62}[A-Za-z0-9]\]\])|(\[[^\]]+\]\([^)\s]+\))/g;

/**
 * Inline spans: `code`, `![alt](src)`, ~~struck~~, **bold**, *italic*, [text](href),
 * [[note-name]], and bare record ids. Emphasis containers are parsed recursively, so markup inside them is
 * markup and not literal backticks on the screen. `depth` only exists to make runaway
 * nesting impossible.
 */
export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  if (!text) return out;
  if (depth > 6) {
    withRefs(text, out);
    return out;
  }

  const re = new RegExp(INLINE_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    if (m.index > last) withRefs(text.slice(last, m.index), out);
    const token = m[0];
    if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("![")) {
      const image = token.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (image) out.push({ kind: "image", alt: image[1], src: image[2] });
      else withRefs(token, out);
    } else if (token.startsWith("~~")) {
      out.push({ kind: "del", children: parseInline(token.slice(2, -2), depth + 1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push({ kind: "strong", children: parseInline(token.slice(2, -2), depth + 1) });
    } else if (token.startsWith("*")) {
      out.push({ kind: "em", children: parseInline(token.slice(1, -1), depth + 1) });
    } else {
      // WIKILINK_RE, not a prefix test: `[[label](url)` is a link whose label opens with a
      // bracket, and it reaches here starting with the same two characters.
      const wiki = token.match(WIKILINK_RE);
      const link = wiki ? null : token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (wiki) out.push({ kind: "ref", id: wiki[1], wiki: true });
      else if (link)
        out.push({ kind: "link", href: link[2], children: parseInline(link[1], depth + 1) });
      else withRefs(token, out);
    }
    last = m.index + token.length;
  }
  if (last < text.length) withRefs(text.slice(last), out);
  return out;
}

/** The plain text of an inline tree — for titles, previews and tests. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "code":
          return n.text;
        case "ref":
          // The source spelling: a flattened `[[name]]` keeps its brackets, exactly as the
          // image below keeps its syntax (scripts/markdown-smoke.mjs sweeps on this too —
          // a Korean particle welds to the closing brackets: `[[unrealnetcore-queue]]의`).
          return n.wiki ? `[[${n.id}]]` : n.id;
        case "image":
          // The source syntax, not just the alt: a flattened record must still say which
          // file it showed (scripts/markdown-smoke.mjs sweeps on exactly this).
          return `![${n.alt}](${n.src})`;
        default:
          return inlineText(n.children);
      }
    })
    .join("");
}
