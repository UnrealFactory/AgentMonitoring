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
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useContextMenu } from "../components/ContextMenu";
import { api } from "./api";
import { highlightCode } from "./highlight";
import { t } from "./i18n";
import { recordKind, useRecordMenu } from "./menus";
import { useModalLock } from "./modal";
import { parseBlocks, parseInline, type CalloutTone, type Inline } from "./markdown-parse";

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
  /** Whose folder `![alt](assets/x.svg)` reads from. Null outside a project. */
  projectId?: string | null;
}

export function recordPath(projectId: string, id: string): string {
  const upper = id.toUpperCase();
  if (upper.startsWith("BUG")) return `/p/${projectId}/bugs/${id}`;
  if (upper.startsWith("WORK")) return `/p/${projectId}/work/${id}`;
  // Anything else is a note's kebab name — the third shape a ref can take. Prose chips
  // never carry one (the ref regex matches WORK/BUG ids only, deliberately: kebab words in
  // sentences would false-positive constantly); this branch serves the Related rows.
  return `/p/${projectId}/notes/${id}`;
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
            /* The known chip's tooltip is the author's title and is printed as written;
               the unknown chip's is the app's own sentence about a stale link, and the
               app's sentences are in the reader's language. The live vault reaches this:
               WORK-0011 cites BUG-9999, so the English literal that used to sit here was
               two clicks from the Korean dashboard. */
            title={
              title
                ? `${node.id} — ${title}`
                : unknown
                  ? t("rec.missingRefTip", node.id)
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
      case "del":
        return <del key={key}>{renderInline(node.children, key, opts)}</del>;
      case "image":
        return (
          <RecordImage
            key={key}
            projectId={opts.projectId ?? null}
            src={node.src}
            alt={node.alt}
            inline
          />
        );
      case "link": {
        // Only web links are followed. An href this app will not follow is still something
        // the author wrote, so the source spelling stays on screen — the same stance
        // {@link RecordImage} takes for a src it will not fetch. Swallowing it deleted
        // `](url)` out of a live sentence (WORK-0061, which is *about* this grammar), and
        // a renderer may reformat what a record says, never delete part of it.
        const safe = /^(https?:|mailto:)/i.test(node.href);
        if (safe)
          return (
            <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
              {renderInline(node.children, key, opts)}
            </a>
          );
        return (
          <span key={key}>
            {"["}
            {renderInline(node.children, key, opts)}
            {`](${node.href})`}
          </span>
        );
      }
      default:
        return null;
    }
  });
}

/** The linker for the project in the current route, or null outside a project. */
function useRefLinker(): RefLinker {
  const projectId = useParams<{ project: string }>().project;
  return projectId ? (id) => recordPath(projectId, id) : null;
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
  const projectId = useParams<{ project: string }>().project;
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  if (!projectId) return null;
  return (id, title) => contextMenu(() => recordMenu({ kind: recordKind(id), id, title, projectId }));
}

/**
 * One run of markdown with no block wrapper — for headings and labels built out of record
 * text, where a `<p>` would be wrong.
 */
