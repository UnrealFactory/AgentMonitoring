//! agentmon-core — the vault schema and the only place that knows how AgentMonitoring
//! records are stored on disk.
//!
//! The vault is plain files (see SPEC.md, "Vault schema (v1)"):
//!
//! ```text
//! vault/
//!   vault.json
//!   projects/<slug>/
//!     project.json
//!     events.jsonl
//!     worklogs/WORK-0001.md      # YAML frontmatter + Markdown body
//!     bugs/BUG-0001.md
//! ```
//!
//! Both consumers are thin wrappers over this crate: the `agentmon` CLI writes records,
//! and the Tauri desktop app reads them. Parsing is deliberately lenient — unknown
//! frontmatter keys and unknown body sections are preserved rather than rejected, so a
//! newer writer never bricks an older reader.

pub mod body;
pub mod doctor;
pub mod error;
pub mod fsx;
pub mod model;
pub mod time;
pub mod validate;
pub mod vault;
pub mod write;

pub use error::{BodyRejection, CoreError, Result};
pub use model::{
    AgentActivity, Bug, BugComment, BugDetail, BugStatus, BugSummary, Event, Project, ProjectCounts,
    ProjectStatus, ProjectStatusSnapshot, Section, Severity, VaultInfo, WorkStatus, WorkUpdate,
    Worklog, WorklogDetail, WorklogSummary,
};
pub use vault::{next_id, validate_id, validate_slug, Vault};
pub use write::{
    parse_bug_status, parse_project_status, parse_severity, parse_work_status, AbandonWork,
    FinishWork, NewBug, NewProject, StartWork, UpdateProject, Written,
};

/// Vault schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;

/// The one timestamp format in the vault: UTC, second precision, ISO8601 with `Z`.
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
