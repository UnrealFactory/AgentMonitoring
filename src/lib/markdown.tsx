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
import { createContext, useContext, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useContextMenu } from "../components/ContextMenu";
import { recordKind, useRecordMenu } from "./menus";
import { parseBlocks, parseInline, type Inline } from "./markdown-parse";

/** Resolves a record id to a route, or null when we are not inside a project. */
type RefLinker = ((id: string) => string) | null;

/** The two handlers a chip spreads onto itself to answer the right button. */
type ChipMenu = (id: string, title: string | undefined) => ReturnType<ReturnType<typeof useContextMenu>>;

/**
 * What the ids in this project's prose are called — `BUG-0004` → its title.
 *
 * An id written into a sentence is a claim about another record, and until this existed the
 * chip printed the id alone: a reader who followed "the same class BUG-0004 was on the bug
 * board" landed on an unrelated bug, and the mis-citation was invisible on the page where
 * it was written (P6 round 2 comprehension critic). With the title on the chip, a wrong id
 * announces itself where it stands. The map is what the record pages have already loaded
 * for the Related block; `null` means nothing has been loaded yet, which is not the same as
 * "this id does not exist" and must not be drawn as if it were.
 */
export const RecordTitles = createContext<Map<string, string> | null>(null);

interface Opts {
  link: RefLinker;
  titles: Map<string, string> | null;
  /** Set figures in tabular numerals and full-strength ink. See `withFigures`. */
  figures?: boolean;
  /** The right button, for the chips. Null outside a project, where they are not links. */
  chipMenu?: ChipMenu | null;
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
      case "ref": {
        if (!link) return node.id;
        const title = opts.titles?.get(node.id);
        const unknown = !!opts.titles && !title;
        /* A chip is a link to a record, so it takes the record's menu — the same one the
           Related row naming that record 200px below it opens. Not on an `is-unknown` chip:
           the app has read the project's records and none of them answers to that id, so
           there is nothing to open and nothing to copy a title from. */
        const menu = unknown ? undefined : opts.chipMenu?.(node.id, title);
        return (
          <Link
            key={key}
            className={`ref-inline mono${unknown ? " is-unknown" : ""}`}
            to={link(node.id)}
            {...menu}
            title={
              title
                ? `${node.id} — ${title}`
                : unknown
                  ? `${node.id} — no work log or bug with this id in this project`
                  : undefined
            }
          >
            {node.id}
          </Link>
        );
      }
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
 * The right button for the chips, or null outside a project.
 *
 * An id in a sentence is a link to a record, and every other link to a record in this app
 * opens Open / Copy id / Copy title / Copy link — a reader who right-clicks "BUG-0021" in a
 * paragraph to copy its id, having just done exactly that on the row for it, should not find
 * the gesture dead on one of the two. `renderInline` is a plain function called in a loop, so
 * the factory is built once here and handed down through the render options.
 */
function useChipMenu(): ChipMenu | null {
  const slug = useParams<{ project: string }>().project;
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  if (!slug) return null;
  return (id, title) => contextMenu(() => recordMenu({ kind: recordKind(id), id, title, slug }));
}

/**
 * One run of markdown with no block wrapper — for headings and labels built out of record
 * text, where a `<p>` would be wrong.
 */
export function InlineMarkdown({ source }: { source: string }) {
  const link = useRefLinker();
  const titles = useContext(RecordTitles);
  const chipMenu = useChipMenu();
  return <>{renderInline(parseInline(source ?? ""), "il", { link, titles, chipMenu })}</>;
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
  const titles = useContext(RecordTitles);
  const chipMenu = useChipMenu();
  const opts: Opts = { link, titles, figures, chipMenu };
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