export function InlineMarkdown({ source }: { source: string }) {
  const link = useRefLinker();
  const titles = useContext(RecordTitles);
  const chipMenu = useChipMenu();
  const projectId = useParams<{ project: string }>().project ?? null;
  return (
    <>{renderInline(parseInline(source ?? ""), "il", { link, titles, chipMenu, projectId })}</>
  );
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
  const projectId = useParams<{ project: string }>().project ?? null;
  const opts: Opts = { link, titles, figures, chipMenu, projectId };
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
                <code>
                  {/* Four token colours, hand-rolled (lib/highlight.ts). The spans
                      concatenate to exactly the source — colour may be wrong about a
                      token, never about the bytes. */}
                  {highlightCode(block.text, block.lang).map((s, j) =>
                    s.tone ? (
                      <span key={j} className={`tok-${s.tone}`}>
                        {s.text}
                      </span>
                    ) : (
                      s.text
                    )
                  )}
                </code>
              </pre>
            );
          case "list": {
            const items = block.items.map((item, j) => (
              <li key={`${key}-${j}`} className={item.task ? `task-item is-${item.task}` : undefined}>
                {/* `- [x]` draws its state as a box. Decorative to a screen reader — the
                    words of the item carry the meaning, exactly as they do in the file. */}
                {item.task && (
                  <span className="task-box" aria-hidden="true">
                    {item.task === "done" && (
                      <svg viewBox="0 0 10 10" focusable="false">
                        <path
                          d="M2 5.4 L4.1 7.4 L8 3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                )}
                {/* One span, not bare inline nodes: the task row lays out as flex (box
                    beside words), and unwrapped siblings would each become a flex item. */}
                {item.task ? (
                  <span className="task-text">
                    {renderInline(parseInline(item.text), `${key}-${j}`, opts)}
                  </span>
                ) : (
                  renderInline(parseInline(item.text), `${key}-${j}`, opts)
                )}
              </li>
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
          case "callout":
            return (
              <aside key={key} className={`prose-callout is-${block.tone}`}>
                <span className="callout-title">
                  <CalloutIcon tone={block.tone} />
                  {CALLOUT_LABEL[block.tone]()}
                </span>
                {block.text && (
                  <p className="callout-body">
                    {renderInline(parseInline(block.text), key, opts)}
                  </p>
                )}
              </aside>
            );
          case "figure":
            return (
              <RecordImage
                key={key}
                projectId={projectId}
                src={block.src}
                alt={block.alt}
              />
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

/* ==========================================================================
   Images a body references — and the two things an image src may not be
   ======================================================================= */

/** Callout labels, flat keys so the dictionary types them like every other string. */
const CALLOUT_LABEL: Record<CalloutTone, () => string> = {
  note: () => t("md.calloutNote"),
  tip: () => t("md.calloutTip"),
  important: () => t("md.calloutImportant"),
  warning: () => t("md.calloutWarning"),
  caution: () => t("md.calloutCaution"),
};

function CalloutIcon({ tone }: { tone: CalloutTone }) {
  const path = {
    note: "M8 7.2 v4 M8 4.6 v0.6", // i
    tip: "M8 3.2 a3.1 3.1 0 0 1 1.6 5.8 l-0.3 1.6 h-2.6 l-0.3 -1.6 A3.1 3.1 0 0 1 8 3.2 Z M6.9 12.4 h2.2", // bulb
    important: "M8 4 v5 M8 11.2 v0.6", // ! (in a circle below)
    warning: "M8 2.6 L14.2 13 H1.8 Z M8 6.4 v3 M8 10.8 v0.4", // triangle
    caution: "M5.4 2.4 h5.2 L14 5.8 v4.4 L10.6 13.6 H5.4 L2 10.2 V5.8 Z M8 5.4 v3.4 M8 10.6 v0.4", // octagon
  }[tone];
  const circled = tone === "note" || tone === "important";
  return (
    <svg className="callout-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {circled && <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.4" />}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * `![alt](src)`, resolved and drawn — or refused out loud.
 *
 * Three cases, by what the src is:
 *  * a **relative path** — a file inside this project's AgentMonitoring folder, fetched
 *    through {@link api.recordAssetSrc} (agentmon-core's path lock) and shown in an
 *    `<img>`, where even an SVG executes nothing. This is the supported, documented case.
 *  * an **http(s) URL** — never fetched. This app loads nothing from the network at
 *    runtime (SPEC), and an image tag is also a tracking pixel; the reference degrades to
 *    a link, so nothing the author wrote is lost.
 *  * anything else (`data:`, a drive letter, …) — the source text, kept as code.
 *
 * A file that cannot be read is a visible refusal, not a blank: a missing diagram is a
 * mis-citation the reader deserves to see, exactly like a stale record chip. The backend's
 * own sentence rides in the tooltip; browser mode's `<img>` error has no sentence, so the
 * box speaks for it.
 */
function RecordImage({
  projectId,
  src,
  alt,
  inline = false,
}: {
  projectId: string | null;
  src: string;
  alt: string;
  inline?: boolean;
}) {
  const external = /^https?:/i.test(src);
  const relative = !external && !src.includes(":");
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!projectId || !relative) return;
    let dead = false;
    let revoke = () => {};
    void api
      .recordAssetSrc(projectId, src)
      .then((asset) => {
        if (dead) {
          asset.revoke();
          return;
        }
        revoke = asset.revoke;
        setState({ url: asset.url });
      })
      .catch((err: unknown) => {
        if (!dead) setState({ error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      dead = true;
      revoke();
      setState({});
    };
  }, [projectId, src, relative]);

  if (external) {
    const link = (
      <a href={src} target="_blank" rel="noreferrer noopener">
        {alt || src}
      </a>
    );
    return inline ? link : <p>{link}</p>;
  }
  if (!relative || !projectId) {
    // No folder to read from (the projects screen), or a src shape the backends would
    // refuse anyway: keep the author's bytes on screen instead of a dead tag.
    const literal = <code>{`![${alt}](${src})`}</code>;
    return inline ? literal : <p>{literal}</p>;
  }

  if (state.error) {
    const broken = (
      <span className="prose-img-broken" title={state.error}>
        {t("md.imageFailed")} <code>{src}</code>
      </span>
    );
    return inline ? broken : <p>{broken}</p>;
  }
  // Still loading: nothing for a beat. A spinner that flashes on every local read would
  // be more motion than information.
  if (!state.url) return null;

  /* A figure that is an SVG fills its column: a drawing is vector, so width costs it
     nothing, and a root that carries only a `viewBox` has no intrinsic size at all — left
     to the <img> default it arrives at 300×150, which is how a cited scene once rendered
     at the height of a letter. Raster images keep their own size; blown up they only blur. */
  const fill = !inline && /\.svg$/i.test(src);
  const img = (
    <img
      className={inline ? "prose-img-inline" : fill ? "prose-img prose-img-fill" : "prose-img"}
      src={state.url}
      alt={alt}
      loading="lazy"
      onError={() => setState({ error: t("md.imageFailed") })}
    />
  );
  /* Every image that draws is also a button to its full-size view: an attached photo is
     capped at 560px in the column (or 1.4em in a sentence), and reading it used to mean
     opening the file outside the app (owner feedback, 2026-08-27). The wrapper is a real
     <button> so the keyboard reaches it like everything else. */
  const zoom = (
    <button
      type="button"
      className={inline ? "img-zoom is-inline" : fill ? "img-zoom is-fill" : "img-zoom"}
      onClick={() => setZoomed(true)}
      title={t("md.imageZoom")}
    >
      {img}
    </button>
  );
  const box = zoomed && (
    <ImageLightbox url={state.url} alt={alt} svg={/\.svg$/i.test(src)} onClose={() => setZoomed(false)} />
  );
  if (inline)
    return (
      <>
        {zoom}
        {box}
      </>
    );
  return (
    <figure className="prose-figure">
      {zoom}
      {alt && <figcaption>{alt}</figcaption>}
      {box}
    </figure>
  );
}

/**
 * The full-size view of one record image. A dialog like any other in this app: it takes
 * the modal lock so window-level key handlers stand down (src/lib/modal.ts), Escape and
 * any click close it, and focus comes back to the image button that opened it.
 */
function ImageLightbox({
  url,
  alt,
  svg,
  onClose,
}: {
  url: string;
  alt: string;
  svg: boolean;
  onClose: () => void;
}) {
  useModalLock(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className="lightbox-scrim"
      role="dialog"
      aria-label={alt || t("md.imageZoom")}
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {/* An SVG has no useful intrinsic size to inherit, so it takes the whole width the
          viewport offers; a raster image keeps its own pixels — blown past them it only
          blurs — and the caps in the CSS letterbox both. */}
      <img className={svg ? "lightbox-img is-svg" : "lightbox-img"} src={url} alt={alt} />
      {alt && <span className="lightbox-caption">{alt}</span>}
    </div>
  );
}
