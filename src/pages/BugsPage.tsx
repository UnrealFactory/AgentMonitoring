import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import {
  AgentChip,
  BugStatusPill,
  EmptyState,
  ErrorState,
  SeverityBadge,
  Skeleton,
  Tag,
} from "../components/ui";
import { formatRelative, pluralize } from "../lib/format";
import type { Severity } from "../lib/types";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export function BugsPage() {
  const slug = useProjectSlug()!;
  const { data, error, loading, reload } = useAsync(() => api.listBugs(slug), [slug]);
  const [tab, setTab] = useState<"open" | "resolved" | "all">("open");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [label, setLabel] = useState("all");
  const [query, setQuery] = useState("");

  const bugs = data ?? [];
  const openCount = bugs.filter((b) => b.status === "open" || b.status === "in_progress").length;
  const closedCount = bugs.length - openCount;

  const labels = useMemo(
    () => [...new Set(bugs.flatMap((b) => b.labels))].sort((a, b) => a.localeCompare(b)),
    [bugs]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bugs.filter((b) => {
      const isOpen = b.status === "open" || b.status === "in_progress";
      if (tab === "open" && !isOpen) return false;
      if (tab === "resolved" && isOpen) return false;
      if (severity !== "all" && b.severity !== severity) return false;
      if (label !== "all" && !b.labels.includes(label)) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        b.excerpt.toLowerCase().includes(q) ||
        b.labels.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [bugs, tab, severity, label, query]);

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
          <h1 className="page-title">Bugs</h1>
          <p className="page-sub">
            Every defect an agent found, who owns it now, and the written record of how it was fixed.
          </p>
        </div>
        <div className="page-head-meta tabular">
          {loading ? "loading…" : pluralize(filtered.length, "bug")}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter by state">
          <button
            role="tab"
            aria-selected={tab === "open"}
            className={`segment${tab === "open" ? " is-active" : ""}`}
            onClick={() => setTab("open")}
          >
            Open<span className="segment-count tabular">{openCount}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "resolved"}
            className={`segment${tab === "resolved" ? " is-active" : ""}`}
            onClick={() => setTab("resolved")}
          >
            Resolved<span className="segment-count tabular">{closedCount}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "all"}
            className={`segment${tab === "all" ? " is-active" : ""}`}
            onClick={() => setTab("all")}
          >
            All<span className="segment-count tabular">{bugs.length}</span>
          </button>
        </div>

        <div className="toolbar-right">
          <select
            className="select"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity | "all")}
            aria-label="Filter by severity"
          >
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Filter by label"
          >
            <option value="all">All labels</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="search"
            value={query}
            placeholder="Search bugs…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search bugs"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={bugs.length ? "Nothing matches those filters" : "No bugs filed"}
          hint={
            bugs.length
              ? "Try the All tab."
              : "Agents file with `agentmon bug create -p " + slug + " --severity high --title <t>`."
          }
        />
      ) : (
        <ul className="issue-list">
          {filtered.map((b) => (
            <li key={b.id}>
              <Link className="issue" to={`/p/${slug}/bugs/${b.id}`}>
                <span className={`issue-severity sev-${b.severity}`} aria-hidden="true" />
                <div className="issue-main">
                  <div className="issue-titleline">
                    <span className="issue-title">{b.title}</span>
                    {b.labels.map((l) => (
                      <Tag key={l}>{l}</Tag>
                    ))}
                  </div>
                  <div className="issue-sub">
                    <span className="mono">{b.id}</span>
                    <span>
                      filed by {b.reporter} · {formatRelative(b.created)}
                    </span>
                    {b.assignee && <span>assigned to {b.assignee}</span>}
                    {b.commentCount > 0 && (
                      <span className="tabular">{pluralize(b.commentCount, "comment")}</span>
                    )}
                  </div>
                </div>
                <div className="issue-side">
                  <SeverityBadge severity={b.severity} />
                  <BugStatusPill status={b.status} />
                  {b.assignee ? <AgentChip name={b.assignee} /> : <span className="muted">unassigned</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
