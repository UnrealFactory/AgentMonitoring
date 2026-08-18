import { Link } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import {
  AgentChip,
  Card,
  EmptyState,
  ErrorState,
  SeverityBadge,
  Skeleton,
  Stat,
  WorkStatusPill,
} from "../components/ui";
import { eventLabel, eventTone, formatDateTime, formatRelative } from "../lib/format";

export function DashboardPage() {
  const slug = useProjectSlug()!;
  const { data, error, loading, reload } = useAsync(() => api.getStatus(slug), [slug]);

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
        <Skeleton rows={6} />
      </div>
    );
  }

  const { project, activeWork, openBugs, recentEvents, agents } = data;
  const critical = openBugs.filter((b) => b.severity === "critical" || b.severity === "high").length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-sub">{project.description}</p>
        </div>
        <div className="page-head-meta tabular">
          Last activity {formatRelative(project.counts.lastActivity)}
        </div>
      </header>

      <div className="stat-row">
        <Stat label="Work in progress" value={project.counts.workInProgress} tone="accent" />
        <Stat label="Work completed" value={project.counts.workDone} tone="green" />
        <Stat
          label="Open bugs"
          value={project.counts.bugsOpen}
          tone={critical > 0 ? "red" : "neutral"}
          hint={critical > 0 ? `${critical} high or critical` : "none critical"}
        />
        <Stat label="Recorded events" value={project.counts.events} />
        <Stat label="Agents" value={agents.length} tone="purple" />
      </div>

      <div className="grid-2">
        <Card
          title="Active work"
          action={
            <Link className="card-action" to={`/p/${slug}/work`}>
              All work
            </Link>
          }
        >
          {activeWork.length === 0 ? (
            <EmptyState
              title="No work in progress"
              hint="Agents open a work log with `agentmon work start` before they touch code."
            />
          ) : (
            <ul className="list">
              {activeWork.map((w) => (
                <li key={w.id}>
                  <Link className="list-row" to={`/p/${slug}/work/${w.id}`}>
                    <span className="list-id mono">{w.id}</span>
                    <span className="list-main">
                      <span className="list-title">{w.title}</span>
                      <span className="list-sub">
                        <AgentChip name={w.agent} />
                        <span>· updated {formatRelative(w.lastActivity)}</span>
                      </span>
                    </span>
                    <span className="list-side">
                      <WorkStatusPill status={w.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Open bugs"
          action={
            <Link className="card-action" to={`/p/${slug}/bugs`}>
              Bug board
            </Link>
          }
        >
          {openBugs.length === 0 ? (
            <EmptyState title="No open bugs" hint="Nothing is waiting on a fix right now." />
          ) : (
            <ul className="list">
              {openBugs.map((b) => (
                <li key={b.id}>
                  <Link className="list-row" to={`/p/${slug}/bugs/${b.id}`}>
                    <span className="list-id mono">{b.id}</span>
                    <span className="list-main">
                      <span className="list-title">{b.title}</span>
                      <span className="list-sub">
                        <AgentChip name={b.reporter} />
                        <span>· filed {formatRelative(b.created)}</span>
                      </span>
                    </span>
                    <span className="list-side">
                      <SeverityBadge severity={b.severity} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Activity">
          {recentEvents.length === 0 ? (
            <EmptyState title="No events yet" hint="Every CLI mutation appends one line to events.jsonl." />
          ) : (
            <ol className="timeline">
              {recentEvents.slice(0, 14).map((e, i) => (
                <li className={`timeline-item tone-${eventTone(e.type)}`} key={`${e.ts}-${i}`}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <div className="timeline-body">
                    <div className="timeline-head">
                      <span className="timeline-actor">{e.actor}</span>
                      <span className="timeline-verb">{eventLabel(e.type)}</span>
                      {e.ref && <span className="timeline-ref mono">{e.ref}</span>}
                    </div>
                    <div className="timeline-summary">{e.summary}</div>
                  </div>
                  <time className="timeline-ts tabular" dateTime={e.ts} title={formatDateTime(e.ts)}>
                    {formatRelative(e.ts)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Agents">
          {agents.length === 0 ? (
            <EmptyState title="No agents have recorded anything yet" />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="num">Active</th>
                  <th className="num">Done</th>
                  <th className="num">Bugs filed</th>
                  <th className="num">Bugs fixed</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agent}>
                    <td>
                      <AgentChip name={a.agent} />
                    </td>
                    <td className="num">{a.inProgress}</td>
                    <td className="num">{a.done}</td>
                    <td className="num">{a.bugsReported}</td>
                    <td className="num">{a.bugsResolved}</td>
                    <td className="muted tabular">{formatRelative(a.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
