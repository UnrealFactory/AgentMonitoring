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
use crate::{body, human, time};

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
    /// The human area. Required (SPEC.md, "The human area"): the board's whole audience
    /// is the owner, so an item that speaks only to agents speaks to nobody.
    pub human: String,
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
    // The same title rule the other three kinds use, and for the same reason: the title is
    // one YAML scalar on one frontmatter line, so a line break in it is not a formatting
    // choice. This kind was the one that let one through — YAML quoting kept the file
    // readable, but the board then drew a title whose second line was `## For humans`,
    // which is exactly the confusion the reserved heading exists to prevent.
    let title = crate::write::require_title(&req.title, "feedback item")?;
    let agent = req.agent.trim();
    if agent.is_empty() {
        return Err(CoreError::conflict(
            "no agent named for this feedback",
            "pass --agent <name> (or set AGENTMON_AGENT)",
        ));
    }
    human::check_agent_text(&req.body, "--body")?;
    let human = human::require(&req.human, "this app feedback")?;
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
        updated: None,
        body: req.body.trim().to_string(),
        human: Some(human),
    };
    let path = dir.join(format!("{}.md", item.id));
    if !fsx::write_new(&path, &render(&item)?)? {
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

/// Rewrite an item's human area — `agentmon app-feedback update`.
///
/// The verb exists for exactly this: the board has no other update, and an item filed
/// before the human area existed (or one whose retelling turned out to be wrong) needs a
/// way to gain a good one. Nothing else about the item changes, and there is no event feed
/// here to append to — feedback is machine-level and belongs to no project.
pub fn set_feedback_human(id: &str, agent: &str, human: &str, at: Option<&str>) -> Result<FeedbackItem> {
    set_feedback_human_in(&require_feedback_dir()?, id, agent, human, at)
}

pub fn set_feedback_human_in(
    dir: &Path,
    id: &str,
    agent: &str,
    human: &str,
    at: Option<&str>,
) -> Result<FeedbackItem> {
    let id = validate_id(id, "FB")?;
    if agent.trim().is_empty() {
        return Err(CoreError::conflict(
            "no agent named for this rewrite",
            "pass --agent <name> (or set AGENTMON_AGENT)",
        ));
    }
    let text = human::require(human, &id)?;
    let path = dir.join(format!("{id}.md"));
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    let _lock = ProjectLock::acquire(dir)?;
    if !path.exists() {
        return Err(CoreError::RecordNotFound { id, path });
    }
    let mut item = parse(&path)?;
    // Backdating rules apply to a refresh too: an item cannot be retold before it was
    // filed, nor before the last time it was retold.
    let ts = time::stamp(at, "--at")?;
    time::require_at_or_after(&ts, "--at", &item.created, "the item's created time")?;
    if let Some(previous) = item.updated.clone() {
        time::require_at_or_after(&ts, "--at", &previous, "the item's last rewrite")?;
    }
    item.human = Some(text);
    // The board has no events.jsonl to carry the time, so the frontmatter carries it. It
    // used to carry it nowhere: `--at` was checked and then dropped.
    item.updated = Some(ts);
    fsx::write_atomic(&path, &render(&item)?)?;
    Ok(item)
}

/// The human working the board: mark handled, or put it back.
///
/// **The one mutation that does not demand a human area** (SPEC.md, "The human area"): it
/// takes no `--agent` and no arguments because it is the owner's own button in the app,
/// and the person clicking Done has no retelling to write and nowhere to type one. So an
/// item filed before the human area existed can be worked and cleared without gaining one
/// — deliberately; `app-feedback update <FB-ID> --agent <name> --human …` is how it gains
/// one. Every *authored* mutation of a feedback item ([`add_feedback_in`],
/// [`set_feedback_human_in`]) still requires it.
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
    fsx::write_atomic(&path, &render(&item)?)?;
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

/// Frontmatter, then the agent's prose, then the reserved human section last — the same
/// layout every other record kind uses, so one parser reads them all.
///
/// Fallible for one reason: [`human::compose`] reads the body it just rendered back and
/// refuses to return one whose `## For humans` section has been swallowed by an unclosed
/// code fence in the item's prose. An item that cannot hold its human area is not written.
fn render(item: &FeedbackItem) -> Result<String> {
    let head = format!("---\n{}---\n", item.to_frontmatter());
    let body = item.body.trim();
    match item.human.as_deref().and_then(human::visible) {
        Some(h) => Ok(format!("{head}\n{}", human::compose(body, h, &item.id)?)),
        // Only reachable for an item that has none on disk yet: `add_feedback` requires
        // one, and `set_feedback_human` has just set it.
        None if body.is_empty() => Ok(head),
        None => Ok(format!("{head}\n{body}\n")),
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
    let (body_text, human) = human::split(body_text);
    item.body = body_text.trim().to_string();
    item.human = human;
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
                human: "Something about the app itself, written out for the person who has \
                        to read this board."
                    .into(),
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

        // The file round-trips, body and empty-body both — and the human area is stored
        // as the reserved last section rather than inside the agent's prose.
        let back = view_feedback_in(&dir, "fb-0001").unwrap();
        assert_eq!(back.title, a.title);
        assert_eq!(back.body, "repro: …");
        assert!(back.human.as_deref().unwrap().starts_with("Something about the app"));
        let raw = fs::read_to_string(dir.join("FB-0001.md")).unwrap();
        assert!(raw.contains("## For humans"), "{raw}");
        assert!(!back.body.contains("## For humans"), "{}", back.body);
        // An item whose only prose is the human area is still legal (body may be empty).
        let empty_body = view_feedback_in(&dir, "FB-0002").unwrap();
        assert_eq!(empty_body.body, "");
        assert!(empty_body.human.is_some());

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
                human: "A perfectly good retelling attached to an item with no title.".into(),
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

    /// SPEC.md: `app-feedback add` requires a human area, and `app-feedback update` is the
    /// one verb that can rewrite it afterwards — the board's whole audience is the owner.
    #[test]
    fn the_human_area_is_required_and_rewritable() {
        let dir = tmp("human");
        let file = |title: &str, human: &str| {
            add_feedback_in(
                &dir,
                &NewFeedback {
                    kind: FeedbackKind::Idea,
                    title: title.into(),
                    body: "".into(),
                    human: human.into(),
                    agent: "feedback-tester".into(),
                    at: Some("2026-08-20T10:00:00Z".into()),
                },
            )
        };

        // Missing, blank and placeholder are all refused, with the teaching text.
        for bad in ["", "   ", "TODO"] {
            let err = file("no retelling", bad).unwrap_err();
            assert_eq!(err.kind(), "invalid_argument", "{err}");
            assert!(err.to_string().contains("--human"), "{err}");
            assert!(err.to_string().contains("agentmon human-style"), "{err}");
        }
        // The reserved heading cannot arrive through --body.
        let reserved = add_feedback_in(
            &dir,
            &NewFeedback {
                kind: FeedbackKind::Bug,
                title: "reserved".into(),
                body: "## For humans\n\nsmuggled in".into(),
                human: "A real retelling, next to a body that tried to write the section.".into(),
                agent: "t".into(),
                at: None,
            },
        )
        .unwrap_err();
        assert!(reserved.to_string().contains("reserved"), "{reserved}");
        // …and neither can a body that ends inside a code fence, which would swallow the
        // `## For humans` section appended after it and file an item with no human area.
        let open_fence = add_feedback_in(
            &dir,
            &NewFeedback {
                kind: FeedbackKind::Bug,
                title: "the log I pasted".into(),
                body: "It printed:\n\n```\nError: ENOENT\n".into(),
                human: "A real retelling, next to a body that never closes its code block."
                    .into(),
                agent: "t".into(),
                at: None,
            },
        )
        .unwrap_err();
        assert!(open_fence.to_string().contains("code fence"), "{open_fence}");
        assert!(open_fence.to_string().contains("--body"), "{open_fence}");
        // …nor through the title, which is the one door this kind left open. A title is one
        // YAML scalar on one line; with a newline in it the board drew a title whose second
        // line was the reserved heading, over an item that had a real human area elsewhere.
        let two_line = file("Sneaky\n---\n\n## For humans\n\nNot the retelling.", "A real \
                             retelling, next to a title that tried to be a whole document.")
            .unwrap_err();
        assert!(two_line.to_string().contains("line break"), "{two_line}");
        assert!(file(&"x".repeat(161), "A real retelling, next to a title that runs on.")
            .unwrap_err()
            .to_string()
            .contains("160"));
        assert!(
            list_feedback_in(&dir).unwrap().is_empty(),
            "no id was burned by either refusal"
        );

        let item = file("a wish with a retelling", "The board cannot be filtered, so I have \
                                                    to read every line to find mine.")
        .unwrap();
        assert!(item.human.is_some());

        // Update rewrites only the human area, and refuses a blank one.
        assert!(set_feedback_human_in(&dir, &item.id, "t", "  ", None).is_err());
        let rewritten = set_feedback_human_in(
            &dir,
            &item.id,
            "second-agent",
            "Rewritten: the board has no filter, so finding one item means reading all of them.",
            Some("2026-08-21T10:00:00Z"),
        )
        .unwrap();
        assert!(rewritten.human.as_deref().unwrap().starts_with("Rewritten:"));
        assert_eq!(rewritten.title, item.title, "nothing else moved");
        assert_eq!(rewritten.agent, "feedback-tester", "the filer stays the author");
        // …and `--at` is *kept*. The board has no events.jsonl, so without the `updated`
        // key the timestamp an agent passed was checked against `created` and then
        // dropped — recorded nowhere, against SPEC.md's backdating rule.
        assert_eq!(rewritten.updated.as_deref(), Some("2026-08-21T10:00:00Z"));
        assert!(item.updated.is_none(), "a freshly filed item has not been rewritten");
        assert_eq!(
            view_feedback_in(&dir, &item.id).unwrap().updated.as_deref(),
            Some("2026-08-21T10:00:00Z"),
            "and it survives the round trip through the file",
        );
        // Backdating rules hold: a retelling cannot predate the filing…
        assert!(
            set_feedback_human_in(&dir, &item.id, "t", "Too early to be true.", Some("2026-01-01T00:00:00Z"))
                .is_err()
        );
        // …nor the last rewrite, now that there is a record of when that was.
        assert!(
            set_feedback_human_in(&dir, &item.id, "t", "Before the last rewrite.", Some("2026-08-20T18:00:00Z"))
                .is_err()
        );
        assert!(matches!(
            set_feedback_human_in(&dir, "FB-9999", "t", "No such item to retell.", None),
            Err(CoreError::RecordNotFound { .. })
        ));
        fs::remove_dir_all(&dir).ok();
    }

    /// The documented exception, pinned so it stays a decision rather than an oversight.
    ///
    /// `done` / `reopen` / `delete` take no author and no arguments — they are the owner's
    /// buttons on the feedback board — so an item filed before the human area existed can
    /// be worked and cleared without one (SPEC.md, "The human area"). What they must not
    /// do is *lose* a human area that is there, or invent one that is not.
    #[test]
    fn the_flagless_status_flips_neither_demand_nor_disturb_a_human_area() {
        let dir = tmp("status-flip");

        // An item as the board held them before the human area existed.
        fs::write(
            dir.join("FB-0009.md"),
            "---\nid: FB-0009\ntitle: An item filed before the human area\ntype: idea\n\
             agent: old-builder\nstatus: open\ncreated: 2026-08-01T09:00:00Z\ndone: null\n\
             ---\n\nThe wish itself, as an agent wrote it.\n",
        )
        .unwrap();
        assert!(view_feedback_in(&dir, "FB-0009").unwrap().human.is_none());

        let done = set_feedback_status_in(&dir, "FB-0009", FeedbackStatus::Done).unwrap();
        assert_eq!(done.status, FeedbackStatus::Done);
        assert!(done.human.is_none(), "none was invented");
        assert!(set_feedback_status_in(&dir, "FB-0009", FeedbackStatus::Open).is_ok());
        // …and `app-feedback update` is the way it gains one, after which the flips keep it.
        let named = set_feedback_human_in(
            &dir,
            "FB-0009",
            "cli-builder",
            "Someone asked for this before we started writing these in plain words; here is \
             what they wanted and why it matters.",
            Some("2026-08-21T09:00:00Z"),
        )
        .unwrap();
        assert!(named.human.is_some());
        let done_again = set_feedback_status_in(&dir, "FB-0009", FeedbackStatus::Done).unwrap();
        assert_eq!(done_again.human, named.human, "the flip does not drop it");
        let raw = fs::read_to_string(dir.join("FB-0009.md")).unwrap();
        assert_eq!(raw.matches("## For humans").count(), 1, "{raw}");

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
