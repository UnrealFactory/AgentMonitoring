import { Link, useParams } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Markdown } from "../lib/markdown";
import { AgentChip, ErrorState, MetaRow, Skeleton, Tag, WorkStatusPill } from "../components/ui";
import { formatDateTime, formatDuration, formatRelative } from "../lib/format";

export function WorkDetailPage() {
  const slug = useProjectSlug()!;
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useAsync(() => api.getWorklog(slug, id), [slug, id]);

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

  const work = data;

  return (
    <div className="page page-detail">
      <nav className="breadcrumb">
        <Link to={`/p/${slug}/work`}>Work</Link>
        <span aria-hidden="true">/</span>
        <span className="mono">{work.id}</span>
      </nav>

      <header className="record-head">
        <h1 className="record-title">{work.title}</h1>
        <div className="record-subline">
          <WorkStatusPill status={work.status} />
          <span className="record-byline">
            <AgentChip name={work.agent} /> started {formatRelative(work.started)}
            {work.finished
              ? ` · finished ${formatRelative(work.finished)} (${formatDuration(work.started, work.finished)})`
              : ` · running for ${formatDuration(work.started, null)}`}
          </span>
        </div>
      </header>

      <div className="detail-layout">
        <article className="detail-main">
          <section className="record-section">
            <h2 className="section-title">What</h2>
            <Markdown source={work.what} />
          </section>

          <section className="record-section">
            <h2 className="section-title">Why</h2>
            <Markdown source={work.why} />
          </section>

          <section className="record-section">
            <h2 className="section-title">How</h2>
            <Markdown source={work.how} />
          </section>

          {work.updates.length > 0 && (
            <section className="record-section">
              <h2 className="section-title">
                Updates <span className="section-count tabular">{work.updates.length}</span>
              </h2>
              <ol className="update-list">
                {work.updates.map((u, i) => (
                  <li className="update" key={`${u.ts}-${i}`}>
                    <div className="update-rail" aria-hidden="true">
                      <span className="update-dot" />
                    </div>
                    <div className="update-body">
                      <time className="update-ts tabular" dateTime={u.ts}>
                        {formatDateTime(u.ts)}
                      </time>
                      <Markdown source={u.body} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {work.outcome && (
            <section className="record-section outcome">
              <h2 className="section-title">Outcome</h2>
              <Markdown source={work.outcome} />
            </section>
          )}

          {work.extraSections.map((s) => (
            <section className="record-section" key={s.title}>
              <h2 className="section-title">{s.title}</h2>
              <Markdown source={s.body} />
            </section>
          ))}
        </article>

        <aside className="detail-side">
          <dl className="meta-card">
            <MetaRow label="Status">
              <WorkStatusPill status={work.status} />
            </MetaRow>
            <MetaRow label="Agent">
              <AgentChip name={work.agent} />
            </MetaRow>
            <MetaRow label="Started">
              <time className="tabular" dateTime={work.started}>
                {formatDateTime(work.started)}
              </time>
            </MetaRow>
            <MetaRow label="Finished">
              {work.finished ? (
                <time className="tabular" dateTime={work.finished}>
                  {formatDateTime(work.finished)}
                </time>
              ) : (
                <span className="muted">still open</span>
              )}
            </MetaRow>
            <MetaRow label="Tags">
              {work.tags.length ? (
                <div className="tag-row">
                  {work.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              ) : (
                <span className="muted">none</span>
              )}
            </MetaRow>
            <MetaRow label="Related">
              {work.refs.length ? (
                <div className="ref-row">
                  {work.refs.map((r) => (
                    <Link
                      key={r}
                      className="ref-link mono"
                      to={
                        r.startsWith("BUG")
                          ? `/p/${slug}/bugs/${r}`
                          : `/p/${slug}/work/${r}`
                      }
                    >
                      {r}
                    </Link>
                  ))}
                </div>
              ) : (
                <span className="muted">none</span>
              )}
            </MetaRow>
            <MetaRow label="Files">
              {work.files.length ? (
                <ul className="file-list">
                  {work.files.map((f) => (
                    <li key={f} className="mono">
                      {f}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="muted">none recorded</span>
              )}
            </MetaRow>
          </dl>
        </aside>
      </div>
    </div>
  );
}
