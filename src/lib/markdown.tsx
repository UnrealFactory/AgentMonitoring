/**
 * A small markdown renderer for record bodies.
 *
 * It builds React elements directly — no `dangerouslySetInnerHTML` anywhere — so vault
 * content (written by agents, i.e. by generated text) can never inject markup. It covers
 * what the SPEC body sections actually use: headings, paragraphs, lists, fenced code,
 * blockquotes, rules, tables, and inline code/bold/italic/links.
 */
import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

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

    const bullet = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[1]) === ordered) {
          items.push(m[2]);
          i += 1;
          // continuation lines belong to the previous item
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i])) {
            items[items.length - 1] += ` ${lines[i].trim()}`;
            i += 1;
          }
        } else break;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
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
      !/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) blocks.push({ kind: "paragraph", text: para.join("\n") });
    else i += 1;
  }

  return blocks;
}

/** Inline spans: `code`, **bold**, *italic*, [text](href). */
function inline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}i${n++}`;
    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) {
        const href = link[2];
        const safe = /^(https?:|mailto:)/i.test(href);
        out.push(
          safe ? (
            <a key={key} href={href} target="_blank" rel="noreferrer noopener">
              {link[1]}
            </a>
          ) : (
            <span key={key}>{link[1]}</span>
          )
        );
      } else {
        out.push(token);
      }
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source ?? "");
  return (
    <div className={className ? `prose ${className}` : "prose"}>
      {blocks.map((block, idx) => {
        const key = `b${idx}`;
        switch (block.kind) {
          case "heading": {
            const Tag = (`h${Math.min(block.level + 2, 6)}` as unknown) as "h3";
            return <Tag key={key}>{inline(block.text, key)}</Tag>;
          }
          case "code":
            return (
              <pre key={key} data-lang={block.lang || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          case "list":
            return block.ordered ? (
              <ol key={key}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={key}>{inline(block.text, key)}</blockquote>;
          case "rule":
            return <hr key={key} />;
          case "table":
            return (
              <table key={key} className="prose-table">
                <thead>
                  <tr>
                    {block.header.map((h, j) => (
                      <th key={`${key}-h${j}`}>{inline(h, `${key}-h${j}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={`${key}-r${r}`}>
                      {row.map((cell, c) => (
                        <td key={`${key}-r${r}c${c}`}>{inline(cell, `${key}-r${r}c${c}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "paragraph":
          default:
            return <p key={key}>{inline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
