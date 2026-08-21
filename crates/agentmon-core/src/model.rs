//! Project record types (schema v2).
//!
//! Two naming worlds meet here:
//!   * on disk, YAML frontmatter uses the exact keys from SPEC.md (`resolved_by`);
//!   * over the wire (Tauri `invoke` / `/project-api`), everything is camelCase JSON.
//!
//! Deserialization accepts both spellings, serialization emits camelCase, and the
//! `to_frontmatter` helpers emit spec-exact YAML so the CLI can round-trip files.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------

fn v1() -> u32 {
    1 // a project.json without a version key predates the key: schema v1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    #[serde(default = "v1")]
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    /// Counts filled in by the reader so list screens do not need N extra round trips.
    #[serde(default, skip_deserializing)]
    pub counts: ProjectCounts,
    /// Absolute path of the AgentMonitoring folder on this machine (filled in by the
    /// reader, never stored — the folder must stay movable).
    #[serde(default, skip_deserializing)]
    pub path: String,
    /// How the folder was resolved: `flag`, `env`, `walk`, `registry`.
    #[serde(default, skip_deserializing)]
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCounts {
    pub work_total: usize,
    pub work_in_progress: usize,
    pub work_done: usize,
    pub bugs_total: usize,
    pub bugs_open: usize,
    #[serde(default)]
    pub notes_total: usize,
    pub events: usize,
    #[serde(default)]
    pub last_activity: Option<String>,
}

// ---------------------------------------------------------------------------
// events.jsonl
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub ts: String,
    pub actor: String,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub r#ref: Option<String>,
    #[serde(default)]
    pub summary: String,
}

// ---------------------------------------------------------------------------
// worklogs/WORK-NNNN.md
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkStatus {
    InProgress,
    Done,
    Abandoned,
}

impl WorkStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            WorkStatus::InProgress => "in_progress",
            WorkStatus::Done => "done",
            WorkStatus::Abandoned => "abandoned",
        }
    }
}

/// Worklog frontmatter exactly as stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worklog {
    pub id: String,
    pub title: String,
    pub agent: String,
    pub status: WorkStatus,
    pub started: String,
    #[serde(default)]
    pub finished: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub refs: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkUpdate {
    pub ts: String,
    pub body: String,
}

/// A worklog as the list screens need it: frontmatter + cheap derived fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorklogSummary {
    #[serde(flatten)]
    pub meta: Worklog,
    /// First paragraph of `## What`, for one-line previews.
    pub excerpt: String,
    /// What / Why / How / the updates / the outcome, flattened — so a search on the list
    /// screens reaches the whole record and not just the line the list happens to show.
    #[serde(default)]
    pub search_text: String,
    pub update_count: usize,
    pub last_activity: String,
}

/// A worklog with its body split into the sections SPEC.md mandates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorklogDetail {
    #[serde(flatten)]
    pub meta: Worklog,
    pub what: String,
    pub why: String,
    pub how: String,
    pub updates: Vec<WorkUpdate>,
    #[serde(default)]
    pub outcome: Option<String>,
    /// Sections we do not know about are kept verbatim (forward compatibility).
    #[serde(default)]
    pub extra_sections: Vec<Section>,
    /// The untouched markdown body, for "view raw".
    pub body: String,
    pub last_activity: String,
}

// ---------------------------------------------------------------------------
// notes/<name>.md
// ---------------------------------------------------------------------------

/// What a note is *for*. Work logs and bugs are history — they record what happened and
/// are never taken back. A note is **knowledge**: the thing an agent wishes the previous
/// agent had told it. The type is the reader's first filter, so the set is small and
/// each member answers a different question.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteType {
    /// A durable fact about this project a future agent needs: a gotcha, a convention,
    /// an invariant that is not obvious from the code.
    Memory,
    /// State passed to whoever works next: what is done, what is mid-flight, what to do
    /// first. Updated in place as sessions hand over.
    Handoff,
    /// A choice and its reasoning: what was decided, what was rejected, and why — so the
    /// question does not get relitigated from scratch.
    Decision,
    /// A pointer to something outside the project: a URL, a dashboard, a spec, a ticket.
    Reference,
}

impl NoteType {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteType::Memory => "memory",
            NoteType::Handoff => "handoff",
            NoteType::Decision => "decision",
            NoteType::Reference => "reference",
        }
    }

    pub const ALL: [NoteType; 4] = [
        NoteType::Memory,
        NoteType::Handoff,
        NoteType::Decision,
        NoteType::Reference,
    ];
}

