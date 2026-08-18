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
pub mod error;
pub mod model;
pub mod vault;

pub use error::{CoreError, Result};
pub use model::{
    AgentActivity, Bug, BugComment, BugDetail, BugStatus, BugSummary, Event, Project, ProjectCounts,
    ProjectStatus, ProjectStatusSnapshot, Section, Severity, VaultInfo, WorkStatus, WorkUpdate,
    Worklog, WorklogDetail, WorklogSummary,
};
pub use vault::{next_id, validate_id, validate_slug, Vault};

/// Vault schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;
