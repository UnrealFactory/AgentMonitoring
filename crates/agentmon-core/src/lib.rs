//! agentmon-core — the project schema and the only place that knows how AgentMonitoring
//! records are stored on disk.
//!
//! One project = one `AgentMonitoring` folder inside a directory the human picked,
//! typically a code repo root (see SPEC.md, "Storage (v2)"):
//!
//! ```text
//! <location>/                    # e.g. a code repo — commit the folder with it
//!   AgentMonitoring/
//!     project.json
//!     events.jsonl
//!     worklogs/WORK-0001.md      # YAML frontmatter + Markdown body
//!     bugs/BUG-0001.md
//! ```
//!
//! Both consumers are thin wrappers over this crate: the `agentmon` CLI writes records,
//! and the Tauri desktop app reads them (every registered project at once — the per-user
//! list lives in [`registry`]). Parsing is deliberately lenient — unknown frontmatter
//! keys and unknown body sections are preserved rather than rejected, so a newer writer
//! never bricks an older reader.

pub mod body;
pub mod claude_md;
pub mod codex_mcp;
pub mod doctor;
pub mod error;
pub mod feedback;
pub mod fsx;
pub mod human;
pub mod mcp_json;
pub mod model;
pub mod reconcile;
pub mod registry;
pub mod store;
pub mod time;
pub mod validate;
pub mod write;

pub use claude_md::{
    parse_agents_md_lang, parse_claude_md_lang, write_agents_md, write_claude_md,
    ClaudeMdLang, ClaudeMdOutcome,
};
pub use error::{BodyRejection, CoreError, HumanRejection, Result};
pub use codex_mcp::write_codex_mcp;
pub use human::{COMPACT_RULES as HUMAN_COMPACT_RULES, STYLE as HUMAN_STYLE};
pub use mcp_json::{find_mcp_server, write_mcp_json, McpJsonOutcome};
pub use feedback::{
    add_feedback, delete_feedback, feedback_dir, list_feedback, parse_feedback_kind,
    parse_feedback_status, set_feedback_human, set_feedback_status, view_feedback, NewFeedback,
};
pub use model::{
    AgentActivity, Bug, BugComment, BugDetail, BugStatus, BugSummary, Event, FeedbackItem,
    FeedbackKind, FeedbackStatus, Note, NoteDetail, NoteSummary, NoteType, Project, ProjectCounts,
    ProjectStatusSnapshot, Section, Severity, WorkStatus, WorkUpdate, Worklog, WorklogDetail,
    WorklogSummary,
};
pub use reconcile::{reconcile, GitAttributes, Mapping, ReconcilePlan, ReconcileRequest};
pub use registry::{Registry, RegistryEntry};
pub use store::{next_id, slugify_note_name, validate_id, validate_note_name, Store, DATA_DIR};
pub use write::{
    data_dir_for, migrate, parse_bug_status, parse_note_type, parse_severity, parse_work_status,
    AbandonWork, Deleted, FinishWork, NewBug, NewNote, NewProject, RemovedNote, StartWork,
    UpdateNote, UpdateProject, Written,
};

/// Schema version this build reads and writes (`"version"` in project.json).
pub const SCHEMA_VERSION: u32 = 2;

/// The one timestamp format in a project: UTC, second precision, ISO8601 with `Z`.
///
/// Every "last activity" comparison in the app is a string comparison on these, so the
/// shape has to be identical everywhere — no sub-second digits on some records and not
/// others, no local offsets.
pub fn now_iso8601() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod lib_tests {
    #[test]
    fn timestamps_are_utc_iso8601_seconds() {
        let ts = super::now_iso8601();
        assert_eq!(ts.len(), 20, "{ts}");
        assert!(ts.ends_with('Z'), "{ts}");
        assert!(chrono::DateTime::parse_from_rfc3339(&ts).is_ok(), "{ts}");
    }
}