/// Note frontmatter exactly as stored. The `name` is the identity: kebab-case, unique in
/// the project, and the file name (`notes/<name>.md`) — there is no NOTE-NNNN sequence,
/// because a note is looked up by what it is about, not by when it was written.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub name: String,
    pub title: String,
    #[serde(rename = "type")]
    pub note_type: NoteType,
    /// One line, shown in every list: the hook an agent scans to decide whether the body
    /// is worth reading. The note's whole recall path runs through this sentence.
    pub description: String,
    /// Who created the note. The frontmatter keeps the author even as others rewrite.
    pub agent: String,
    /// Who last rewrote it — the agent whose words the current body is. `None` until the
    /// first update. A note is shared and mutable, so the screens showing one agent next
    /// to a body must show *this* one; the full edit trail is the event log's.
    #[serde(default, alias = "updated_by")]
    pub updated_by: Option<String>,
    pub created: String,
    pub updated: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Related records and notes: WORK-NNNN, BUG-NNNN, or another note's name.
    #[serde(default)]
    pub refs: Vec<String>,
}

/// A note as the list screens need it: frontmatter + cheap derived fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    #[serde(flatten)]
    pub meta: Note,
    /// First paragraph of the body, for previews where the description is already shown.
    pub excerpt: String,
    /// Description + body flattened, so search reaches the whole note.
    #[serde(default)]
    pub search_text: String,
    pub last_activity: String,
}

/// A note with its whole body. The body is free-form markdown on purpose: unlike a work
/// log, a note has no mandated sections — its shape is whatever the knowledge needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDetail {
    #[serde(flatten)]
    pub meta: Note,
    pub body: String,
    pub last_activity: String,
}

// ---------------------------------------------------------------------------
// bugs/BUG-NNNN.md
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Critical => "critical",
            Severity::High => "high",
            Severity::Medium => "medium",
            Severity::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BugStatus {
    Open,
    InProgress,
    Resolved,
    Closed,
}

