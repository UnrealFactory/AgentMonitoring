/**
 * The cross-reference block, shared by the work log page and the bug page.
 *
 * A `refs:` list in a record's frontmatter is a relationship, and a relationship has two
 * ends. Showing only the end the author happened to type is how a reader misses that the
 * follow-ups from a piece of work became three separate bugs. So this block shows both:
 *
 *   References     — what this one points at
 *   Referenced by  — every work log and bug in the project that points back here
 *
 * Each row carries the id, the *title*, and the other record's own status (dot + pill),
 * because "BUG-0008" alone tells a reader nothing they can act on.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useVaultNonce } from "../AppContext";
import { useAsync } from "../lib/useAsync";
import { recordPath } from "../lib/markdown";
import { useContextMenu } from "./ContextMenu";
import { useRecordMenu } from "../lib/menus";
import { BugStatusPill, RecordStatusDot, SeverityBadge, WorkStatusPill } from "./ui";
import { BUG_NOUN, WORK_NOUN } from "../lib/words";
import { formatDateTimeUtc, formatRelative } from "../lib/format";
import type { BugSummary, WorklogSummary } from "../lib/types";

type RecordKind = "work" | "bug";

interface RelatedItem {
  id: string;
  title: string;
  kind: RecordKind;
  work?: WorklogSummary;
  bug?: BugSummary;
  lastActivity: string;
}

const toItem = (r: WorklogSummary | BugSummary): RelatedItem =>
  "agent" in r
    ? { id: r.id, title: r.title, kind: "work", work: r, lastActivity: r.lastActivity }
    : { id: r.id, title: r.title, kind: "bug", bug: r, lastActivity: r.lastActivity };

export type RelatedIndex = ReturnType<typeof useRelated>;

/**
 * Both directions of the index for one record. The page calls this once and hands the
 * result to the section below, so a record page never asks the vault for the same two
 * lists twice.
 */
export function useRelated(slug: string, id: string, refs: string[]) {
  const nonce = useVaultNonce();
  const works = useAsync(() => api.listWorklogs(slug), [slug], nonce);
  const bugs = useAsync(() => api.listBugs(slug), [slug], nonce);

  return useMemo(() => {
    const loading = works.loading || bugs.loading;
    const all: RelatedItem[] = [...(works.data ?? []), ...(bugs.data ?? [])].map(toItem);
    const byId = new Map(all.map((r) => [r.id, r]));

    const outgoing = refs.map((ref) => byId.get(ref) ?? { ref });
    const incoming = all
      .filter((r) => r.id !== id)
      .filter((r) => (r.work?.refs ?? r.bug?.refs ?? []).includes(id))
      .filter((r) => !refs.includes(r.id))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

    /* The same index, keyed for the prose: an id written into a sentence gets the title of
       the record it names (lib/markdown.tsx). Withheld until both lists are in, so a chip
       is never drawn as "no such record" while the vault is still being read. */
    const titles = loading ? null : new Map(all.map((r) => [r.id, r.title]));

    return { loading, outgoing, incoming, titles, count: outgoing.length + incoming.length };
  }, [works.data, works.loading, bugs.data, bugs.loading, refs, id]);
}

function RelatedRow({ slug, item }: { slug: string; item: RelatedItem }) {
  /* A row here is a work log or a bug, so it is the same row the list screens draw and gets
     the same right-button menu. `here` is deliberately not set: this is the *other* record,
     the one the reader is not on, so Open is the item that matters most on it. */
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  return (
    <li>
      <Link
        className="rel-row"
        to={recordPath(slug, item.id)}
        {...contextMenu(() =>
          recordMenu({ kind: item.kind, id: item.id, title: item.title, slug })
        )}
      >
        <RecordStatusDot
          status={item.work ? item.work.status : item.bug!.status}
          kind={item.kind}
        />
        <span className="rel-id mono">{item.id}</span>
        <span className="rel-title" title={item.title}>
          {item.title}
        </span>
        <span className="rel-side">
          {item.bug && <SeverityBadge severity={item.bug.severity} />}
          {item.work ? (
            <WorkStatusPill status={item.work.status} />
          ) : (
            <BugStatusPill status={item.bug!.status} />
          )}
          <time
            className="rel-time tabular"
            dateTime={item.lastActivity}
            title={`Last activity ${formatDateTimeUtc(item.lastActivity)}`}
          >
            {formatRelative(item.lastActivity)}
          </time>
        </span>
      </Link>
    </li>
  );
}

/** An id in `refs:` that no record in this project answers to. */
function MissingRow({ id }: { id: string }) {
  return (
    <li>
      <span className="rel-row is-missing">
        <span className="sdot sdot-missing" aria-hidden="true" />
        <span className="rel-id mono">{id}</span>
        <span className="rel-title muted">no work log or bug with this id in this project</span>
      </span>
    </li>
  );
}

export function RelatedSection({
  slug,
  id,
  kind,
  related,
}: {
  slug: string;
  id: string;
  kind: RecordKind;
  related: RelatedIndex;
}) {
  const { outgoing, incoming, count } = related;
  /* The object's own noun, from lib/words.ts: a work log is a work log on every screen. */
  const noun = kind === "bug" ? BUG_NOUN : WORK_NOUN;

  if (count === 0) return null;

  return (
    <section className="record-section" id="related">
      <h2 className="section-title">
        Related
        <span className="section-count tabular">{count}</span>
      </h2>

      <div className="rel-card">
        {outgoing.length > 0 && (
          <div className="rel-group">
            <div className="rel-group-head">
              <span className="rel-arrow" aria-hidden="true">
                →
              </span>
              <span className="rel-group-label">References</span>
              <span className="rel-group-hint">written into this {noun}’s refs</span>
            </div>
            <ul className="rel-rows">
              {outgoing.map((item) =>
                "ref" in item ? (
                  <MissingRow key={item.ref} id={item.ref} />
                ) : (
                  <RelatedRow key={item.id} slug={slug} item={item} />
                )
              )}
            </ul>
          </div>
        )}

        {incoming.length > 0 && (
          <div className="rel-group">
            <div className="rel-group-head">
              <span className="rel-arrow" aria-hidden="true">
                ←
              </span>
              <span className="rel-group-label">Referenced by</span>
              <span className="rel-group-hint">
                work logs and bugs that point back at {id}
              </span>
            </div>
            <ul className="rel-rows">
              {incoming.map((item) => (
                <RelatedRow key={item.id} slug={slug} item={item} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
