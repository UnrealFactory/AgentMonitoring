//! App feedback: what agents wish this app did, and where it failed them.
//!
//! An agent that hits friction *while using AgentMonitoring* has no good place to say so —
//! a project's bug board is for the project's own code, and a note is scoped to one repo.
//! So feedback about the app is **machine-level, like the registry**: one folder of
//! `FB-NNNN.md` files beside `registry.json`, writable from any working directory with no
//! project resolution at all. The human reads the board in the app and works through it;
//! items are marked done rather than deleted, so "what was asked for" stays evidence.
//!
//! The write rules are the project store's, at smaller scale: ids allocated under the
//! directory's lock, files created with `create_new`, updates rewritten atomically.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::fsx::{self, ProjectLock};
use crate::model::{FeedbackItem, FeedbackKind, FeedbackStatus};
use crate::registry::Registry;
use crate::store::{next_id, validate_id};
use crate::{body, time};

/// `~/.AgentMonitoring/feedback` — beside the registry, honoring the same
/// `AGENTMON_REGISTRY_DIR` override, so anything that sandboxes one sandboxes both.
pub fn feedback_dir() -> Option<PathBuf> {
    Registry::dir().map(|d| d.join("feedback"))
}

fn require_feedback_dir() -> Result<PathBuf> {
    feedback_dir().ok_or_else(|| {
        CoreError::conflict(
            "no home directory to keep app feedback in",
            "set USERPROFILE (Windows) or HOME, or AGENTMON_REGISTRY_DIR",
        )
    })
}

pub fn parse_feedback_kind(value: &str) -> Result<FeedbackKind> {
    match value.trim().to_ascii_lowercase().as_str() {
        "bug" => Ok(FeedbackKind::Bug),
        "idea" | "suggestion" | "wish" => Ok(FeedbackKind::Idea),
        _ => Err(CoreError::InvalidValue {
            what: "--type".to_string(),
            value: value.trim().to_string(),
            expected: "one of: bug, idea".to_string(),
        }),
    }
}

pub fn parse_feedback_status(value: &str) -> Result<FeedbackStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "open" => Ok(FeedbackStatus::Open),
        "done" => Ok(FeedbackStatus::Done),
        _ => Err(CoreError::InvalidValue {
            what: "--status".to_string(),
            value: value.trim().to_string(),
            expected: "one of: open, done".to_string(),
        }),
    }
}

#[derive(Debug, Clone)]
pub struct NewFeedback {
    pub kind: FeedbackKind,
    pub title: String,
    /// May be empty — a title can carry a whole wish.
    pub body: String,
    pub agent: String,
    pub at: Option<String>,
}

/// File one item. Works from anywhere: no project, no `--dir`.
pub fn add_feedback(req: &NewFeedback) -> Result<FeedbackItem> {
    add_feedback_in(&require_feedback_dir()?, req)
}

/// [`add_feedback`] against an explicit folder — the testable core, free of the
/// process-global environment the default path reads.
pub fn add_feedback_in(dir: &Path, req: &NewFeedback) -> Result<FeedbackItem> {
    let title = req.title.trim();
    if title.is_empty() {
        return Err(CoreError::conflict(
            "feedback title is empty",
            "pass --title \"<one specific line>\"",
        ));
    }
    let agent = req.agent.trim();
    if agent.is_empty() {
        return Err(CoreError::conflict(
            "no agent named for this feedback",
            "pass --agent <name> (or set AGENTMON_AGENT)",
        ));
    }
    let created = time::stamp(req.at.as_deref(), "--at")?;

    fs::create_dir_all(dir).map_err(|e| CoreError::io(dir, e))?;
    let _lock = ProjectLock::acquire(dir)?;

    let ids: Vec<String> = list_files(dir)?
        .iter()
        .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
        .collect();
    let item = FeedbackItem {
        id: next_id(&ids, "FB"),
        title: title.to_string(),
        kind: req.kind,
        agent: agent.to_string(),
        status: FeedbackStatus::Open,
        created,
        done: None,
        body: req.body.trim().to_string(),
    };
    let path = dir.join(format!("{}.md", item.id));
    if !fsx::write_new(&path, &render(&item))? {
        // The number was allocated under the lock, so an existing file is foreign junk.
        return Err(CoreError::conflict(
            format!("{} already exists", path.display()),
            "a file that was not written by agentmon holds this id — move it out of the \
             feedback folder",
        ));
    }
    Ok(item)
}

