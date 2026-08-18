use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, CoreError>;

/// Every error carries enough context for an agent to fix it without guessing:
/// what was being read, where, and (where applicable) what to run instead.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("no vault found at {path}: {hint}")]
    VaultNotFound { path: PathBuf, hint: String },

    #[error("project '{slug}' not found in vault {vault} (run `agentmon project list` to see projects)")]
    ProjectNotFound { slug: String, vault: PathBuf },

    #[error("record '{id}' not found in project '{slug}' (expected file {path})")]
    RecordNotFound {
        id: String,
        slug: String,
        path: PathBuf,
    },

    #[error("{path}: {message}")]
    Malformed { path: PathBuf, message: String },

    #[error("invalid id '{id}': expected the form {expected}")]
    InvalidId { id: String, expected: String },

    /// A flag value that is not one of the allowed words.
    #[error("invalid {what} '{value}': expected {expected}")]
    InvalidValue {
        what: String,
        value: String,
        expected: String,
    },

    /// The record body an agent supplied does not have the sections SPEC.md requires.
    /// Display prints what is missing *and* the template to copy, because the caller is
    /// usually another agent that has to get it right on the next try.
    #[error("{}", .0)]
    InvalidBody(Box<BodyRejection>),

    /// A mutation that the record's current state does not allow (already done, already
    /// claimed by someone else, project already exists, ...).
    #[error("{what} (fix: {fix})")]
    Conflict { what: String, fix: String },

    /// Another `agentmon` process is mid-write in this project.
    #[error("another agentmon process is writing to {path} (lock held for {held_secs}s). \
Wait for it to finish and re-run; if that process died, delete the lock file.")]
    Locked { path: PathBuf, held_secs: u64 },

    #[error("io error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}

/// Why a body was rejected, plus the exact text an agent should have written.
#[derive(Debug)]
pub struct BodyRejection {
    /// e.g. "work log body", "outcome", "bug report", "resolution".
    pub subject: String,
    pub problems: Vec<String>,
    /// The template to copy, already indented for terminal output.
    pub template: String,
    /// A complete, copy-pasteable command that would have worked.
    pub example: String,
}

impl std::fmt::Display for BodyRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "{} rejected:", self.subject)?;
        for p in &self.problems {
            writeln!(f, "  - {p}")?;
        }
        writeln!(f, "\nExpected structure:\n\n{}", indent(&self.template, "    "))?;
        write!(f, "\nExample that works (Git Bash):\n\n{}", indent(&self.example, "    "))
    }
}

fn indent(text: &str, pad: &str) -> String {
    text.lines()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

impl CoreError {
    pub fn io(path: impl AsRef<Path>, source: std::io::Error) -> Self {
        CoreError::Io {
            path: path.as_ref().to_path_buf(),
            source,
        }
    }

    pub fn malformed(path: impl AsRef<Path>, message: impl Into<String>) -> Self {
        CoreError::Malformed {
            path: path.as_ref().to_path_buf(),
            message: message.into(),
        }
    }

    pub fn conflict(what: impl Into<String>, fix: impl Into<String>) -> Self {
        CoreError::Conflict {
            what: what.into(),
            fix: fix.into(),
        }
    }

    /// Stable machine-readable kind, mirrored by the CLI's exit codes and `--json` errors.
    pub fn kind(&self) -> &'static str {
        match self {
            CoreError::VaultNotFound { .. } => "vault_not_found",
            CoreError::ProjectNotFound { .. } => "project_not_found",
            CoreError::RecordNotFound { .. } => "record_not_found",
            CoreError::Malformed { .. } => "invalid_vault",
            CoreError::InvalidId { .. } | CoreError::InvalidValue { .. } => "invalid_argument",
            CoreError::InvalidBody(_) => "invalid_body",
            CoreError::Conflict { .. } => "conflict",
            CoreError::Locked { .. } => "locked",
            CoreError::Io { .. } => "io_error",
        }
    }
}
