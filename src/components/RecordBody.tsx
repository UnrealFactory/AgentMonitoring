/**
 * The closing section of a record — a bug's **Resolution**, a work log's **Outcome** —
 * rendered as the parts its author labelled, plus the contents rail that navigates them.
 *
 * Both pages show the same moment ("this is done, here is what happened and how we know"),
 * so they show it with the same component: one place decides what a labelled part looks
 * like, what counts as evidence, and how the rail behaves. src/lib/sections.ts does the
 * splitting and documents why nothing is extracted from the prose.
 */
import { useMemo } from "react";
import { pluralize } from "../lib/format";
import { InlineMarkdown, Markdown } from "../lib/markdown";
import { splitLabelledSections, type LabelledSection, type SplitResult } from "../lib/sections";

/** One row of a contents rail. `sub` rows are the parts of the section above them. */
export interface TocEntry {
  id: string;
  label: string;
  count: number;
  sub?: boolean;
  evidence?: boolean;
  /** The author's full label, when the rail is showing a shortened one. */
  title?: string;
}

export function useLabelledParts(source: string | null | undefined): SplitResult {
  return useMemo(() => splitLabelledSections(source ?? ""), [source]);
}

/** Contents rows for the parts of a section, to nest under that section's own row. */
export function partsToc(result: SplitResult): TocEntry[] {
  return result.sections.map((part) => ({
    id: part.id,
    label: part.short,
    title: part.label,
    count: part.items,
    sub: true,
    evidence: part.evidence,
  }));
}

export function CheckMark() {
  return (
    <svg className="check-mark" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** What this record's closing section contains, as links, right where it starts. */
export function PartsJump({ result, label }: { result: SplitResult; label: string }) {
  if (!result.sections.length) return null;
  return (
    <nav className="res-jump" aria-label={label}>
      {result.sections.map((part) => (
        <a
          key={part.id}
          className={`res-jump-link${part.evidence ? " is-evidence" : ""}`}
          href={`#${part.id}`}
          title={part.label}
        >
          {part.evidence && <CheckMark />}
          {/* The label is its own element so that *it* is what ellipsises when a part's
              heading is long. Left as bare text it took the whole chip and pushed the count
              out of a box with `overflow: hidden`, which cut the number off entirely — the
              same defect as vault BUG-0006, one level down. */}
          <span className="res-jump-text">{part.short}</span>
          {part.items > 0 && <span className="res-jump-count tabular">{part.items}</span>}
        </a>
      ))}
    </nav>
  );
}

export function PartsBody({ result }: { result: SplitResult }) {
  return (
    <>
      {result.preamble && <Markdown source={result.preamble} />}
      {result.sections.map((part) => (
        <Part key={part.id} part={part} />
      ))}
    </>
  );
}

/**
 * One labelled part. The label the author bolded becomes the heading — the same words,
 * given the weight they were meant to carry — and a clause that belongs to the label rather
 * than to the prose ("Fix, in `dispatcher.rs` and `queue.rs`:") rides on the heading line
 * where the author put it.
 *
 * The verification part is drawn as evidence rather than prose: each item is a check, the
 * count is stated, and the figures inside it are set in full-strength tabular numerals so
 * the eye lands on them. No number is extracted, paired or recomputed.
 */
function Part({ part }: { part: LabelledSection }) {
  return (
    <section className={`res-part${part.evidence ? " is-evidence" : ""}`} id={part.id}>
      <h3 className="res-part-title">
        {part.evidence && (
          <span className="res-part-mark" aria-hidden="true">
            <CheckMark />
          </span>
        )}
        <span className="res-part-label">{part.label}</span>
        {part.trailer && (
          <span className="res-part-trailer">
            <InlineMarkdown source={part.trailer} />
          </span>
        )}
        {part.evidence && part.items > 0 && (
          <span className="res-part-count tabular">{pluralize(part.items, "check")}</span>
        )}
      </h3>
      <Markdown
        className={part.evidence ? "evidence-prose" : undefined}
        source={part.body}
        figures={part.evidence}
      />
    </section>
  );
}

/** "On this page" — the record's sections, and the parts of its closing one. */
export function ContentsRail({ entries, active }: { entries: TocEntry[]; active: string }) {
  return (
    <nav className="side-card contents" aria-label="On this page">
      <div className="side-card-title">On this page</div>
      <ul className="contents-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              className={
                "contents-link" +
                (entry.sub ? " is-sub" : "") +
                (entry.evidence ? " is-evidence" : "") +
                (active === entry.id ? " is-active" : "")
              }
              href={`#${entry.id}`}
              title={entry.title !== entry.label ? entry.title : undefined}
            >
              <span className="contents-label">{entry.label}</span>
              {entry.count > 0 && <span className="contents-count tabular">{entry.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