/// Every item, open first, newest first within each status.
pub fn list_feedback() -> Result<Vec<FeedbackItem>> {
    let Some(dir) = feedback_dir() else {
        return Ok(Vec::new());
    };
    list_feedback_in(&dir)
}

/// [`list_feedback`] against an explicit folder. A folder that does not exist yet is an
/// empty board, not an error.
pub fn list_feedback_in(dir: &Path) -> Result<Vec<FeedbackItem>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for path in list_files(dir)? {
        out.push(parse(&path)?);
    }
    out.sort_by(|a, b| {
        let open = |s: FeedbackStatus| s == FeedbackStatus::Done; // false (open) sorts first
        open(a.status)
            .cmp(&open(b.status))
            .then_with(|| b.created.cmp(&a.created))
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(out)
}

pub fn view_feedback(id: &str) -> Result<FeedbackItem> {
    view_feedback_in(&require_feedback_dir()?, id)
}

pub fn view_feedback_in(dir: &Path, id: &str) -> Result<FeedbackItem> {
    let id = validate_id(id, "FB")?;
    let path = dir.join(format!("{id}.md"));
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    parse(&path)
}

/// The human working the board: mark handled, or put it back.
pub fn set_feedback_status(id: &str, status: FeedbackStatus) -> Result<FeedbackItem> {
    set_feedback_status_in(&require_feedback_dir()?, id, status)
}

pub fn set_feedback_status_in(dir: &Path, id: &str, status: FeedbackStatus) -> Result<FeedbackItem> {
    let id = validate_id(id, "FB")?;
    let path = dir.join(format!("{id}.md"));
    // Before the lock: an id that is not there (or a board that does not exist yet) is
    // "not found", not a failed attempt to create a lock file in a missing folder.
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    let _lock = ProjectLock::acquire(dir)?;
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    let mut item = parse(&path)?;
    if item.status == status {
        return Err(CoreError::conflict(
            format!("{id} is already {}", status.as_str()),
            "nothing to change",
        ));
    }
    item.status = status;
    item.done = match status {
        FeedbackStatus::Done => Some(crate::now_iso8601()),
        FeedbackStatus::Open => None,
    };
    fsx::write_atomic(&path, &render(&item))?;
    Ok(item)
}

/// Delete a **done** item for good — clearing a worked board.
///
/// Only `done` items delete: an open item vanishing would be a complaint nobody read,
/// so the path is always done-then-delete (with reopen as the undo between the steps).
/// The verb is in the app *and* the CLI on purpose — the owner delegates the cleanup
/// ("work the feedback list, then clear it") to agents — and the done-first rule is
/// what keeps that delegation honest.
pub fn delete_feedback(id: &str) -> Result<FeedbackItem> {
    delete_feedback_in(&require_feedback_dir()?, id)
}

pub fn delete_feedback_in(dir: &Path, id: &str) -> Result<FeedbackItem> {
    let id = validate_id(id, "FB")?;
    let path = dir.join(format!("{id}.md"));
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    let _lock = ProjectLock::acquire(dir)?;
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    let item = parse(&path)?;
    if item.status != FeedbackStatus::Done {
        return Err(CoreError::conflict(
            format!("{id} is still open"),
            "an open item deleted is a complaint nobody read — mark it done first, then \
             delete it",
        ));
    }
    fs::remove_file(&path).map_err(|e| CoreError::io(&path, e))?;
    Ok(item)
}

fn render(item: &FeedbackItem) -> String {
    let body = item.body.trim();
    if body.is_empty() {
        format!("---\n{}---\n", item.to_frontmatter())
    } else {
        format!("---\n{}---\n\n{}\n", item.to_frontmatter(), body)
    }
}

fn parse(path: &std::path::Path) -> Result<FeedbackItem> {
    let raw = fs::read_to_string(path).map_err(|e| CoreError::io(path, e))?;
    let (fm, body_text) = body::split_frontmatter(&raw).ok_or_else(|| {
        CoreError::malformed(
            path,
            "missing YAML frontmatter — a feedback item must start with a `---` fenced block",
        )
    })?;
    let mut item: FeedbackItem = serde_yaml::from_str(fm)
        .map_err(|e| CoreError::malformed(path, format!("invalid frontmatter: {e}")))?;
    item.body = body_text.trim().to_string();
    Ok(item)
}

fn list_files(dir: &std::path::Path) -> Result<Vec<PathBuf>> {
    let mut out: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| CoreError::io(dir, e))? {
        let entry = entry.map_err(|e| CoreError::io(dir, e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_file() && name.starts_with("FB-") && name.ends_with(".md") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch board folder. Explicit-dir functions only: the env-reading wrappers are
    /// one line each, and the registry tests already mutate `AGENTMON_REGISTRY_DIR`
    /// process-wide — racing them from a parallel test thread is how this test first
    /// failed.
    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-feedback-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn add(dir: &Path, kind: FeedbackKind, title: &str, body: &str, at: &str) -> FeedbackItem {
        add_feedback_in(
            dir,
            &NewFeedback {
                kind,
                title: title.into(),
                body: body.into(),
                agent: "feedback-tester".into(),
                at: Some(at.into()),
            },
        )
        .unwrap()
    }

    #[test]
    fn lifecycle_files_sorts_and_disposes() {
        let dir = tmp("lifecycle");

        // File two items; ids allocate in sequence, empty body is legal.
        let a = add(&dir, FeedbackKind::Bug, "status double-counts abandoned work", "repro: …", "2026-08-20T10:00:00Z");
        let b = add(&dir, FeedbackKind::Idea, "note list should filter by tag", "", "2026-08-20T11:00:00Z");
        assert_eq!((a.id.as_str(), b.id.as_str()), ("FB-0001", "FB-0002"));

        // The file round-trips, body and empty-body both.
        let back = view_feedback_in(&dir, "fb-0001").unwrap();
        assert_eq!(back.title, a.title);
        assert_eq!(back.body, "repro: …");
        assert_eq!(view_feedback_in(&dir, "FB-0002").unwrap().body, "");

        // List: open first, newest first.
        let ids = |v: &[FeedbackItem]| v.iter().map(|f| f.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&list_feedback_in(&dir).unwrap()), ["FB-0002", "FB-0001"]);

        // The human marks one done: it sinks below open items and remembers when.
        let done = set_feedback_status_in(&dir, "FB-0002", FeedbackStatus::Done).unwrap();
        assert!(done.done.is_some());
        assert_eq!(ids(&list_feedback_in(&dir).unwrap()), ["FB-0001", "FB-0002"]);
        // Same state twice is a refused no-op, like closing a closed work log.
        assert!(set_feedback_status_in(&dir, "FB-0002", FeedbackStatus::Done).is_err());
        // Reopen clears the timestamp.
        assert!(set_feedback_status_in(&dir, "FB-0002", FeedbackStatus::Open).unwrap().done.is_none());

        // Refusals name the problem: empty title, unknown id, bad id shape.
        assert!(add_feedback_in(
            &dir,
            &NewFeedback {
                kind: FeedbackKind::Bug,
                title: "  ".into(),
                body: "x".into(),
                agent: "t".into(),
                at: None,
            }
        )
        .is_err());
        assert!(matches!(
            view_feedback_in(&dir, "FB-9999"),
            Err(CoreError::RecordNotFound { .. })
        ));
        assert!(view_feedback_in(&dir, "WORK-0001").is_err());
        // A board that does not exist yet: an empty list, and a clean not-found.
        let missing = dir.join("never-created");
        assert!(list_feedback_in(&missing).unwrap().is_empty());
        assert!(matches!(
            set_feedback_status_in(&missing, "FB-0001", FeedbackStatus::Done),
            Err(CoreError::RecordNotFound { .. })
        ));

        // Delete: refused while open (with the way forward named), allowed once done,
        // and the file is really gone.
        let err = delete_feedback_in(&dir, "FB-0001").unwrap_err();
        assert!(err.to_string().contains("mark it done first"), "{err}");
        set_feedback_status_in(&dir, "FB-0001", FeedbackStatus::Done).unwrap();
        let deleted = delete_feedback_in(&dir, "fb-0001").unwrap();
        assert_eq!(deleted.id, "FB-0001");
        assert!(!dir.join("FB-0001.md").exists());
        assert!(matches!(
            delete_feedback_in(&dir, "FB-0001"),
            Err(CoreError::RecordNotFound { .. })
        ));
        assert_eq!(ids(&list_feedback_in(&dir).unwrap()), ["FB-0002"]);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn kind_and_status_parse_their_words() {
        assert_eq!(parse_feedback_kind("Bug").unwrap(), FeedbackKind::Bug);
        assert_eq!(parse_feedback_kind("suggestion").unwrap(), FeedbackKind::Idea);
        assert!(parse_feedback_kind("feature").is_err());
        assert_eq!(parse_feedback_status("done").unwrap(), FeedbackStatus::Done);
        assert!(parse_feedback_status("closed").is_err());
    }
}
