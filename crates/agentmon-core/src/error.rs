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

    #[error("io error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
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
}
