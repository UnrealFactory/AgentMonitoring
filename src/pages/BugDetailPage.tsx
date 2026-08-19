/**
 * One bug, told as the story it is: somebody found it, somebody picked it up, they talked,
 * and it got fixed — with the fix written down.
 *
 * The page is built around three moments a reader is actually looking for. The **report**
 * (what breaks, how to reproduce it) is rendered as the document it was written as. The
 * **claim** — the instant a bug stopped being everyone's problem and became someone's — is
 * an event in the thread, not a date buried in a sidebar. The **resolution** is the
 * merged-PR moment of this page: its own banner, its own colour, naming who fixed it, when,
 * and how long it had been open — and, because a fix is not one block of text, it is broken
 * into the parts its author labelled (cause, change, proof, cost), each one an anchor and a
 * row in the contents rail, with the verification drawn as evidence rather than prose.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrentProject, useProjectSlug, useVaultNonce } from "../AppContext";
import { api, failureTitle } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useActiveSection } from "../lib/useActiveSection";
import { Markdown, RecordTitles } from "../lib/markdown";
import type { SplitResult } from "../lib/sections";
import {
  ContentsRail,
  PartsBody,
  PartsJump,
  partsToc,
  useLabelledParts,
  type TocEntry,
} from "../components/RecordBody";
import { RelatedSection, useRelated } from "../components/Related";
import { useContextMenu } from "../components/ContextMenu";
import { useProjectMenu, useRecordMenu } from "../lib/menus";
import {
  AgentChip,
  BugStatusPill,
  CorrectionMark,
  CorrectionNotice,
  ErrorState,
  RecordTitle,
  SeverityBadge,
  Skeleton,
  StaleRecordBar,
  Tag,
} from "../components/ui";
import { countCorrections, isCorrection } from "../lib/updates";
import {
  formatDateTime,
  formatDateTimeUtc,
  formatDuration,
  formatRelative,
  pluralize,
} from "../lib/format";
import { TIME_TO_RESOLVE, UNASSIGNED, UNASSIGNED_LABEL } from "../lib/words";
import type { BugComment, BugDetail } from "../lib/types";

/** A timestamp shown as a real date, with the relative time next to it. */
function Stamp({ iso, relative = true }: { iso: string; relative?: boolean }) {
  return (
    <>
      <time className="tabular" dateTime={iso} title={formatDateTimeUtc(iso)}>
        {formatDateTime(iso)}
      </time>
      {relative && <span className="stamp-rel"> · {formatRelative(iso)}</span>}
    </>
  );
}

