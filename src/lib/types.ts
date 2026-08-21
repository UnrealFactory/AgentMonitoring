/**
 * Wire types for the project API (schema v2). These mirror the serde output of
 * agentmon-core exactly; both transports (Tauri `invoke` and `/project-api/*`) return
 * these shapes.
 */

export type WorkStatus = "in_progress" | "done" | "abandoned";
export type BugStatus = "open" | "in_progress" | "resolved" | "closed";
export type Severity = "critical" | "high" | "medium" | "low";
/** What a note is for: the reader's first filter (see SPEC.md, notes). */
export type NoteType = "essential" | "memory" | "handoff" | "decision" | "reference";
export type FeedbackKind = "bug" | "idea";
export type FeedbackStatus = "open" | "done";

/**
 * A bug or wish an agent filed **about this app itself** — machine-level, belonging to
 * no project (`~/.AgentMonitoring/feedback/FB-NNNN.md`).
 */
export interface FeedbackItem {
  id: string;
  title: string;
  type: FeedbackKind;
  agent: string;
  status: FeedbackStatus;
  created: string;
  /** When the human marked it handled; null while open. */
  done: string | null;
  /** Short markdown prose; may be empty — a title can carry a whole wish. */
  body: string;
}

export interface ProjectCounts {
  workTotal: number;
  workInProgress: number;
  workDone: number;
  bugsTotal: number;
  bugsOpen: number;
  notesTotal: number;
  events: number;
  lastActivity: string | null;
}

export interface Project {
  /** Schema version of project.json — always 2 for anything this build reads. */
  version: number;
  id: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string | null;
  counts: ProjectCounts;
  /** Absolute path of the AgentMonitoring folder on this machine (reader-filled). */
  path: string;
  /** How the folder was resolved: flag | env | walk | registry. */
  source: string;
}

/**
 * One row of the project list: a registered path, and the project inside it when the
 * folder is reachable. An unavailable row (unplugged drive, moved folder) still renders —
 * dimmed, by the name the registry last saw — instead of failing the whole list.
 */
export interface ProjectRow {
  available: boolean;
  path: string;
  name: string | null;
  project?: Project;
  error?: string;
}

/**
 * What a project was, immediately before it was deleted — the answer to
 * `api.deleteProject`, since the record it would otherwise return no longer exists.
 *
 * Mirrors `agentmon_core::Deleted` (crates/agentmon-core/src/write.rs) and the JSON the
 * dev server's `DELETE /project-api/projects/:id` returns.
 */
export interface DeletedProject {
  ok: boolean;
  id: string;
  name: string;
  /** The directory that was removed, as it resolved on this machine. */
  path: string;
  counts: ProjectCounts;
  deletedBy: string;
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
  | "note_created"
  | "note_updated"
  | "note_removed"
  | "project_created"
  | "project_updated";

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
  /** What/Why/How, the updates and the outcome flattened to one line, for search. */
  searchText: string;
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
  /** The report, the thread and the resolution flattened to one line, for search. */
  searchText: string;
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

/**
 * A note: the third record kind. Work logs and bugs are history; a note is shared
 * knowledge — memory, handoff, decision or reference — updated in place and removable,
 * with the trail of edits living in the event log. Its identity is `name` (kebab-case,
 * also the file name), not a numeric id.
 */
interface NoteMeta {
  name: string;
  title: string;
  type: NoteType;
  /** One line every list shows: the hook a reader scans to decide whether to open it. */
  description: string;
  /** Who created it. The full edit trail is the event feed's. */
  agent: string;
  /**
   * Who last rewrote it — the agent whose words the current body is. Null until the
   * first update. Lists pair an agent with the updated time, so the agent they show is
   * this one (falling back to the author); the detail page shows both.
   */
  updatedBy: string | null;
  created: string;
  updated: string;
  tags: string[];
  refs: string[];
  lastActivity: string;
}

export interface NoteSummary extends NoteMeta {
  /** First paragraph of the body, for previews where the description is already shown. */
  excerpt: string;
  /** Description + body flattened to one line, for search. */
  searchText: string;
}

export interface NoteDetail extends NoteMeta {
  /** Untouched markdown body — notes have no mandated sections. */
  body: string;
}

export interface AgentActivity {
  agent: string;
  inProgress: number;
  done: number;
  bugsReported: number;
  bugsResolved: number;
  notes: number;
  lastActivity: string;
}

export interface ProjectStatusSnapshot {
  project: Project;
  activeWork: WorklogSummary[];
  openBugs: BugSummary[];
  recentNotes: NoteSummary[];
  recentEvents: VaultEvent[];
  agents: AgentActivity[];
}
