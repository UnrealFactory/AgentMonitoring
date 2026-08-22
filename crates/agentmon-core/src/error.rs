use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, CoreError>;

/// Every error carries enough context for an agent to fix it without guessing:
/// what was being read, where, and (where applicable) what to run instead.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    /// No AgentMonitoring project where one was expected. The wording is shared with the
    /// dev server's twin of this message (scripts/project-fs.mjs); the desktop app shows
    /// it to a human, in Korean, so `src/lib/api.ts` matches the shape and re-says it —
    /// see the tests at the foot of this file before changing the wording.
    #[error("no project found at {path}: {hint}")]
    ProjectDirNotFound { path: PathBuf, hint: String },

    #[error("record '{id}' not found in this project (expected file {path})")]
    RecordNotFound { id: String, path: PathBuf },

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

    /// The human area is missing, blank, or an agent body tried to write the reserved
    /// `## For humans` heading itself.
    ///
    /// Its own variant because this rejection *is* the delivery mechanism of the style
    /// contract: the message names the flag to pass, prints the compact rules extracted
    /// from docs/HUMAN_STYLE.md, and says where the full contract is. Exit code 2 (usage),
    /// per SPEC.md "The human area".
    #[error("{}", .0)]
    MissingHuman(Box<HumanRejection>),

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

/// Why a human area was refused, and everything the next attempt needs.
///
/// The three parts are fixed by SPEC.md: what is wrong, the exact flag that fixes it, then
/// the compact style rules and one line pointing at the full contract. Nothing else — an
/// agent reading this is mid-write, and the cost of the lesson is paid only here.
#[derive(Debug)]
pub struct HumanRejection {
    /// One line: what is wrong, e.g. "no human area supplied for this work log".
    pub problem: String,
    /// The exact flags to pass, e.g. `--human "<text>"` or `--human-file <path>`.
    pub fix: String,
    /// The compact rules, extracted from docs/HUMAN_STYLE.md at build time — or empty for
    /// a refusal about the record's *shape* (an unclosed code fence), where the style
    /// contract is not the lesson and printing it would bury the one-line fix.
    pub rules: &'static str,
}

impl std::fmt::Display for HumanRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "{}", self.problem)?;
        write!(f, "\nFix: {}", self.fix)?;
        if !self.rules.trim().is_empty() {
            write!(f, "\n\nHow to write it:\n\n{}", indent(self.rules, "    "))?;
        }
        // The rules usually end by naming the command themselves; saying it twice in one
        // rejection reads as noise, and this line must never be the thing an agent skips.
        if !self.rules.contains("agentmon human-style") {
            write!(f, "\n\nThe full contract: agentmon human-style")?;
        }
        Ok(())
    }
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

    /// Stable machine-readable kind, mirrored by the CLI's exit codes, the `--json` errors,
    /// and — through that envelope — by `npm run check:errors`, which requires the desktop
    /// app to classify each of these the same way the browser build does.
    pub fn kind(&self) -> &'static str {
        match self {
            CoreError::ProjectDirNotFound { .. } => "project_not_found",
            CoreError::RecordNotFound { .. } => "record_not_found",
            CoreError::Malformed { .. } => "invalid_project",
            CoreError::InvalidId { .. } | CoreError::InvalidValue { .. } => "invalid_argument",
            // A missing human area is a usage mistake (exit 2), so it wears the kind the
            // app and `npm run check:errors` already map for exit 2 — a rejection that
            // never reaches a screen must not invent a class nothing classifies.
            CoreError::MissingHuman(_) => "invalid_argument",
            CoreError::InvalidBody(_) => "invalid_body",
            CoreError::Conflict { .. } => "conflict",
            CoreError::Locked { .. } => "locked",
            CoreError::Io { .. } => "io_error",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These three sentences are read by a human, in Korean, in the desktop app.
    ///
    /// `Display` is the whole API here: Tauri commands return `Result<T, String>`
    /// (src-tauri/src/lib.rs), so what reaches the window is exactly this text, and
    /// `src/lib/api.ts` matches it with a regex to say it in the reader's language. There is
    /// no type between the two halves — this test is the type. Change the wording and it
    /// fails here, next to the string, rather than as English on a Korean screen that only
    /// the desktop build shows; `npm run check:errors` is the same assertion from the other
    /// side, made against the binary this crate builds.
    #[test]
    fn the_messages_the_app_translates() {
        let record = CoreError::RecordNotFound {
            id: "BUG-9999".into(),
            path: PathBuf::from("/p/BUG-9999.md"),
        };
        assert_eq!(
            record.to_string(),
            "record 'BUG-9999' not found in this project (expected file /p/BUG-9999.md)"
        );

        let id = CoreError::InvalidId {
            id: "NOTANID".into(),
            expected: "BUG-NNNN (e.g. BUG-0001)".into(),
        };
        assert_eq!(
            id.to_string(),
            "invalid id 'NOTANID': expected the form BUG-NNNN (e.g. BUG-0001)"
        );

        let dir = CoreError::ProjectDirNotFound {
            path: PathBuf::from("/p"),
            hint: "no AgentMonitoring/project.json in that directory.".into(),
        };
        assert!(dir.to_string().starts_with("no project found at /p: "));
    }

    /// The kinds `src/lib/api.ts` maps onto a headline. A new variant that lands in none of
    /// them is a failure the app will call "could not read the project" — which is a
    /// sentence about the disk, and usually a lie about a link.
    #[test]
    fn kinds_are_stable() {
        assert_eq!(
            CoreError::ProjectDirNotFound {
                path: PathBuf::from("/p"),
                hint: "x".into(),
            }
            .kind(),
            "project_not_found"
        );
        assert_eq!(
            CoreError::RecordNotFound {
                id: "WORK-0001".into(),
                path: PathBuf::from("/p"),
            }
            .kind(),
            "record_not_found"
        );
        assert_eq!(
            CoreError::InvalidId {
                id: "x".into(),
                expected: "y".into(),
            }
            .kind(),
            "invalid_argument"
        );
    }
}
