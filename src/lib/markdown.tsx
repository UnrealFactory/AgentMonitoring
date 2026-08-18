/**
 * Renders record bodies. Parsing lives next door in markdown-parse.ts; this file only
 * turns the parsed blocks into React elements — built directly, never through
 * `dangerouslySetInnerHTML`, so vault content (written by agents, i.e. by generated text)
 * can never inject markup.
 *
 * It also turns record ids mentioned in prose (`WORK-0004`, `BUG-0002`) into links to
 * those records — an agent writing "see BUG-0004" is making a cross-reference, and a
 * reader should be able to follow it. Ids inside code spans stay literal.
 */
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { parseBlocks, parseInline, type Inline } from "./markdown-parse";

/** Resolves a record id to a route, or null when we are not inside a project. */
type RefLinker = ((id: string) => string) | null;

interface Opts {
  link: RefLinker;
  /** Set figures in tabular numerals and full-strength ink. See `withFigures`. */
  figures?: boolean;
}

export function recordPath(slug: string, id: string): string {
  return id.toUpperCase().startsWith("BUG") ? `/p/${slug}/bugs/${id}` : `/p/${slug}/work/${id}`;
}

/** A number, with the unit an agent writes against it: `3`, `11ms`, `2,900`, `30s`. */
const FIGURE = /\d[\d,]*(?:\.\d+)?(?:ms|s|m|h|%|x|k|MB|GB)?/g;

/**
 * Marks the figures in a run of text so the eye lands on them — used on verification
 * evidence, where the numbers ARE the claim ("idle in transaction peaked at 3, against 94
 * before"). Strictly typographic: every character stays exactly where the author put it,
 * and nothing is paired, computed or summarised. Anything welded to a word or a hyphen
 * (`p99`, `2026-08-20`, `v1.2`) is left alone — it is an identifier, not a measurement.
 */
function withFigures(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FIGURE.lastIndex = 0;
  while ((m = FIGURE.exec(text))) {
    const before = text[m.index - 1] ?? " ";
    const after = text[m.index + m[0].length] ?? " ";
    if (/[\w-]/.test(before) || /[\w-]/.test(after)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <b className="figure tabular" key={`${keyPrefix}f${m.index}`}>
        {m[0]}
      </b>
    );
    last = m.index + m[0].length;
  }
  if (!out.length) return [text];
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderInline(nodes: Inline[], keyPrefix: string, opts: Opts): ReactNode[] {
  const { link } = opts;
  return nodes.map((node, i) => {
    const key = `${keyPrefix}i${i}`;
    switch (node.kind) {
      case "text":
        return opts.figures ? withFigures(node.text, key) : node.text;
      case "code":
        return <code key={key}>{node.text}</code>;
      case "ref":
        return link ? (
          <Link key={key} className="ref-inline mono" to={link(node.id)}>
            {node.id}
          </Link>
        ) : (
          node.id
        );
      case "strong":
        return <strong key={key}>{renderInline(node.children, key, opts)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key, opts)}</em>;
      case "link": {
        // Only web links are followed; anything else keeps its text and loses its href.
        const safe = /^(https?:|mailto:)/i.test(node.href);
        return safe ? (
          <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
            {renderInline(node.children, key, opts)}
          </a>
        ) : (
          <span key={key}>{renderInline(node.children, key, opts)}</span>
        );
      }
      default:
        return null;
    }
  });
}

/** The linker for the project in the current route, or null outside a project. */
function useRefLinker(): RefLinker {
  const slug = useParams<{ project: string }>().project;
  return slug ? (id) => recordPath(slug, id) : null;
}

/**
 * One run of markdown with no block wrapper — for headings and labels built out of record
 * text, where a `<p>` would be wrong.
 */
export function InlineMarkdown({ source }: { source: string }) {
  const link = useRefLinker();
  return <>{renderInline(parseInline(source ?? ""), "il", { link })}</>;
}

export function Markdown({
  source,
  className,
  figures = false,
}: {
  source: string;
  className?: string;
  /** Mark the numbers: for verification evidence, where the figures are the point. */
  figures?: boolean;
}) {
  // Record ids link inside the project the reader is already looking at; on screens with
  // no project in the route (there is one: the projects list) they stay plain text.
  const link = useRefLinker();
  const opts: Opts = { link, figures };
  const blocks = parseBlocks(source ?? "");
  return (
    <div className={className ? `prose ${className}` : "prose"}>
      {blocks.map((block, idx) => {
        const key = `b${idx}`;
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level + 2, 6)}` as unknown as "h3";
            return <Tag key={key}>{renderInline(parseInline(block.text), key, opts)}</Tag>;
          }
          case "code":
            return (
              <pre key={key} data-lang={block.lang || undefined}>
                {block.lang && <span className="code-lang">{block.lang}</span>}
                <code>{block.text}</code>
              </pre>
            );
          case "list": {
            const items = block.items.map((item, j) => (
              <li key={`${key}-${j}`}>{renderInline(parseInline(item), `${key}-${j}`, opts)}</li>
            ));
            // start={N} rather than a counted list: the author's numbers are data.
            return block.ordered ? (
              <ol key={key} start={block.start === 1 ? undefined : block.start}>
                {items}
              </ol>
            ) : (
              <ul key={key}>{items}</ul>
            );
          }
          case "quote":
            return (
              <blockquote key={key}>{renderInline(parseInline(block.text), key, opts)}</blockquote>
            );
          case "rule":
            return <hr key={key} />;
          case "table":
            return (
              <table key={key} className="prose-table">
                <thead>
                  <tr>
                    {block.header.map((h, j) => (
                      <th key={`${key}-h${j}`}>
                        {renderInline(parseInline(h), `${key}-h${j}`, opts)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={`${key}-r${r}`}>
                      {row.map((cell, c) => (
                        <td key={`${key}-r${r}c${c}`}>
                          {renderInline(parseInline(cell), `${key}-r${r}c${c}`, opts)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "paragraph":
          default:
            return <p key={key}>{renderInline(parseInline(block.text), key, opts)}</p>;
        }
      })}
    </div>
  );
}