export function BugDetailPage() {
  const slug = useProjectSlug()!;
  const project = useCurrentProject();
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, refreshError, status, loading, reload } = useAsync(
    () => api.getBug(slug, id),
    [slug, id],
    useVaultNonce()
  );

  const bug = data;
  /* The same menu the board row opens, minus Open — the reader is already on it. */
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  const projectMenu = useProjectMenu();
  const related = useRelated(slug, id, bug?.refs ?? EMPTY);

  /**
   * The resolution, split into the parts its author labelled (Root cause / Fix / Verified /
   * …). They are anchors and contents rows, not just headings: the evidence for a fix is
   * the part a reader most often comes for, and in one 2,000-word blob it was the part they
   * most often missed.
   */
  const resolution = useLabelledParts(bug?.resolution);

  const sections = useMemo(() => {
    if (!bug) return [] as TocEntry[];
    const out: TocEntry[] = [
      { id: "report", label: "Report", count: 0 },
      { id: "thread", label: "Thread", count: bug.comments.length },
    ];
    if (bug.resolution) {
      out.push({ id: "resolution", label: "Resolution", count: 0 }, ...partsToc(resolution));
    }
    if (related.count) out.push({ id: "related", label: "Related", count: related.count });
    return out;
  }, [bug, related.count, resolution]);
  const active = useActiveSection(sections.map((s) => s.id));

  if (error) {
    const missing = status === 404;
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, status, id)}
          message={error}
          onRetry={missing ? undefined : reload}
          action={
            <Link className="button" to={`/p/${slug}/bugs`}>
              Back to the bug board
            </Link>
          }
        />
      </div>
    );
  }
  if (loading || !bug) {
    return (
      <div className="page">
        <Skeleton rows={7} />
      </div>
    );
  }

  const openFor = formatDuration(bug.created, bug.resolved);
  const claimDelay = bug.claimed ? formatDuration(bug.created, bug.claimed) : null;

  /**
   * Everybody who has actually written into this record, in the order they first appear:
   * the reporter, then whoever answered. Not the assignee unless they said something —
   * a name on a field is a claim, a name in the thread is a contribution.
   */
  const participants = [bug.reporter, ...bug.comments.map((c) => c.agent)].filter(
    (name, i, all) => name && all.indexOf(name) === i
  );
  /**
   * The newest thing anybody said, which is what a reader arriving late wants first.
   * Taken by timestamp rather than by position: the thread is written in file order and a
   * backdated comment can land anywhere in it.
   */
  const lastComment = bug.comments.reduce<BugComment | null>(
    (newest, c) => (!newest || c.ts > newest.ts ? c : newest),
    null
  );

  return (
    <RecordTitles.Provider value={related.titles}>
      <div className="page page-detail">
        {/* The record moved out from under the reader — deleted, or the vault stopped
            answering. The page keeps what it had and says so. */}
        {refreshError && (
          <StaleRecordBar
            id={bug.id}
            message={refreshError}
            status={status}
            onRetry={reload}
            action={
              status === 404 ? (
                <Link className="button button-sm" to={`/p/${slug}/bugs`}>
                  Bug board
                </Link>
              ) : undefined
            }
          />
        )}
        <nav className="breadcrumb">
          {/* Same as the work log's: the crumb names a project, so it opens the project's
              menu. "Bugs" beside it is a list screen and stays plain. */}
          <Link
            to={`/p/${slug}`}
            {...contextMenu(() => (project ? projectMenu(project) : null))}
          >
            {project?.name ?? slug}
          </Link>
          <span aria-hidden="true">/</span>
          <Link to={`/p/${slug}/bugs`}>Bugs</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{bug.id}</span>
        </nav>

        <header
          className="record-head"
          {...contextMenu(() =>
            recordMenu({ kind: "bug", id: bug.id, title: bug.title, slug, here: true })
          )}
        >
          <RecordTitle title={bug.title} id={bug.id} />

          {/* Same rule as a work log: a reader meets the correction before the report it
              corrects, not thousands of pixels below it. */}
          <CorrectionNotice
            count={countCorrections(bug.comments)}
            href="#thread"
            where="the thread"
          />

          <div className="rec-byline">
            <BugStatusPill status={bug.status} />
            <SeverityBadge severity={bug.severity} />
            <AgentChip name={bug.reporter} size="md" />
            <span className="rec-byline-text">
              filed this bug on <Stamp iso={bug.created} />
              {bug.resolved ? (
                <>
                  {" "}
                  · resolved in <span className="rec-byline-strong">{openFor}</span>
                </>
              ) : (
                <>
                  {" "}
                  · open for <span className="rec-byline-strong">{formatDuration(bug.created, null)}</span>
                </>
              )}
            </span>
          </div>

          {/* The three dates live here and nowhere else on this page: one fact, one place. */}
          <StatusStrip bug={bug} />

          {bug.labels.length > 0 && (
            <div className="rec-chips">
              {bug.labels.map((l) => (
                <Tag key={l}>{l}</Tag>
              ))}
            </div>
          )}
        </header>

        <div className="detail-layout">
          <article className="detail-main">
            <section className="record-section" id="report">
              <h2 className="section-title">
                Report
                <span className="section-byline">
                  by {bug.reporter}, {formatRelative(bug.created)}
                </span>
              </h2>
              {bug.report.trim() ? (
                <Markdown source={bug.report} />
              ) : (
                <p className="muted">
                  This bug has no <code>## Report</code> section.
                </p>
              )}
            </section>

            <ThreadSection bug={bug} claimDelay={claimDelay} />

            {bug.resolution && (
              <ResolutionCard bug={bug} openFor={openFor} resolution={resolution} />
            )}

            {bug.status === "closed" && !bug.resolution && (
              <section className="record-section">
                <div className="notice">
                  <span className="notice-mark" aria-hidden="true" />
                  <div>
                    <p className="notice-title">Closed without a resolution</p>
                    <p className="notice-text">
                      This bug was closed but no fix was written into it, so the record does not say
                      what happened. That is a gap in the record, not in the reader.
                    </p>
                  </div>
                </div>
              </section>
            )}

            <RelatedSection slug={slug} id={bug.id} kind="bug" related={related} />

            {bug.extraSections.map((s) => (
              <section className="record-section" key={s.title}>
                <h2 className="section-title">{s.title}</h2>
                <Markdown source={s.body} />
              </section>
            ))}
          </article>

          <aside className="detail-side">
            <ContentsRail entries={sections} active={active} />

            <div className="side-card">
              <div className="side-card-title">Bug</div>
              <dl className="side-facts">
                <div>
                  <dt>Severity</dt>
                  <dd>
                    <SeverityBadge severity={bug.severity} />
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <BugStatusPill status={bug.status} />
                  </dd>
                </div>
                <div>
                  <dt>Reporter</dt>
                  <dd>
                    <AgentChip name={bug.reporter} />
                  </dd>
                </div>
                <div>
                  <dt>Assignee</dt>
                  <dd>
                    {bug.assignee ? (
                      <AgentChip name={bug.assignee} />
                    ) : (
                      <span className="muted">{UNASSIGNED}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Participants</dt>
                  <dd>
                    <span className="side-people" title={participants.join(", ")}>
                      {participants.map((name) => (
                        <AgentChip key={name} name={name} hideName />
                      ))}
                      <span className="side-people-count tabular">{participants.length}</span>
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Last word</dt>
                  <dd>
                    {lastComment ? (
                      <span className="side-lastword">
                        <span className="side-lastword-who" title={lastComment.agent}>
                          {lastComment.agent}
                        </span>
                        <span className="side-rel" title={formatDateTimeUtc(lastComment.ts)}>
                          {formatRelative(lastComment.ts)}
                        </span>
                      </span>
                    ) : (
                      <span className="muted">no replies yet</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Filed</dt>
                  <dd className="tabular" title={formatDateTimeUtc(bug.created)}>
                    {formatDateTime(bug.created)}
                    <span className="side-rel">{formatRelative(bug.created)}</span>
                  </dd>
                </div>
                <div>
                  <dt>{bug.resolved ? TIME_TO_RESOLVE : "Age"}</dt>
                  <dd className="tabular">
                    {openFor}
                    {!bug.resolved && <span className="side-rel">and counting</span>}
                  </dd>
                </div>
                <div>
                  <dt>Last activity</dt>
                  <dd className="tabular" title={formatDateTimeUtc(bug.lastActivity)}>
                    {formatRelative(bug.lastActivity)}
                  </dd>
                </div>
              </dl>
            </div>

          </aside>
        </div>
      </div>
    </RecordTitles.Provider>
  );
}

/** A stable empty array, so the related-index memo is not invalidated every render. */
const EMPTY: string[] = [];

/**
 * Filed → claimed → resolved, with the real gaps between them. Steps that have not
 * happened are drawn as outlines, so the strip reads as a status even when it is unfinished.
 */
function StatusStrip({ bug }: { bug: BugDetail }) {
  const steps = [
    {
      key: "filed",
      label: "Filed",
      done: true,
      who: bug.reporter,
      ts: bug.created,
      gap: null as string | null,
    },
    {
      key: "claimed",
      label: bug.claimed ? "Claimed" : UNASSIGNED_LABEL,
      done: !!bug.claimed,
      who: bug.claimed ? (bug.assignee ?? "an agent") : null,
      ts: bug.claimed,
      gap: bug.claimed
        ? formatDuration(bug.created, bug.claimed)
        : `${formatDuration(bug.created, null)} waiting`,
    },
    {
      key: "resolved",
      label: bug.resolved ? "Resolved" : bug.status === "closed" ? "Closed" : "Unresolved",
      done: !!bug.resolved || bug.status === "closed",
      who: bug.resolved ? (bug.resolvedBy ?? "an agent") : null,
      ts: bug.resolved,
      // Nothing has elapsed on this leg until somebody starts it: an unclaimed bug shows
      // its waiting time once, on the leg it is actually waiting on.
      gap: bug.resolved
        ? formatDuration(bug.claimed ?? bug.created, bug.resolved)
        : bug.claimed
          ? `${formatDuration(bug.claimed, null)} so far`
          : null,
    },
  ];

  return (
    <ol className="status-strip" aria-label="Status history">
      {steps.map((s, i) => (
        <li key={s.key} className={`strip-step${s.done ? " is-done" : " is-pending"}`}>
          {i > 0 && (
            <span className="strip-link" aria-hidden="true">
              <span className="strip-line" />
              {s.gap && <span className="strip-gap tabular">{s.gap}</span>}
              <span className="strip-line" />
            </span>
          )}
          <span className="strip-node">
            <span className={`strip-dot strip-dot-${s.key}`} aria-hidden="true" />
            <span className="strip-text">
              <span className="strip-label">{s.label}</span>
              <span className="strip-meta">
                {s.ts ? (
                  <>
                    {s.who && (
                      <span className="strip-who" title={s.who}>
                        {s.who}
                      </span>
                    )}
                    <time className="tabular" dateTime={s.ts} title={formatDateTimeUtc(s.ts)}>
                      {formatDateTime(s.ts)}
                    </time>
                  </>
                ) : (
                  <span className="muted">not yet</span>
                )}
              </span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

type ThreadEntry =
  | { kind: "claim"; ts: string }
  | { kind: "comment"; ts: string; agent: string; body: string }
  /** Where the bug ends up: resolved, closed, or still waiting. */
  | { kind: "end"; ts: string };

/**
 * The conversation. Comments, the claim and the moment the bug was closed are one
 * chronological thread, because that is how it happened: someone answered, someone picked
 * it up, someone came back with numbers. A comment written *after* the fix — a correction,
 * a follow-up — therefore appears after the fix, where its author put it, rather than being
 * shuffled in front of it by a rail that always ends on the same node.
 */
function ThreadSection({ bug, claimDelay }: { bug: BugDetail; claimDelay: string | null }) {
  // An unfinished bug has no closing timestamp, so its end marker sorts last.
  const endTs = bug.resolved ?? "￿";
  const rank = (e: ThreadEntry) => (e.kind === "end" ? 1 : 0);
  const entries: ThreadEntry[] = [
    ...(bug.claimed ? [{ kind: "claim" as const, ts: bug.claimed }] : []),
    ...bug.comments.map((c) => ({
      kind: "comment" as const,
      ts: c.ts,
      agent: c.agent || "unknown",
      body: c.body,
    })),
    { kind: "end" as const, ts: endTs },
    // On a tie the end marker goes last: a comment stamped at the same minute as the fix
    // was written before it, or we cannot tell, and "before" is the safer claim.
  ].sort((a, b) => a.ts.localeCompare(b.ts) || rank(a) - rank(b));

  const endLabel = bug.resolved
    ? `${bug.resolvedBy ?? "An agent"} resolved this bug`
    : bug.status === "closed"
      ? "Closed"
      : bug.assignee
        ? `${bug.assignee} is working on it`
        : "Waiting for someone to claim it";
  const endTone = bug.resolved ? "resolved" : bug.status === "closed" ? "abandoned" : "open";

  return (
    <section className="record-section" id="thread">
      <h2 className="section-title">
        Thread
        {bug.comments.length > 0 && (
          <span className="section-count tabular">{pluralize(bug.comments.length, "comment")}</span>
        )}
      </h2>

      <ol className="timeline-rail">
        <li className="trail-node trail-edge">
          <span className="trail-dot trail-dot-start" aria-hidden="true" />
          <div className="trail-edge-text">
            <span className="trail-edge-label">{bug.reporter} filed this bug</span>
            <span className="trail-edge-time tabular" title={formatDateTimeUtc(bug.created)}>
              {formatDateTime(bug.created)} · {formatRelative(bug.created)}
            </span>
          </div>
        </li>

        {bug.comments.length === 0 && !bug.claimed && (
          <li className="trail-node trail-empty">
            <span className="trail-dot trail-dot-muted" aria-hidden="true" />
            <p className="trail-empty-text">
              Nobody has answered yet. Agents reply with{" "}
              <code>agentmon bug comment {bug.id} --message …</code>
            </p>
          </li>
        )}

        {entries.map((e, i) =>
          e.kind === "end" ? (
            <li className="trail-node trail-edge" key="end">
              <span className={`trail-dot trail-dot-${endTone}`} aria-hidden="true" />
              <div className="trail-edge-text">
                <span className="trail-edge-label">{endLabel}</span>
                <span className="trail-edge-time tabular">
                  {/* When the resolution banner follows immediately, it owns the when and
                      the how long: the thread just hands over to it. If somebody commented
                      *after* the fix, this node is no longer the last thing in the thread
                      and has to carry its own date, or the sequence cannot be read. */}
                  {bug.resolved && bug.resolution && i === entries.length - 1 ? (
                    <span>the fix is recorded below</span>
                  ) : bug.resolved ? (
                    <span title={formatDateTimeUtc(bug.resolved)}>
                      {formatDateTime(bug.resolved)} · {formatRelative(bug.resolved)} ·{" "}
                      {formatDuration(bug.created, bug.resolved)} after it was filed
                    </span>
                  ) : (
                    <span>open for {formatDuration(bug.created, null)}</span>
                  )}
                </span>
              </div>
            </li>
          ) : e.kind === "claim" ? (
            <li className="trail-node" key={`claim-${e.ts}`}>
              <span className="trail-dot trail-dot-claim" aria-hidden="true" />
              <div className="claim-line">
                <AgentChip name={bug.assignee ?? "an agent"} />
                <span className="claim-verb">claimed this bug</span>
                <span className="claim-when tabular" title={formatDateTimeUtc(e.ts)}>
                  {formatDateTime(e.ts)}
                  {claimDelay && <span className="claim-delay"> · {claimDelay} after it was filed</span>}
                </span>
              </div>
            </li>
          ) : (
            <li className="trail-node" key={`${e.ts}-${i}`}>
              <span
                className={`trail-dot${isCorrection(e.body) ? " trail-dot-correction" : ""}`}
                aria-hidden="true"
              />
              <article className={`update-card${isCorrection(e.body) ? " is-correction" : ""}`}>
                <header className="update-head">
                  <AgentChip name={e.agent} />
                  {isCorrection(e.body) ? (
                    <span className="update-flag">
                      <CorrectionMark />
                      Correction
                    </span>
                  ) : (
                    <span className="update-verb">
                      {e.agent === bug.reporter
                        ? "added to the report"
                        : e.agent === bug.assignee
                          ? "replied as assignee"
                          : "commented"}
                    </span>
                  )}
                  <time className="update-ts tabular" dateTime={e.ts} title={formatDateTimeUtc(e.ts)}>
                    {formatDateTime(e.ts)} · {formatRelative(e.ts)}
                  </time>
                </header>
                <div className="update-body">
                  <Markdown source={e.body} />
                </div>
              </article>
            </li>
          )
        )}
      </ol>
    </section>
  );
}

/**
 * The merged-PR moment of this page: who fixed it, when, and the fix itself — carrying the
 * author's own sub-sections as anchors, so the proof has a landmark instead of being one
 * bold phrase inside two thousand words.
 */
function ResolutionCard({
  bug,
  openFor,
  resolution,
}: {
  bug: BugDetail;
  openFor: string;
  resolution: SplitResult;
}) {
  return (
    <section className="record-section" id="resolution">
      <div className="outcome-card is-resolution">
        <header className="outcome-head">
          <span className="outcome-mark" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="11" height="11">
              <path
                d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h2 className="outcome-title">Resolution</h2>
          <span className="outcome-by">
            <AgentChip name={bug.resolvedBy ?? bug.assignee ?? "an agent"} />
          </span>
          <span className="outcome-when">
            {bug.resolved ? (
              <>
                resolved <Stamp iso={bug.resolved} /> · {openFor} after it was filed
              </>
            ) : (
              "recorded"
            )}
          </span>
        </header>

        <PartsJump result={resolution} label="Inside this resolution" />

        <div className="outcome-body">
          <PartsBody result={resolution} />
        </div>
      </div>
    </section>
  );
}
