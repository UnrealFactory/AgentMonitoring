/**
 * Shared visual primitives. Status is always carried the same way everywhere in the app:
 * a small coloured dot plus a label, never a shouting block of colour.
 */
import type { ReactNode } from "react";
import type { BugStatus, Severity, WorkStatus } from "../lib/types";
import { BUG_STATUS_LABEL, SEVERITY_LABEL, WORK_STATUS_LABEL } from "../lib/format";

export function WorkStatusPill({ status }: { status: WorkStatus }) {
  return (
    <span className={`pill pill-work-${status}`}>
      <span className="dot" aria-hidden="true" />
      {WORK_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function BugStatusPill({ status }: { status: BugStatus }) {
  return (
    <span className={`pill pill-bug-${status}`}>
      <span className="dot" aria-hidden="true" />
      {BUG_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`pill pill-sev-${severity}`}>
      <span className="dot" aria-hidden="true" />
      {SEVERITY_LABEL[severity] ?? severity}
    </span>
  );
}

/** Status without the label: the list rows carry it as a dot in front of the id. */
export function WorkStatusDot({ status }: { status: WorkStatus }) {
  return (
    <span
      className={`sdot sdot-${status}`}
      title={WORK_STATUS_LABEL[status] ?? status}
      aria-label={WORK_STATUS_LABEL[status] ?? status}
      role="img"
    />
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

/**
 * Agent identity. `md` is the byline size (the record's author, as on a PR page);
 * `sm` is the in-a-row size.
 */
export function AgentChip({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(/[-_\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className={size === "md" ? "agent agent-md" : "agent"}>
      <span className="agent-avatar" aria-hidden="true">
        {initials || "?"}
      </span>
      <span className="agent-name">{name}</span>
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `card ${className}` : "card"}>
      {(title || action) && (
        <header className="card-head">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  icon = "·",
  action,
}: {
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton" style={{ width: `${28 + ((i * 17) % 40)}%` }} />
          <span className="skeleton skeleton-sm" style={{ width: `${12 + ((i * 11) % 22)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p className="error-title">Could not read the vault</p>
      <p className="error-message">{message}</p>
      {onRetry && (
        <button className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="meta-row">
      <dt className="meta-label">{label}</dt>
      <dd className="meta-value">{children}</dd>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "accent" | "green" | "amber" | "red" | "purple";
  hint?: ReactNode;
}) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-value tabular">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
