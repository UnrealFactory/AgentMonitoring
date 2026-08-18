import { Link, useParams } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Markdown } from "../lib/markdown";
import {
  AgentChip,
  BugStatusPill,
  ErrorState,
  MetaRow,
  SeverityBadge,
  Skeleton,
  Tag,
} from "../components/ui";
import { formatDateTime, formatDuration, formatRelative } from "../lib/format";

export function BugDetailPage() {
  const slug = useProjectSlug()!;
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => api.getBug(slug, id), [slug, id]);

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="page">
        <Skeleton rows={7} />
      </div>
    );
  }

  const bug = data;
  const history = [
    { ts: bug.created, text: `${bug.reporter} filed this bug` },
    bug.claimed && bug.assignee ? { ts: bug.claimed, text: `${bug.assignee} claimed it` } : null,
    bug.resolved
      ? { ts: bug.resolved, text: `${bug.resolvedBy ?? "an agent"} resolved it` }
      : null,
  ].filter(Boolean) as { ts: string; text: string }[];

  return (
    <div className="page page-detail">
      <nav className="breadcrumb">
        <Link to={`/p/${slug}/bugs`}>Bugs</Link>
        <span aria-hidden="true">/</span>
        <span className="mono">{bug.id}</span>
      </nav>

      <header className="record-head">
        <h1 className="record-title">{bug.title}</h1>
        <div className="record-subline">
          <SeverityBadge severity={bug.severity} />
          <BugStatusPill status={bug.status} />
          <span className="record-byline">
            <AgentChip name={bug.reporter} /> filed {formatRelative(bug.created)}
            {bug.resolved && ` · open for ${formatDuration(bug.created, bug.resolved)}`}
          </span>
        </div>
      </header>

      <div className="detail-layout">
        <article className="detail-main">
          <section className="record-section">
            <h2 className="section-title">Report</h2>
            <Markdown source={bug.report} />
          </section>

          {bug.comments.length > 0 && (
            <section className="record-section">
              <h2 className="section-title">
                Comments <span className="section-count tabular">{bug.comments.length}</span>
              </h2>
              <ol className="comment-list">
                {bug.comments.map((c, i) => (
                  <li className="comment" key={`${c.ts}-${i}`}>
                    <div className="comment-head">
                      <AgentChip name={c.agent || "unknown"} />
                      <time className="comment-ts tabular" dateTime={c.ts}>
                        {formatDateTime(c.ts)}
                      </time>
                    </div>
                    <Markdown source={c.body} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {bug.resolution && (
            <section className="record-section resolution">
              <h2 className="section-title">Resolution</h2>
              <Markdown source={bug.resolution} />
            </section>
          )}

          {bug.extraSections.map((s) => (
            <section className="record-section" key={s.title}>
              <h2 className="section-title">{s.title}</h2>
              <Markdown source={s.body} />
            </section>
          ))}
        </article>

        <aside className="detail-side">
          <dl className="meta-card">
            <MetaRow label="Severity">
              <SeverityBadge severity={bug.severity} />
            </MetaRow>
            <MetaRow label="Status">
              <BugStatusPill status={bug.status} />
            </MetaRow>
            <MetaRow label="Reporter">
              <AgentChip name={bug.reporter} />
            </MetaRow>
            <MetaRow label="Assignee">
              {bug.assignee ? <AgentChip name={bug.assignee} /> : <span className="muted">unassigned</span>}
            </MetaRow>
            <MetaRow label="Labels">
              {bug.labels.length ? (
                <div className="tag-row">
                  {bug.labels.map((l) => (
                    <Tag key={l}>{l}</Tag>
                  ))}
                </div>
              ) : (
                <span className="muted">none</span>
              )}
            </MetaRow>
            <MetaRow label="Related">
              {bug.refs.length ? (
                <div className="ref-row">
                  {bug.refs.map((r) => (
                    <Link
                      key={r}
                      className="ref-link mono"
                      to={r.startsWith("BUG") ? `/p/${slug}/bugs/${r}` : `/p/${slug}/work/${r}`}
                    >
                      {r}
                    </Link>
                  ))}
                </div>
              ) : (
                <span className="muted">none</span>
              )}
            </MetaRow>
          </dl>

          <div className="meta-card">
            <div className="meta-card-title">History</div>
            <ol className="history">
              {history.map((h) => (
                <li key={h.ts}>
                  <span className="history-dot" aria-hidden="true" />
                  <span className="history-text">{h.text}</span>
                  <time className="history-ts tabular" dateTime={h.ts} title={formatDateTime(h.ts)}>
                    {formatRelative(h.ts)}
                  </time>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
