/**
 * Wire types for the vault API. These mirror the serde output of agentmon-core
 * exactly; both transports (Tauri `invoke` and `/vault-api/*`) return these shapes.
 */

export type WorkStatus = "in_progress" | "done" | "abandoned";
export type BugStatus = "open" | "in_progress" | "resolved" | "closed";
export type Severity = "critical" | "high" | "medium" | "low";
export type ProjectStatus = "active" | "archived";

export interface VaultInfo {
  version: number;
  name: string;
  createdAt: string | null;
  /** Absolute path of the vault on this machine. */
  path: string;
  /** How it was resolved: flag | env | cwd/vault | cwd. */
  source: string;
}

export interface ProjectCounts {
  workTotal: number;
  workInProgress: number;
  workDone: number;
  bugsTotal: number;
  bugsOpen: number;
  events: number;
  lastActivity: string | null;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ProjectStatus;
  tags: string[];
  createdAt: string | null;
  counts: ProjectCounts;
}

export type EventType =
  | "work_started"
  | "work_updated"
  | "work_done"
  | "work_abandoned"
  | "bug_created"
  | "bug_claimed"
  | "bug_commented"
  | "bug_resolved"
  | "bug_closed"
  | "project_created";

export interface VaultEvent {
  ts: string;
  actor: string;
  type: EventType | string;
  ref: string | null;
  summary: string;
}

export interface WorkUpdate {
  ts: string;
  body: string;
}

interface WorklogMeta {
  id: string;
  title: string;
  agent: string;
  status: WorkStatus;
  started: string;
  finished: string | null;
  tags: string[];
  refs: string[];
  files: string[];
  lastActivity: string;
}

export interface WorklogSummary extends WorklogMeta {
  /** First paragraph of `## What`, for list previews. */
  excerpt: string;
  updateCount: number;
}

export interface Section {
  title: string;
  body: string;
}

export interface WorklogDetail extends WorklogMeta {
  what: string;
  why: string;
  how: string;
  updates: WorkUpdate[];
  outcome: string | null;
  /** Sections outside the SPEC set, kept verbatim. */
  extraSections: Section[];
  /** Untouched markdown body. */
  body: string;
}

interface BugMeta {
  id: string;
  title: string;
  reporter: string;
  assignee: string | null;
  severity: Severity;
  status: BugStatus;
  labels: string[];
  created: string;
  claimed: string | null;
  resolved: string | null;
  resolvedBy: string | null;
  refs: string[];
  lastActivity: string;
}

export interface BugSummary extends BugMeta {
  excerpt: string;
  commentCount: number;
}

export interface BugComment {
  ts: string;
  agent: string;
  body: string;
}

export interface BugDetail extends BugMeta {
  report: string;
  comments: BugComment[];
  resolution: string | null;
  extraSections: Section[];
  body: string;
}

export interface AgentActivity {
  agent: string;
  inProgress: number;
  done: number;
  bugsReported: number;
  bugsResolved: number;
  lastActivity: string;
}

export interface ProjectStatusSnapshot {
  project: Project;
  activeWork: WorklogSummary[];
  openBugs: BugSummary[];
  recentEvents: VaultEvent[];
  agents: AgentActivity[];
}