impl BugStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            BugStatus::Open => "open",
            BugStatus::InProgress => "in_progress",
            BugStatus::Resolved => "resolved",
            BugStatus::Closed => "closed",
        }
    }

    /// Open and in_progress bugs are the ones that still need someone.
    pub fn is_open(self) -> bool {
        matches!(self, BugStatus::Open | BugStatus::InProgress)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bug {
    pub id: String,
    pub title: String,
    pub reporter: String,
    #[serde(default)]
    pub assignee: Option<String>,
    pub severity: Severity,
    pub status: BugStatus,
    #[serde(default)]
    pub labels: Vec<String>,
    pub created: String,
    #[serde(default)]
    pub claimed: Option<String>,
    #[serde(default)]
    pub resolved: Option<String>,
    #[serde(default, alias = "resolved_by")]
    pub resolved_by: Option<String>,
    #[serde(default)]
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugComment {
    pub ts: String,
    pub agent: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugSummary {
    #[serde(flatten)]
    pub meta: Bug,
    pub excerpt: String,
    /// The report, the thread and the resolution, flattened — the board's search reaches
    /// the whole bug, the way an issue tracker's does.
    #[serde(default)]
    pub search_text: String,
    pub comment_count: usize,
    pub last_activity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BugDetail {
    #[serde(flatten)]
    pub meta: Bug,
    pub report: String,
    pub comments: Vec<BugComment>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub extra_sections: Vec<Section>,
    pub body: String,
    pub last_activity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub title: String,
    pub body: String,
}

// ---------------------------------------------------------------------------
// dashboard snapshot
// ---------------------------------------------------------------------------

/// What `agentmon status` prints and what the dashboard screen renders.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatusSnapshot {
    pub project: Project,
    pub active_work: Vec<WorklogSummary>,
    pub open_bugs: Vec<BugSummary>,
    /// Most recently updated notes — the knowledge a newly arriving agent reads first.
    #[serde(default)]
    pub recent_notes: Vec<NoteSummary>,
    pub recent_events: Vec<Event>,
    pub agents: Vec<AgentActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    pub agent: String,
    pub in_progress: usize,
    pub done: usize,
    pub bugs_reported: usize,
    pub bugs_resolved: usize,
    #[serde(default)]
    pub notes: usize,
    pub last_activity: String,
}

// ---------------------------------------------------------------------------
// frontmatter writers (spec-exact key spelling)
// ---------------------------------------------------------------------------

fn yaml_scalar(value: &str) -> String {
    // Quote anything that YAML could read as something other than a plain string.
    let needs_quotes = value.is_empty()
        || value.starts_with(' ')
        || value.ends_with(' ')
        || value.contains(": ")
        || value.contains(" #")
        || value.starts_with(['"', '\'', '[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`'])
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "null" | "true" | "false" | "yes" | "no" | "on" | "off" | "~"
        )
        || value.ends_with(':');
    if needs_quotes {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn yaml_list(values: &[String]) -> String {
    let inner: Vec<String> = values.iter().map(|v| yaml_scalar(v)).collect();
    format!("[{}]", inner.join(", "))
}

fn yaml_opt(value: &Option<String>) -> String {
    match value {
        Some(v) => yaml_scalar(v),
        None => "null".to_string(),
    }
}

impl Worklog {
    /// Render the frontmatter block (without the `---` fences) exactly as SPEC.md shows it.
    pub fn to_frontmatter(&self) -> String {
        format!(
            "id: {}\ntitle: {}\nagent: {}\nstatus: {}\nstarted: {}\nfinished: {}\ntags: {}\nrefs: {}\nfiles: {}\n",
            yaml_scalar(&self.id),
            yaml_scalar(&self.title),
            yaml_scalar(&self.agent),
            self.status.as_str(),
            yaml_scalar(&self.started),
            yaml_opt(&self.finished),
            yaml_list(&self.tags),
            yaml_list(&self.refs),
            yaml_list(&self.files),
        )
    }
}

impl Note {
    pub fn to_frontmatter(&self) -> String {
        format!(
            "name: {}\ntitle: {}\ntype: {}\ndescription: {}\nagent: {}\nupdated_by: {}\ncreated: {}\nupdated: {}\ntags: {}\nrefs: {}\n",
            yaml_scalar(&self.name),
            yaml_scalar(&self.title),
            self.note_type.as_str(),
            yaml_scalar(&self.description),
            yaml_scalar(&self.agent),
            yaml_opt(&self.updated_by),
            yaml_scalar(&self.created),
            yaml_scalar(&self.updated),
            yaml_list(&self.tags),
            yaml_list(&self.refs),
        )
    }

    /// The agent whose words the current body is: the last rewriter, else the author.
    pub fn current_agent(&self) -> &str {
        self.updated_by.as_deref().unwrap_or(&self.agent)
    }
}

impl Bug {
    pub fn to_frontmatter(&self) -> String {
        format!(
            "id: {}\ntitle: {}\nreporter: {}\nassignee: {}\nseverity: {}\nstatus: {}\nlabels: {}\ncreated: {}\nclaimed: {}\nresolved: {}\nresolved_by: {}\nrefs: {}\n",
            yaml_scalar(&self.id),
            yaml_scalar(&self.title),
            yaml_scalar(&self.reporter),
            yaml_opt(&self.assignee),
            self.severity.as_str(),
            self.status.as_str(),
            yaml_list(&self.labels),
            yaml_scalar(&self.created),
            yaml_opt(&self.claimed),
            yaml_opt(&self.resolved),
            yaml_opt(&self.resolved_by),
            yaml_list(&self.refs),
        )
    }
}

// ---------------------------------------------------------------------------
// app feedback — ~/.AgentMonitoring/feedback/FB-NNNN.md (machine-level, no project)
// ---------------------------------------------------------------------------

/// What a feedback item is about: a defect in this app, or a wish for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackKind {
    Bug,
    Idea,
}

impl FeedbackKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FeedbackKind::Bug => "bug",
            FeedbackKind::Idea => "idea",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackStatus {
    Open,
    Done,
}

impl FeedbackStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            FeedbackStatus::Open => "open",
            FeedbackStatus::Done => "done",
        }
    }
}

