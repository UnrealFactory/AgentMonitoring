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

export function recordPath(slug: string, id: string): string {
  return id.toUpperCase().startsWith("BUG") ? `/p/${slug}/bugs/${id}` : `/p/${slug}/work/${id}`;
}

function renderInline(nodes: Inline[], keyPrefix: string, link: RefLinker): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}i${i}`;
    switch (node.kind) {
      case "text":
        return node.text;
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
        return <strong key={key}>{renderInline(node.children, key, link)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key, link)}</em>;
      case "link": {
        // Only web links are followed; anything else keeps its text and loses its href.
        const safe = /^(https?:|mailto:)/i.test(node.href);
        return safe ? (
          <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
            {renderInline(node.children, key, link)}
          </a>
        ) : (
          <span key={key}>{renderInline(node.children, key, link)}</span>
        );
      }
      default:
        return null;
    }
  });
}

/** Inline markdown with no block wrapper — for one-line strings (titles, summaries). */
export function InlineMarkdown({ source }: { source: string }) {
  const slug = useParams<{ project: string }>().project;
  const link: RefLinker = slug ? (id) => recordPath(slug, id) : null;
  return <>{renderInline(parseInline(source ?? ""), "x", link)}</>;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  // Record ids link inside the project the reader is already looking at; on screens with
  // no project in the route (there is one: the projects list) they stay plain text.
  const slug = useParams<{ project: string }>().project;
  const link: RefLinker = slug ? (id) => recordPath(slug, id) : null;
  const blocks = parseBlocks(source ?? "");
  return (
    <div className={className ? `prose ${className}` : "prose"}>
      {blocks.map((block, idx) => {
        const key = `b${idx}`;
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(block.level + 2, 6)}` as unknown as "h3";
            return <Tag key={key}>{renderInline(parseInline(block.text), key, link)}</Tag>;
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
              <li key={`${key}-${j}`}>{renderInline(parseInline(item), `${key}-${j}`, link)}</li>
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
              <blockquote key={key}>{renderInline(parseInline(block.text), key, link)}</blockquote>
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
                        {renderInline(parseInline(h), `${key}-h${j}`, link)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={`${key}-r${r}`}>
                      {row.map((cell, c) => (
                        <td key={`${key}-r${r}c${c}`}>
                          {renderInline(parseInline(cell), `${key}-r${r}c${c}`, link)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "paragraph":
          default:
            return <p key={key}>{renderInline(parseInline(block.text), key, link)}</p>;
        }
      })}
    </div>
  );
}
