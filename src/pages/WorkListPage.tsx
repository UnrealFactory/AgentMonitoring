import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { AgentChip, EmptyState, ErrorState, Skeleton, Tag, WorkStatusPill } from "../components/ui";
import { formatDate, formatRelative, pluralize } from "../lib/format";
import type { WorkStatus } from "../lib/types";

const STATUSES: (WorkStatus | "all")[] = ["all", "in_progress", "done", "abandoned"];
const STATUS_TEXT: Record<string, string> = {
  all: "All",
  in_progress: "In progress",
  done: "Done",
  abandoned: "Abandoned",
};

export function WorkListPage() {
  const slug = useProjectSlug()!;
  const { data, error, loading, reload } = useAsync(() => api.listWorklogs(slug), [slug]);
  const [status, setStatus] = useState<WorkStatus | "all">("all");
  const [agent, setAgent] = useState("all");
  const [query, setQuery] = useState("");

  const works = data ?? [];
  const agents = useMemo(
    () => [...new Set(works.map((w) => w.agent))].sort((a, b) => a.localeCompare(b)),
    [works]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return works.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (agent !== "all" && w.agent !== agent) return false;
      if (!q) return true;
      return (
        w.title.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        w.excerpt.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [works, status, agent, query]);

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
          <h1 className="page-title">Work</h1>
          <p className="page-sub">
            What every agent did, why they did it, and how it went — one record per unit of work.
          </p>
        </div>
        <div className="page-head-meta tabular">
          {loading ? "loading…" : pluralize(filtered.length, "record")}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={status === s}
              className={`segment${status === s ? " is-active" : ""}`}
              onClick={() => setStatus(s)}
            >
              {STATUS_TEXT[s]}
              <span className="segment-count tabular">
                {s === "all" ? works.length : works.filter((w) => w.status === s).length}
              </span>
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          <select
            className="select"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            aria-label="Filter by agent"
          >
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="search"
            value={query}
            placeholder="Search titles, ids, tags…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search work logs"
          />
        </div>
      </div>

      {loading ? (
        <Skeleton rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={works.length ? "No work matches those filters" : "No work recorded yet"}
          hint={
            works.length
              ? "Clear the filters to see every record."
              : "Agents create records with `agentmon work start -p " + slug + " --agent <name> --title <t>`."
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table table-rows">
            <thead>
              <tr>
                <th className="col-id">ID</th>
                <th>Title</th>
                <th className="col-status">Status</th>
                <th className="col-agent">Agent</th>
                <th className="col-date">Started</th>
                <th className="col-date">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.id}>
                  <td className="col-id mono">
                    <Link to={`/p/${slug}/work/${w.id}`}>{w.id}</Link>
                  </td>
                  <td>
                    <Link className="cell-title" to={`/p/${slug}/work/${w.id}`}>
                      {w.title}
                    </Link>
                    <div className="cell-sub">{w.excerpt}</div>
                    {w.tags.length > 0 && (
                      <div className="tag-row">
                        {w.tags.map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="col-status">
                    <WorkStatusPill status={w.status} />
                  </td>
                  <td className="col-agent">
                    <AgentChip name={w.agent} />
                  </td>
                  <td className="col-date muted tabular">{formatDate(w.started)}</td>
                  <td className="col-date muted tabular">{formatRelative(w.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