/// A bug report or feature wish **about the AgentMonitoring app itself**, filed by an
/// agent that was using it. Machine-level like the registry — it belongs to no project,
/// so it lives beside `registry.json`, not inside any repo (see `feedback.rs`).
///
/// The whole item is one struct: the body is short prose, not sectioned, and the app's
/// board wants it in the same payload as the metadata. `body` never appears in the YAML
/// frontmatter — it is the markdown after the fence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackItem {
    pub id: String,
    pub title: String,
    /// Spec key `type`, wire key `type` — one key everywhere, like a note's.
    #[serde(rename = "type")]
    pub kind: FeedbackKind,
    pub agent: String,
    pub status: FeedbackStatus,
    pub created: String,
    /// When the human marked it handled; cleared by reopen.
    #[serde(default)]
    pub done: Option<String>,
    /// Markdown after the frontmatter fence; may be empty — a good title can be the
    /// whole report, and friction here would cost real feedback.
    #[serde(default)]
    pub body: String,
}

impl FeedbackItem {
    pub fn to_frontmatter(&self) -> String {
        format!(
            "id: {}\ntitle: {}\ntype: {}\nagent: {}\nstatus: {}\ncreated: {}\ndone: {}\n",
            yaml_scalar(&self.id),
            yaml_scalar(&self.title),
            self.kind.as_str(),
            yaml_scalar(&self.agent),
            self.status.as_str(),
            yaml_scalar(&self.created),
            yaml_opt(&self.done),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worklog_frontmatter_round_trips() {
        let w = Worklog {
            id: "WORK-0001".into(),
            title: "Implement vault parser: lenient mode".into(),
            agent: "rust-core-builder".into(),
            status: WorkStatus::InProgress,
            started: "2026-08-18T09:12:00Z".into(),
            finished: None,
            tags: vec!["core".into(), "rust".into()],
            refs: vec!["BUG-0002".into()],
            files: vec!["crates/agentmon-core/src/vault.rs".into()],
        };
        let yaml = w.to_frontmatter();
        assert!(yaml.contains("finished: null"));
        let back: Worklog = serde_yaml::from_str(&yaml).expect("frontmatter parses back");
        assert_eq!(back.id, w.id);
        assert_eq!(back.title, w.title);
        assert_eq!(back.status, WorkStatus::InProgress);
        assert_eq!(back.tags, w.tags);
        assert!(back.finished.is_none());
    }

    #[test]
    fn note_frontmatter_round_trips_with_type_as_the_key() {
        let n = Note {
            name: "registry-gate-gotcha".into(),
            title: "Gate scripts must sandbox the registry".into(),
            note_type: NoteType::Memory,
            description: "Any script that runs `agentmon init` must set AGENTMON_REGISTRY_DIR.".into(),
            agent: "gate-builder".into(),
            updated_by: Some("second-editor".into()),
            created: "2026-08-20T09:00:00Z".into(),
            updated: "2026-08-20T09:00:00Z".into(),
            tags: vec!["gates".into()],
            refs: vec!["WORK-0035".into()],
        };
        let yaml = n.to_frontmatter();
        assert!(yaml.contains("type: memory"), "{yaml}");
        assert!(yaml.contains("updated_by: second-editor"), "{yaml}");
        let back: Note = serde_yaml::from_str(&yaml).expect("frontmatter parses back");
        assert_eq!(back.name, n.name);
        assert_eq!(back.note_type, NoteType::Memory);
        assert_eq!(back.refs, n.refs);
        assert_eq!(back.current_agent(), "second-editor");
        // …and the wire shape uses "type" too, so the frontend filters on one key.
        let json = serde_json::to_value(&back).unwrap();
        assert_eq!(json["type"], "memory");
        assert!(json.get("noteType").is_none());
        assert_eq!(json["updatedBy"], "second-editor", "wire is camelCase, disk is spec-exact");
    }

    #[test]
    fn bug_frontmatter_uses_spec_key_spelling() {
        let b = Bug {
            id: "BUG-0001".into(),
            title: "App crashes when vault.json is missing".into(),
            reporter: "ui-builder".into(),
            assignee: None,
            severity: Severity::High,
            status: BugStatus::Open,
            labels: vec!["cli".into(), "crash".into()],
            created: "2026-08-18T09:12:00Z".into(),
            claimed: None,
            resolved: None,
            resolved_by: None,
            refs: vec![],
        };
        let yaml = b.to_frontmatter();
        assert!(yaml.contains("resolved_by: null"), "{yaml}");
        let back: Bug = serde_yaml::from_str(&yaml).expect("frontmatter parses back");
        assert_eq!(back.severity, Severity::High);
        assert!(back.status.is_open());
    }
}
