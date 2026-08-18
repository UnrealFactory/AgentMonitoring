//! Vault record types (schema v1).
//!
//! Two naming worlds meet here:
//!   * on disk, YAML frontmatter uses the exact keys from SPEC.md (`resolved_by`);
//!   * over the wire (Tauri `invoke` / `/vault-api`), everything is camelCase JSON.
//!
//! Deserialization accepts both spellings, serialization emits camelCase, and the
//! `to_frontmatter` helpers emit spec-exact YAML so the CLI can round-trip files.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// vault.json
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub created_at: Option<String>,
    /// Absolute path of the vault on this machine (filled in by the reader, not stored).
    #[serde(default)]
    pub path: String,
    /// How the vault directory was resolved: `flag`, `env`, `config` or `cwd`.
    #[serde(default)]
    pub source: String,
}

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Active,
    Archived,
}

impl Default for ProjectStatus {
    fn default() -> Self {
        ProjectStatus::Active
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub status: ProjectStatus,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    /// Counts filled in by the reader so list screens do not need N extra round trips.
    #[serde(default, skip_deserializing)]
    pub counts: ProjectCounts,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCounts {
    pub work_total: usize,
    pub work_in_progress: usize,
    pub work_done: usize,
    pub bugs_total: usize,
    pub bugs_open: usize,
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
