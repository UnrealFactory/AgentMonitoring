import { Link } from "react-router-dom";
import { useApp } from "../AppContext";
import { EmptyState, ErrorState, Skeleton, Tag } from "../components/ui";
import { formatDate, formatRelative, pluralize } from "../lib/format";

export function ProjectsPage() {
  const { vault, projects, loading, error, reload, transport } = useApp();

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            Everything in one vault directory of plain files — copy it to another machine and the
            history comes with it.
          </p>
        </div>
        <div className="page-head-meta tabular">
          {loading ? "loading…" : pluralize(projects.length, "project")}
        </div>
      </header>

      <div className="vault-card">
        <div className="vault-card-row">
          <span className="vault-card-label">Vault</span>
          <span className="vault-card-value">{vault?.name ?? "—"}</span>
        </div>
        <div className="vault-card-row">
          <span className="vault-card-label">Path</span>
          <span className="vault-card-value mono">{vault?.path ?? "—"}</span>
        </div>
        <div className="vault-card-row">
          <span className="vault-card-label">Schema</span>
          <span className="vault-card-value tabular">v{vault?.version ?? "—"}</span>
        </div>
        <div className="vault-card-row">
          <span className="vault-card-label">Created</span>
          <span className="vault-card-value tabular">{formatDate(vault?.createdAt)}</span>
        </div>
        <div className="vault-card-row">
          <span className="vault-card-label">Transport</span>
          <span className="vault-card-value">
            {transport === "tauri" ? "desktop (Tauri commands)" : "browser (dev vault-api)"}
          </span>
        </div>
      </div>

      {loading ? (
        <Skeleton rows={3} />
      ) : projects.length === 0 ? (
        <EmptyState
          title="This vault has no projects yet"
          hint="Create one with `agentmon project create <slug> --name <name>`."
        />
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <Link className="project-card" key={p.slug} to={`/p/${p.slug}`}>
              <div className="project-card-head">
                <span className="project-name">{p.name}</span>
                <span className={`project-status project-status-${p.status}`}>{p.status}</span>
              </div>
              <span className="project-slug mono">{p.slug}</span>
              <p className="project-desc">{p.description}</p>
              {p.tags.length > 0 && (
                <div className="tag-row">
                  {p.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
              <dl className="project-counts">
                <div>
                  <dt>Work</dt>
                  <dd className="tabular">
                    {p.counts.workDone}/{p.counts.workTotal}
                  </dd>
                </div>
                <div>
                  <dt>Open bugs</dt>
                  <dd className="tabular">{p.counts.bugsOpen}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd className="tabular">{p.counts.events}</dd>
                </div>
                <div>
                  <dt>Last activity</dt>
                  <dd className="tabular">{formatRelative(p.counts.lastActivity)}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
