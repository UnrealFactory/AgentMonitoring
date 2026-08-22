//! The write half of a project: every mutation the `agentmon` CLI performs.
//!
//! Invariants this module holds, in the order they matter:
//!
//! 1. **A mutation either happens completely or not at all.** The record file is written
//!    temp-then-rename, and the `events.jsonl` line is appended after the record landed —
//!    so the worst crash leaves a record with no event, never an event with no record.
//! 2. **Ids are allocated under a per-project lock** and created with `create_new`, so two
//!    agents starting work at the same moment get `WORK-0007` and `WORK-0008`, never the
//!    same number.
//! 3. **Nothing is overwritten blind.** Every update re-reads the record inside the lock,
//!    checks the state transition is legal, and preserves frontmatter keys and body
//!    sections this build does not know about.
//! 4. **Every mutation returns the record re-parsed from disk**, so a caller printing the
//!    result is printing what a reader will actually see.
//! 5. **Every mutation can be backdated.** Agents write the record after doing the work,
//!    so each entry point takes an optional timestamp; it lands in the frontmatter *and*
//!    in the event, and [`crate::time`] refuses one that is in the future or out of order
//!    with the state it follows.

use std::fs;
use std::path::{Path, PathBuf};

use crate::body;
use crate::error::{CoreError, Result};
use crate::fsx::{self, ProjectLock};
use crate::human;
use crate::model::*;
use crate::time;
use crate::validate::{self, BUG_SECTIONS, WORK_SECTIONS};
use crate::store::{
    next_id, normalize, slugify_note_name, validate_id, validate_note_name, Store, DATA_DIR,
};

/// Frontmatter keys this build owns; anything else in a record is carried across a write.
const WORK_KEYS: &[&str] = &[
    "id", "title", "agent", "status", "started", "finished", "tags", "refs", "files",
];
const BUG_KEYS: &[&str] = &[
    "id",
    "title",
    "reporter",
    "assignee",
    "severity",
    "status",
    "labels",
    "created",
    "claimed",
    "resolved",
    "resolved_by",
    "resolvedBy",
    "refs",
];
const NOTE_KEYS: &[&str] = &[
    "name",
    "title",
    "type",
    "description",
    "agent",
    "updated_by",
    "updatedBy",
    "created",
    "updated",
    "tags",
    "refs",
];

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct NewProject {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub actor: String,
    /// `--at`: when the project was created. `None` means now.
    pub at: Option<String>,
}

/// Fields to change on an existing project. `None` leaves the stored value alone, so a
/// caller can backfill a description without touching the name.
#[derive(Debug, Clone, Default)]
pub struct UpdateProject {
    pub name: Option<String>,
    pub description: Option<String>,
    /// Replaces the tag list (it is a set, not a log).
    pub tags: Option<Vec<String>>,
    pub actor: String,
    pub at: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct StartWork {
    pub agent: String,
    pub title: String,
    pub tags: Vec<String>,
    pub refs: Vec<String>,
    /// Raw markdown; must contain `## What`, `## Why`, `## How`.
    pub body: String,
    /// The human area (SPEC.md, "The human area") — required on every record that is
    /// created or closed. Empty is refused, and the refusal teaches the style contract.
    pub human: String,
    /// `--started-at`: when the work actually began. `None` means now.
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct FinishWork {
    pub agent: String,
    pub outcome: String,
    /// The human area, rewritten: closing changed the story, so the ending replaces
    /// whatever the record said while it was open.
    pub human: String,
    pub files: Vec<String>,
    pub refs: Vec<String>,
    /// `--finished-at`: when the work actually ended. `None` means now.
    pub finished_at: Option<String>,
    /// `--started-at`: corrects the recorded start, for work logged after the fact.
    /// `None` leaves whatever `work start` recorded.
    pub started_at: Option<String>,
}

/// Stopping work without finishing it: status `abandoned`, and the reason on the record.
#[derive(Debug, Clone, Default)]
pub struct AbandonWork {
    pub agent: String,
    /// Why it stopped, and what a reader should do instead. Appended under `## Updates`.
    pub reason: String,
    /// The human area, rewritten: stopping is an ending too.
    pub human: String,
    pub at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewBug {
    pub agent: String,
    pub title: String,
    pub severity: Severity,
    pub labels: Vec<String>,
    pub refs: Vec<String>,
    /// Raw markdown; `## Report` is added around plain prose.
    pub body: String,
    /// The human area — required when the bug is filed.
    pub human: String,
    /// `--created-at`: when the bug was found. `None` means now.
    pub created_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewNote {
    pub agent: String,
    /// Explicit name; `None` derives one from the title (ascii titles only).
    pub name: Option<String>,
    pub title: String,
    pub note_type: NoteType,
    pub description: String,
    pub tags: Vec<String>,
    pub refs: Vec<String>,
    /// Free-form markdown — a note has no mandated sections.
    pub body: String,
    /// The human area — required when the note is created.
    pub human: String,
    /// `--at`: when the note was written. `None` means now.
    pub at: Option<String>,
}

/// Fields to change on an existing note. `None` leaves the stored value alone; notes are
/// living documents, so `body` **replaces** the body (append history belongs in work logs).
#[derive(Debug, Clone, Default)]
pub struct UpdateNote {
    pub agent: String,
    pub title: Option<String>,
    pub note_type: Option<NoteType>,
    pub description: Option<String>,
    /// Replaces the tag list (it is a set, not a log).
    pub tags: Option<Vec<String>>,
    /// Replaces the refs list.
    pub refs: Option<Vec<String>>,
    pub body: Option<String>,
    /// Replaces the human area. Required when `body` is given (the retelling of a note
    /// whose knowledge just changed is stale by definition) and on the first touch of a
    /// note that has none; on its own it is a refresh, which logs `human_updated`.
    pub human: Option<String>,
    pub at: Option<String>,
}

/// What a mutation produced: the id, where it landed, the event that was logged, and the
/// record re-read from disk.
///
/// This is the exact shape `--json` prints, so it is a contract: `ok` mirrors the
/// `{"ok": false, "error": {...}}` envelope the CLI prints on failure, and `record` is
/// nested rather than flattened so no key can collide with `id` or `path`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Written<T> {
    pub ok: bool,
    pub id: String,
    pub path: String,
    pub event: Event,
    pub record: T,
}

impl<T> Written<T> {
    fn new(id: String, path: &Path, event: Event, record: T) -> Written<T> {
        Written {
            ok: true,
            id,
            path: path.display().to_string(),
            event,
            record,
        }
    }
}

/// What a note was, immediately before [`Store::remove_note`] took it off disk.
///
/// Like [`Deleted`], this cannot answer with the record re-read from disk (invariant 4
/// above) — the file is gone, and that is the point — so it answers with the state read a
/// moment earlier, plus the `note_removed` event, which *does* survive: removing a note is
/// itself something that happened, and the feed says who did it and when.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedNote {
    pub ok: bool,
    pub name: String,
    /// The file that was removed.
    pub path: String,
    pub event: Event,
    /// The note as it was just before removal.
    pub record: Note,
}

/// What a project was, immediately before [`Store::delete_project`] removed it.
///
/// Every other mutation answers with the record re-read from disk (invariant 4 at the head
/// of this module). This one cannot: the folder it would read is gone, and that is the
/// point. So it answers with the account taken a moment earlier — the name the window puts
/// in its "deleted" line, the directory that is no longer there, and the counts, which are
/// the only record left of how much went with it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deleted {
    pub ok: bool,
    pub id: String,
    pub name: String,
    /// The directory that was removed, as it resolved on this machine.
    pub path: String,
    pub counts: ProjectCounts,
    /// Who the caller recorded as doing it. Empty from this crate: there is no event log
    /// left to append to — the file that held one was inside the directory — so the actor
    /// is filled in by the shell that has one and is written to *its* log, not here.
    pub deleted_by: String,
}

// ---------------------------------------------------------------------------
// event types (SPEC.md, events.jsonl)
// ---------------------------------------------------------------------------

pub const EV_PROJECT_CREATED: &str = "project_created";
/// Not in the original SPEC event list; added with `agentmon project update` so metadata
/// backfilled after the fact still shows up in the activity feed (SPEC.md, events.jsonl).
pub const EV_PROJECT_UPDATED: &str = "project_updated";
pub const EV_WORK_STARTED: &str = "work_started";
pub const EV_WORK_UPDATED: &str = "work_updated";
pub const EV_WORK_DONE: &str = "work_done";
pub const EV_WORK_ABANDONED: &str = "work_abandoned";
pub const EV_BUG_CREATED: &str = "bug_created";
pub const EV_BUG_CLAIMED: &str = "bug_claimed";
pub const EV_BUG_COMMENTED: &str = "bug_commented";
pub const EV_BUG_RESOLVED: &str = "bug_resolved";
pub const EV_NOTE_CREATED: &str = "note_created";
pub const EV_NOTE_UPDATED: &str = "note_updated";
/// Notes are knowledge, not history: a wrong note misleads every agent that reads it, so
/// agents may remove one — and the removal is itself an event, which is the audit trail.
pub const EV_NOTE_REMOVED: &str = "note_removed";
/// A mutation that changed **only** the human area (SPEC.md, "The human area": a refresh
/// never writes into `## Updates`/`## Comments`). When the human area changes as part of a
/// real mutation, that mutation's own event covers it — this line exists so a refresh is
/// not silent, and so it is not mistaken for a progress note that never happened.
pub const EV_HUMAN_UPDATED: &str = "human_updated";

/// Where the project data goes for a location the human picked: the location itself when
/// it already *is* the data folder, otherwise its `AgentMonitoring` child.
pub fn data_dir_for(location: &Path) -> PathBuf {
    if location.file_name().map(|n| n == DATA_DIR).unwrap_or(false) {
        location.to_path_buf()
    } else {
        location.join(DATA_DIR)
    }
}

/// A project id nobody has to type: unique per machine by construction (nanoseconds), and
/// stable for the life of the folder. Routes and the registry key on it.
fn new_project_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("prj-{nanos:x}")
}

impl Store {
    // -- project ------------------------------------------------------------

    /// Create a project: an `AgentMonitoring` folder inside `location`, holding
    /// `project.json`, `worklogs/`, `bugs/` and the `project_created` event.
    ///
    /// Refuses to touch a folder that already holds a `project.json` — re-running `init`
    /// on a live project must never reset it.
    pub fn init(location: &Path, req: &NewProject) -> Result<Store> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(CoreError::conflict(
                "project name is empty",
                "pass --name \"<display name>\", e.g. --name \"Checkout rewrite\"",
            ));
        }
        let dir = data_dir_for(location);
        let created_at = time::stamp(req.at.as_deref(), "--at")?;
        let project = serde_json::json!({
            "version": crate::SCHEMA_VERSION,
            "id": new_project_id(),
            "name": name,
            "description": req.description.trim(),
            "tags": clean_list(&req.tags),
            "createdAt": created_at,
        });
        let json = format!("{}\n", serde_json::to_string_pretty(&project).unwrap());

        fs::create_dir_all(dir.join("worklogs")).map_err(|e| CoreError::io(&dir, e))?;
        fs::create_dir_all(dir.join("bugs")).map_err(|e| CoreError::io(&dir, e))?;
        fs::create_dir_all(dir.join("notes")).map_err(|e| CoreError::io(&dir, e))?;
        if !fsx::write_new(&dir.join("project.json"), &json)? {
            return Err(CoreError::conflict(
                format!("{} already holds a project", dir.display()),
                "use that project (`agentmon status --dir <folder>`), or pick a different \
                 location for the new one",
            ));
        }

        let store = Store::open(&dir)?;
        store.append_event_at(
            &req.actor,
            EV_PROJECT_CREATED,
            None,
            &format!("Created project {name}"),
            &created_at,
        )?;
        Ok(store)
    }

    /// Change the project's display metadata (name, description, tags).
    ///
    /// Exists because the first thing an agent writes about a project is usually wrong by
    /// the second day, and hand-editing `project.json` skips the event log — which is
    /// what the app's activity feed is built from.
    pub fn update_project(&self, req: &UpdateProject) -> Result<Written<Project>> {
        let dir = self.root().to_path_buf();
        let actor = require_agent(&req.actor)?;
        if req.name.is_none() && req.description.is_none() && req.tags.is_none() {
            return Err(CoreError::conflict(
                "nothing to update",
                "pass at least one of --name \"<display name>\", --description \"<one or two \
                 sentences>\" or --tags a,b",
            ));
        }

        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("project.json");
        let raw = fs::read_to_string(&path).map_err(|e| CoreError::io(&path, e))?;
        let mut json: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| CoreError::malformed(&path, format!("invalid project.json: {e}")))?;
        let created_at = json
            .get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let ts = time::stamp(req.at.as_deref(), "--at")?;
        time::require_at_or_after(&ts, "--at", &created_at, "the project's createdAt")?;

        let mut changed: Vec<String> = Vec::new();
        if let Some(name) = &req.name {
            let name = name.trim();
            if name.is_empty() {
                return Err(CoreError::conflict(
                    "--name is empty",
                    "pass the display name the sidebar should show, e.g. --name \"Checkout rewrite\"",
                ));
            }
            if json.get("name").and_then(|v| v.as_str()) != Some(name) {
                changed.push(format!("name to \"{name}\""));
            }
            json["name"] = serde_json::Value::String(name.to_string());
        }
        if let Some(description) = &req.description {
            let description = description.trim();
            if json.get("description").and_then(|v| v.as_str()) != Some(description) {
                changed.push("description".to_string());
            }
            json["description"] = serde_json::Value::String(description.to_string());
        }
        if let Some(tags) = &req.tags {
            let tags = clean_list(tags);
            changed.push(if tags.is_empty() {
                "tags to none".to_string()
            } else {
                format!("tags to {}", tags.join(", "))
            });
            json["tags"] = serde_json::Value::Array(
                tags.into_iter().map(serde_json::Value::String).collect(),
            );
        }
        let text = format!("{}\n", serde_json::to_string_pretty(&json).unwrap());
        fsx::write_atomic(&path, &text)?;

        let record = self.project()?;
        let summary = if changed.is_empty() {
            format!("Re-saved project metadata for {} (no values changed)", record.name)
        } else {
            format!("Updated {}: {}", record.name, changed.join(", "))
        };
        let event = self.append_event_at(&actor, EV_PROJECT_UPDATED, None, &summary, &ts)?;
        Ok(Written::new(record.id.clone(), &dir, event, record))
    }

    /// Remove the project's `AgentMonitoring` folder and everything inside it.
    /// **Permanently.**
    ///
    /// The one destructive operation in this crate, and the only one whose result cannot
    /// be read back off disk afterwards — so what it returns is what was there a moment
    /// before it ran ([`Deleted`]), which is what the window then says out loud.
    ///
    /// **Who may call it.** The desktop app, from a dialog a human typed the project name
    /// into (`delete_project` in src-tauri/src/lib.rs). Deliberately *not* the `agentmon`
    /// CLI and not the MCP server: agents append records, they do not take them away, and
    /// a verb that removes a folder of records is not one to leave lying in the interface
    /// they script against. This function is public because the Tauri shell is a separate
    /// crate, not because it is for general use.
    ///
    /// **Where it may point.** Only at this store's own root, and only when that root —
    /// canonicalised, so a symlink or junction cannot smuggle another directory in — is
    /// really a folder named `AgentMonitoring` with a `project.json` inside. Anything
    /// else is refused rather than followed: the human's code sits *next to* this folder,
    /// and this call must never be able to take the location itself.
    pub fn delete_project(&self) -> Result<Deleted> {
        if !self.root().join("project.json").is_file() {
            // Already gone (a second click, another window) — a missing project, not a
            // second delete.
            return Err(CoreError::ProjectDirNotFound {
                path: self.root().to_path_buf(),
                hint: "the project folder no longer holds a project.json — nothing to delete".into(),
            });
        }
        // Read it before it stops existing: the counts are the only honest account of
        // what this call is about to destroy.
        let project = self.project()?;

        let resolved = normalize(self.root());
        let named_right = resolved
            .file_name()
            .map(|n| n == DATA_DIR)
            .unwrap_or(false);
        if !named_right || !resolved.join("project.json").is_file() {
            return Err(CoreError::conflict(
                format!(
                    "{} is not an {DATA_DIR} project folder",
                    resolved.display()
                ),
                "this deletes only a folder named AgentMonitoring that holds a \
                 project.json; remove anything else yourself",
            ));
        }

        fs::remove_dir_all(&resolved).map_err(|e| CoreError::io(&resolved, e))?;

        Ok(Deleted {
            ok: true,
            id: project.id,
            name: project.name,
            path: resolved.display().to_string(),
            counts: project.counts,
            deleted_by: String::new(),
        })
    }

    // -- work ---------------------------------------------------------------

    pub fn start_work(&self, req: &StartWork) -> Result<Written<WorklogDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(&req.agent)?;
        let title = require_title(&req.title, "work log")?;
        human::check_agent_text(&req.body, "--body/--body-file")?;
        let parsed = validate::work_body(&req.body)?;
        let human_text = human::require(&req.human, "this work log")?;
        let refs = self.normalize_refs(&req.refs)?;

        let started = time::stamp(req.started_at.as_deref(), "--started-at")?;

        let _lock = ProjectLock::acquire(&dir)?;
        let worklogs = dir.join("worklogs");

        // Rendered (and proved readable) once, before any id is taken: a body that cannot
        // carry its human area must fail without burning a WORK number.
        let mut sections = parsed.sections.clone();
        let rendered = human::render_body(&mut sections, &human_text, "this work log")?;

        let mut id = next_id(&record_ids(&worklogs, "WORK")?, "WORK");
        let mut path;
        loop {
            let meta = Worklog {
                id: id.clone(),
                title: title.clone(),
                agent: agent.clone(),
                status: WorkStatus::InProgress,
                started: started.clone(),
                finished: None,
                tags: clean_list(&req.tags),
                refs: refs.clone(),
                files: Vec::new(),
            };
            let text = format!("---\n{}---\n\n{rendered}", meta.to_frontmatter());
            path = worklogs.join(format!("{id}.md"));
            if fsx::write_new(&path, &text)? {
                break;
            }
            // Somebody else owns that number (a stolen stale lock, or a file created
            // outside the CLI). Take the next one rather than clobbering their record.
            id = next_id(&[id], "WORK");
        }

        let event = self.append_event_at(&agent, EV_WORK_STARTED, Some(&id), &title, &started)?;
        let record = self.worklog(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    /// Append a timestamped note to a work log — while it runs, and after it closes.
    ///
    /// A closed record still accepts notes on purpose. Append-only means *nothing already
    /// written is changed*; it does not mean a record can never be corrected. When a
    /// finished work log turns out to state something false, the honest repair is a note
    /// dated when the error was found, sitting inside the record that carries the error,
    /// where its reader is. Refusing that pushed corrections into other records entirely,
    /// and a reader who stopped at the prose never met them.
    ///
    /// What stays fixed: the body above `## Updates` is never rewritten, the note lands at
    /// the end of the timeline, its timestamp must be at or after everything already in the
    /// record (including `finished`, so a note cannot pretend to predate the close), the
    /// status does not change, and the event is still `work_updated`.
    /// `human` alone is a **refresh**: nothing is appended to `## Updates`, only the human
    /// area is rewritten, and the one event logged is `human_updated`. That is how a record
    /// written before the human area existed gains one without inventing a progress note
    /// that never happened.
    pub fn update_work(
        &self,
        id: &str,
        agent: &str,
        message: Option<&str>,
        human_arg: Option<&str>,
        at: Option<&str>,
    ) -> Result<Written<WorklogDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(agent)?;
        if message.is_none() && human_arg.is_none() {
            return Err(CoreError::conflict(
                "nothing to update",
                "pass --message \"<what changed>\" for a progress note, --human \"<text>\" to \
                 rewrite the human area, or both",
            ));
        }
        let note = match message {
            Some(m) => {
                human::check_agent_text(m, "--message/--message-file")?;
                Some(validate::note(
                    m,
                    "work update",
                    "agentmon work update WORK-0003 --agent cli-builder \\\n  \
                     --message \"Lock + temp-file writes are in; two concurrent starts now \
                     produce two ids.\"",
                )?)
            }
            None => None,
        };
        let id = validate_id(id, "WORK")?;
        let supplied_human = match human_arg {
            Some(h) => Some(human::require(h, &id)?),
            None => None,
        };
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, meta, md) = read_work(&path, &id)?;
        let (agent_md, existing_human) = human::split(&md);

        // Ordering rules apply to a refresh too: the human area is part of the record, and
        // a rewrite dated before the record's last activity would be a lie about when.
        require_note_time(&ts, &meta, &agent_md)?;
        let human_text = resolve_human(supplied_human, existing_human, &id)?;

        let mut sections = body::sections(&agent_md);
        if let Some(note) = &note {
            let entry = if agent == meta.agent {
                note.clone()
            } else {
                // Keep the `### <timestamp>` heading exactly as SPEC.md defines it, but do
                // not lose who wrote the note.
                format!("_Update by {agent}._\n\n{note}")
            };
            body::append_entry(&mut sections, "Updates", &ts, &entry, WORK_SECTIONS);
        }
        write_record(&path, &meta.to_frontmatter(), &fm, WORK_KEYS, &mut sections, &human_text)?;

        // One line, never two: a refresh logs `human_updated`, a note logs `work_updated`
        // and carries the human change with it.
        let event = match &note {
            Some(note) => self.append_event_at(
                &agent,
                EV_WORK_UPDATED,
                Some(&id),
                &body::excerpt(note, 160),
                &ts,
            )?,
            None => self.append_event_at(
                &agent,
                EV_HUMAN_UPDATED,
                Some(&id),
                &body::excerpt(&human_text, 160),
                &ts,
            )?,
        };
        let record = self.worklog(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    /// Stop a work log without finishing it: status `abandoned`, `finished` stamped with
    /// the moment it stopped, and the reason appended under `## Updates`.
    ///
    /// The alternative — leaving it `in_progress` forever — is worse: the dashboard shows
    /// an agent still working on something nobody is doing.
    pub fn abandon_work(&self, id: &str, req: &AbandonWork) -> Result<Written<WorklogDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(&req.agent)?;
        human::check_agent_text(&req.reason, "--reason/--reason-file")?;
        let reason = validate::note(
            &req.reason,
            "abandon reason",
            "agentmon work abandon WORK-0003 --agent cli-builder \\\n  \
             --reason \"Superseded by WORK-0007, which solves the same problem in the core \
             crate; nothing from this branch was kept.\"",
        )?;
        let id = validate_id(id, "WORK")?;
        let human_text = human::require(&req.human, &id)?;
        let ts = time::stamp(req.at.as_deref(), "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_work(&path, &id)?;
        let (md, _) = human::split(&md);

        match meta.status {
            WorkStatus::InProgress => {}
            WorkStatus::Done => {
                return Err(CoreError::conflict(
                    format!(
                        "{id} is already done (finished {})",
                        meta.finished.as_deref().unwrap_or("unknown")
                    ),
                    "finished work cannot be abandoned — it happened. If the result was later \
                     thrown away, say so in a new work log that refs this one",
                ))
            }
            WorkStatus::Abandoned => {
                return Err(CoreError::conflict(
                    format!("{id} was already abandoned"),
                    "nothing to do. Start a new work log with `agentmon work start`",
                ))
            }
        }
        require_note_time(&ts, &meta, &md)?;

        meta.status = WorkStatus::Abandoned;
        meta.finished = Some(ts.clone());

        let entry = if agent == meta.agent {
            format!("**Abandoned.** {reason}")
        } else {
            format!("**Abandoned by {agent}.** {reason}")
        };
        let mut sections = body::sections(&md);
        body::append_entry(&mut sections, "Updates", &ts, &entry, WORK_SECTIONS);
        // Closing verbs replace the human area: the ending changed the story.
        write_record(&path, &meta.to_frontmatter(), &fm, WORK_KEYS, &mut sections, &human_text)?;

        let event = self.append_event_at(
            &agent,
            EV_WORK_ABANDONED,
            Some(&id),
            &body::excerpt(&reason, 160),
            &ts,
        )?;
        let record = self.worklog(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn finish_work(&self, id: &str, req: &FinishWork) -> Result<Written<WorklogDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(&req.agent)?;
        human::check_agent_text(&req.outcome, "--outcome/--outcome-file")?;
        let outcome = validate::outcome(&req.outcome)?;
        let extra_refs = self.normalize_refs(&req.refs)?;
        let id = validate_id(id, "WORK")?;
        let human_text = human::require(&req.human, &id)?;
        let finished = time::stamp(req.finished_at.as_deref(), "--finished-at")?;
        let restart = req
            .started_at
            .as_deref()
            .map(|s| time::stamp(Some(s), "--started-at"))
            .transpose()?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_work(&path, &id)?;
        let (md, _) = human::split(&md);

        match meta.status {
            WorkStatus::InProgress => {}
            WorkStatus::Done => {
                return Err(CoreError::conflict(
                    format!(
                        "{id} is already done (finished {})",
                        meta.finished.as_deref().unwrap_or("unknown")
                    ),
                    "nothing to do. To record more work, start a new log with \
                     `agentmon work start`",
                ))
            }
            WorkStatus::Abandoned => {
                return Err(CoreError::conflict(
                    format!("{id} was abandoned and cannot be completed"),
                    "start a new work log with `agentmon work start`",
                ))
            }
        }

        // Order first, write second: a rejected timestamp must leave the record untouched.
        let (first_update, last_update) = update_stamps(&md);
        if let Some(started) = &restart {
            time::require_order(started, "--started-at", &finished, "--finished-at")?;
            time::require_at_or_before(
                started,
                "--started-at",
                &first_update,
                "this record's first progress note",
            )?;
            meta.started = started.clone();
        }
        time::require_at_or_after(&finished, "--finished-at", &meta.started, "started")?;
        time::require_at_or_after(
            &finished,
            "--finished-at",
            &last_update,
            "this record's last progress note",
        )?;

        meta.status = WorkStatus::Done;
        meta.finished = Some(finished.clone());
        meta.files = merge_lists(&meta.files, &clean_list(&req.files));
        meta.refs = merge_lists(&meta.refs, &extra_refs);

        let mut sections = body::sections(&md);
        let outcome_body = if agent == meta.agent {
            outcome.clone()
        } else {
            format!("_Completed by {agent}._\n\n{outcome}")
        };
        body::upsert_section(&mut sections, "Outcome", &outcome_body, WORK_SECTIONS);
        // Closing verbs replace the human area: the ending changed the story.
        write_record(&path, &meta.to_frontmatter(), &fm, WORK_KEYS, &mut sections, &human_text)?;

        let event = self.append_event_at(
            &agent,
            EV_WORK_DONE,
            Some(&id),
            &body::excerpt(&outcome, 160),
            &finished,
        )?;
        let record = self.worklog(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    // -- bugs ---------------------------------------------------------------

    pub fn create_bug(&self, req: &NewBug) -> Result<Written<BugDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(&req.agent)?;
        let title = require_title(&req.title, "bug")?;
        human::check_agent_text(&req.body, "--body/--body-file")?;
        let mut sections = validate::bug_body(&req.body)?;
        let human_text = human::require(&req.human, "this bug")?;
        // Same as `start_work`: prove the human area reads back before an id is taken.
        let rendered = human::render_body(&mut sections, &human_text, "this bug")?;
        let refs = self.normalize_refs(&req.refs)?;

        let created = time::stamp(req.created_at.as_deref(), "--created-at")?;

        let _lock = ProjectLock::acquire(&dir)?;
        let bugs = dir.join("bugs");

        let mut id = next_id(&record_ids(&bugs, "BUG")?, "BUG");
        let mut path;
        loop {
            let meta = Bug {
                id: id.clone(),
                title: title.clone(),
                reporter: agent.clone(),
                assignee: None,
                severity: req.severity,
                status: BugStatus::Open,
                labels: clean_list(&req.labels),
                created: created.clone(),
                claimed: None,
                resolved: None,
                resolved_by: None,
                refs: refs.clone(),
            };
            let text = format!("---\n{}---\n\n{rendered}", meta.to_frontmatter());
            path = bugs.join(format!("{id}.md"));
            if fsx::write_new(&path, &text)? {
                break;
            }
            id = next_id(&[id], "BUG");
        }

        let event = self.append_event_at(&agent, EV_BUG_CREATED, Some(&id), &title, &created)?;
        let record = self.bug(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    /// Claiming writes no prose of its own, so `human` is optional here — but the rule
    /// that no mutation may leave a record without a human area still holds, which is why
    /// the flag exists at all: claiming a bug filed before the human area existed is the
    /// moment that bug gains one.
    pub fn claim_bug(
        &self,
        id: &str,
        agent: &str,
        human_arg: Option<&str>,
        at: Option<&str>,
    ) -> Result<Written<BugDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(agent)?;
        let id = validate_id(id, "BUG")?;
        let supplied_human = match human_arg {
            Some(h) => Some(human::require(h, &id)?),
            None => None,
        };
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_bug(&path, &id)?;
        let (md, existing_human) = human::split(&md);

        match meta.status {
            BugStatus::Open => {}
            BugStatus::InProgress => {
                let holder = meta.assignee.clone().unwrap_or_else(|| "someone".into());
                if holder != agent {
                    return Err(CoreError::conflict(
                        format!("{id} is already claimed by {holder}"),
                        format!(
                            "coordinate instead of taking it over: \
                             `agentmon bug comment {id} --agent {agent} --message \"...\"`"
                        ),
                    ));
                }
                // Same agent re-claiming: harmless, and re-running a script must not fail.
            }
            BugStatus::Resolved | BugStatus::Closed => {
                return Err(CoreError::conflict(
                    format!("{id} is already {}", meta.status.as_str()),
                    format!(
                        "if it is not actually fixed, say so first: \
                         `agentmon bug comment {id} --agent {agent} --message \"...\"`, \
                         then file a new bug"
                    ),
                ))
            }
        }

        time::require_at_or_after(&ts, "--at", &meta.created, "the bug's created time")?;
        let human_text = resolve_human(supplied_human, existing_human, &id)?;

        let already_mine = meta.status == BugStatus::InProgress;
        meta.status = BugStatus::InProgress;
        meta.assignee = Some(agent.clone());
        if meta.claimed.is_none() {
            meta.claimed = Some(ts.clone());
        }
        let mut sections = body::sections(&md);
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &mut sections, &human_text)?;

        let summary = if already_mine {
            format!("Re-confirmed the claim on {id} — {}", meta.title)
        } else {
            format!("Claimed {id} — {}", meta.title)
        };
        let event = self.append_event_at(&agent, EV_BUG_CLAIMED, Some(&id), &summary, &ts)?;
        let record = self.bug(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    /// `human` alone is a **refresh**: no comment is added to the thread, only the human
    /// area changes, and the event is `human_updated`.
    pub fn comment_bug(
        &self,
        id: &str,
        agent: &str,
        message: Option<&str>,
        human_arg: Option<&str>,
        at: Option<&str>,
    ) -> Result<Written<BugDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(agent)?;
        if message.is_none() && human_arg.is_none() {
            return Err(CoreError::conflict(
                "nothing to add",
                "pass --message \"<what you found>\" for the thread, --human \"<text>\" to \
                 rewrite the human area, or both",
            ));
        }
        let note = match message {
            Some(m) => {
                human::check_agent_text(m, "--message/--message-file")?;
                Some(validate::note(
                    m,
                    "bug comment",
                    "agentmon bug comment BUG-0002 --agent cli-builder \\\n  \
                     --message \"Root cause: the watcher was never started, so no change \
                     event was ever emitted.\"",
                )?)
            }
            None => None,
        };
        let id = validate_id(id, "BUG")?;
        let supplied_human = match human_arg {
            Some(h) => Some(human::require(h, &id)?),
            None => None,
        };
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, meta, md) = read_bug(&path, &id)?;
        let (md, existing_human) = human::split(&md);
        time::require_at_or_after(&ts, "--at", &meta.created, "the bug's created time")?;
        time::require_at_or_after(&ts, "--at", &last_comment(&md), "the previous comment")?;
        let human_text = resolve_human(supplied_human, existing_human, &id)?;

        let mut sections = body::sections(&md);
        if let Some(note) = &note {
            body::append_entry(
                &mut sections,
                "Comments",
                &format!("{ts} — {agent}"),
                note,
                BUG_SECTIONS,
            );
        }
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &mut sections, &human_text)?;

        let event = match &note {
            Some(note) => self.append_event_at(
                &agent,
                EV_BUG_COMMENTED,
                Some(&id),
                &body::excerpt(note, 160),
                &ts,
            )?,
            None => self.append_event_at(
                &agent,
                EV_HUMAN_UPDATED,
                Some(&id),
                &body::excerpt(&human_text, 160),
                &ts,
            )?,
        };
        let record = self.bug(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn resolve_bug(
        &self,
        id: &str,
        agent: &str,
        resolution: &str,
        human_arg: &str,
        at: Option<&str>,
    ) -> Result<Written<BugDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(agent)?;
        human::check_agent_text(resolution, "--resolution/--resolution-file")?;
        let text = validate::resolution(resolution)?;
        let id = validate_id(id, "BUG")?;
        let human_text = human::require(human_arg, &id)?;
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_bug(&path, &id)?;
        let (md, _) = human::split(&md);

        match meta.status {
            BugStatus::Open | BugStatus::InProgress => {}
            BugStatus::Resolved => {
                return Err(CoreError::conflict(
                    format!(
                        "{id} was already resolved by {} on {}",
                        meta.resolved_by.as_deref().unwrap_or("someone"),
                        meta.resolved.as_deref().unwrap_or("an earlier date")
                    ),
                    format!(
                        "if it regressed, file a new bug and reference this one: \
                         `agentmon bug create --agent {agent} --title \"...\" \
                         --severity high --refs {id} --body \"...\"`"
                    ),
                ))
            }
            BugStatus::Closed => {
                return Err(CoreError::conflict(
                    format!("{id} is closed"),
                    format!(
                        "file a new bug referencing it: \
                         `agentmon bug create --agent {agent} --refs {id} ...`"
                    ),
                ))
            }
        }

        let floor = time::latest([
            meta.created.as_str(),
            meta.claimed.as_deref().unwrap_or(""),
            last_comment(&md).as_str(),
        ]);
        time::require_at_or_after(&ts, "--at", &floor, "the bug's last recorded activity")?;

        meta.status = BugStatus::Resolved;
        meta.resolved = Some(ts.clone());
        meta.resolved_by = Some(agent.clone());
        if meta.assignee.is_none() {
            // Whoever wrote the fix owns it, even if they never ran `bug claim`.
            meta.assignee = Some(agent.clone());
            meta.claimed.get_or_insert_with(|| ts.clone());
        }

        let mut sections = body::sections(&md);
        body::upsert_section(&mut sections, "Resolution", &text, BUG_SECTIONS);
        // Closing verbs replace the human area: the ending changed the story.
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &mut sections, &human_text)?;

        let event = self.append_event_at(
            &agent,
            EV_BUG_RESOLVED,
            Some(&id),
            &body::excerpt(&text, 160),
            &ts,
        )?;
        let record = self.bug(&id)?;
        Ok(Written::new(id, &path, event, record))
    }

    // -- notes --------------------------------------------------------------
    //
    // Work logs and bugs are history: append-only, never taken back. A note is
    // **knowledge** — the memory, handoff, decision or reference an agent leaves for
    // whoever comes next — and knowledge that has gone wrong misleads every reader, so a
    // note can be rewritten in place and removed. Every one of those moves still lands in
    // events.jsonl, which is where the honesty lives.

    /// Create a note: `notes/<name>.md`. The name is the identity — explicit, or derived
    /// from the title — and creating a name that exists is refused, because the right move
    /// there is `update_note` (one fact, one file), not a duplicate.
    pub fn add_note(&self, req: &NewNote) -> Result<Written<NoteDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(&req.agent)?;
        let title = require_title(&req.title, "note")?;
        let description = validate::note_description(&req.description)?;
        human::check_agent_text(&req.body, "--body/--body-file")?;
        let body_text = validate::note_body(&req.body)?;
        let human_text = human::require(&req.human, "this note")?;
        let name = match &req.name {
            Some(n) => validate_note_name(n)?,
            None => slugify_note_name(&title).ok_or_else(|| {
                CoreError::conflict(
                    format!("cannot derive a note name from the title {title:?}"),
                    "pass --name <kebab-case> explicitly, e.g. --name handoff-p13 — names \
                     are ascii so they work as file names, URLs and refs",
                )
            })?,
        };
        // Drop a self-reference before the existence check runs — the file is not on
        // disk yet, and a note pointing at itself would be noise anyway.
        let refs: Vec<String> = req
            .refs
            .iter()
            .filter(|r| r.trim().to_ascii_lowercase() != name)
            .cloned()
            .collect();
        let refs = self.normalize_refs(&refs)?;
        let ts = time::stamp(req.at.as_deref(), "--at")?;

        let _lock = ProjectLock::acquire(&dir)?;
        let meta = Note {
            name: name.clone(),
            title,
            note_type: req.note_type,
            description,
            agent: agent.clone(),
            updated_by: None,
            created: ts.clone(),
            updated: ts.clone(),
            tags: clean_list(&req.tags),
            refs,
        };
        let text = format!(
            "---\n{}---\n\n{}",
            meta.to_frontmatter(),
            human::compose(&body_text, &human_text, &name)?
        );
        let path = dir.join("notes").join(format!("{name}.md"));
        if !fsx::write_new(&path, &text)? {
            return Err(CoreError::conflict(
                format!("a note named '{name}' already exists in this project"),
                format!(
                    "one fact, one file: read it with `agentmon note view {name}`, change it \
                     with `agentmon note update {name} ...`, or pick a different --name"
                ),
            ));
        }

        let event = self.append_event_at(
            &agent,
            EV_NOTE_CREATED,
            Some(&name),
            &meta.title,
            &ts,
        )?;
        let record = self.note(&name)?;
        Ok(Written::new(name, &path, event, record))
    }

    /// Rewrite parts of a note in place: metadata fields, and/or the whole body.
    ///
    /// Replacing the body is the intended shape — a handoff is *the current state*, not a
    /// diary of past states. The trail of who changed what and when is the event log; the
    /// file holds only what is currently true.
    pub fn update_note(&self, name: &str, req: &UpdateNote) -> Result<Written<NoteDetail>> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(&req.agent)?;
        let name = validate_note_name(name)?;
        if req.title.is_none()
            && req.note_type.is_none()
            && req.description.is_none()
            && req.tags.is_none()
            && req.refs.is_none()
            && req.body.is_none()
            && req.human.is_none()
        {
            return Err(CoreError::conflict(
                "nothing to update",
                "pass at least one of --title, --type, --description, --tags, --refs, \
                 --body/--body-file, --human/--human-file",
            ));
        }
        if let Some(b) = &req.body {
            human::check_agent_text(b, "--body/--body-file")?;
        }
        // A rewritten body is new knowledge, so the retelling of the old knowledge is
        // stale by definition — SPEC.md requires a human area with every `--body`.
        let supplied_human = match (&req.human, &req.body) {
            (Some(h), _) => Some(human::require(h, &name)?),
            (None, Some(_)) => {
                return Err(human::missing(
                    &name,
                    "--body replaces what this note knows, so the human area has to be \
                     rewritten with it",
                ))
            }
            (None, None) => None,
        };
        let ts = time::stamp(req.at.as_deref(), "--at")?;
        let new_refs = match &req.refs {
            Some(refs) => {
                let mut r = self.normalize_refs(refs)?;
                r.retain(|x| x != &name);
                Some(r)
            }
            None => None,
        };

        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("notes").join(format!("{name}.md"));
        let (fm, mut meta, md) = read_note(&path, &name)?;
        let (md, existing_human) = human::split(&md);
        time::require_at_or_after(&ts, "--at", &meta.updated, "the note's last update")?;
        let human_text = resolve_human(supplied_human.clone(), existing_human, &name)?;

        let mut changed: Vec<&str> = Vec::new();
        if let Some(title) = &req.title {
            meta.title = require_title(title, "note")?;
            changed.push("title");
        }
        if let Some(t) = req.note_type {
            if t != meta.note_type {
                changed.push("type");
            }
            meta.note_type = t;
        }
        if let Some(d) = &req.description {
            meta.description = validate::note_description(d)?;
            changed.push("description");
        }
        if let Some(tags) = &req.tags {
            meta.tags = clean_list(tags);
            changed.push("tags");
        }
        if let Some(refs) = new_refs {
            meta.refs = refs;
            changed.push("refs");
        }
        let body_text = match &req.body {
            Some(b) => {
                changed.push("body");
                validate::note_body(b)?
            }
            None => md.trim().to_string(),
        };
        // A refresh is the one shape that changes nothing else: it rewrites the human area
        // and logs `human_updated` instead of pretending the knowledge itself moved.
        let refresh_only = changed.is_empty() && supplied_human.is_some();
        if supplied_human.is_some() && !refresh_only {
            changed.push("human area");
        }
        meta.updated = ts.clone();
        // The note now says what this agent made it say; the author stays who it was.
        meta.updated_by = Some(agent.clone());

        let extra = body::extra_frontmatter(&fm, NOTE_KEYS);
        let text = format!(
            "---\n{}{extra}---\n\n{}",
            meta.to_frontmatter(),
            human::compose(&body_text, &human_text, &name)?
        );
        fsx::write_atomic(&path, &text)?;

        let event = if refresh_only {
            self.append_event_at(
                &agent,
                EV_HUMAN_UPDATED,
                Some(&name),
                &body::excerpt(&human_text, 160),
                &ts,
            )?
        } else {
            let summary = format!("Updated note {name}: {}", changed.join(", "));
            self.append_event_at(&agent, EV_NOTE_UPDATED, Some(&name), &summary, &ts)?
        };
        let record = self.note(&name)?;
        Ok(Written::new(name, &path, event, record))
    }

    /// Take a note off disk — because it is wrong, superseded, or done with (a handoff
    /// that has been fully absorbed). The `note_removed` event stays behind: the feed
    /// still says the note existed, what it was called, who removed it and when.
    ///
    /// This is deliberately *not* how work logs and bugs behave. They are the history of
    /// what happened and no agent may take one away; a note is a claim about the present,
    /// and a stale claim does damage every time it is read.
    pub fn remove_note(&self, name: &str, agent: &str, at: Option<&str>) -> Result<RemovedNote> {
        let dir = self.root().to_path_buf();
        let agent = require_agent(agent)?;
        let name = validate_note_name(name)?;
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("notes").join(format!("{name}.md"));
        let (_fm, meta, _md) = read_note(&path, &name)?;
        time::require_at_or_after(&ts, "--at", &meta.updated, "the note's last update")?;

        fs::remove_file(&path).map_err(|e| CoreError::io(&path, e))?;
        let event = self.append_event_at(
            &agent,
            EV_NOTE_REMOVED,
            Some(&name),
            &format!("Removed note — {}", meta.title),
            &ts,
        )?;
        Ok(RemovedNote {
            ok: true,
            name,
            path: path.display().to_string(),
            event,
            record: meta,
        })
    }

    /// `--refs` values must be resolvable links: a record id by shape (`WORK-NNNN`,
    /// `BUG-NNNN`), or the name of a note that exists in this project right now — so a
    /// typo does not create a dangling link the app renders as a broken reference.
    fn normalize_refs(&self, refs: &[String]) -> Result<Vec<String>> {
        let mut out = Vec::new();
        for r in clean_list(refs) {
            let upper = r.to_ascii_uppercase();
            let id = if upper.starts_with("WORK-") {
                validate_id(&upper, "WORK")?
            } else if upper.starts_with("BUG-") {
                validate_id(&upper, "BUG")?
            } else {
                let name = validate_note_name(&r).map_err(|_| CoreError::InvalidId {
                    id: r.clone(),
                    expected: "WORK-NNNN, BUG-NNNN, or the kebab-case name of a note in \
                               this project"
                        .into(),
                })?;
                if !self.root().join("notes").join(format!("{name}.md")).is_file() {
                    return Err(CoreError::InvalidId {
                        id: r.clone(),
                        expected: format!(
                            "WORK-NNNN, BUG-NNNN, or the name of an existing note — no note \
                             is named '{name}' here (see `agentmon note list`)"
                        ),
                    });
                }
                name
            };
            if !out.contains(&id) {
                out.push(id);
            }
        }
        Ok(out)
    }

    // -- events -------------------------------------------------------------

    /// Append one line to this project's `events.jsonl`, stamped now.
    pub fn append_event(
        &self,
        actor: &str,
        event_type: &str,
        r#ref: Option<&str>,
        summary: &str,
    ) -> Result<Event> {
        self.append_event_at(actor, event_type, r#ref, summary, &crate::now_iso8601())
    }

    /// Append one event carrying an explicit timestamp.
    ///
    /// Backdated mutations use this so the feed and the record agree: an event stamped
    /// "now" for work that finished yesterday would put the record at the top of the
    /// activity timeline and show a duration nobody worked.
    pub fn append_event_at(
        &self,
        actor: &str,
        event_type: &str,
        r#ref: Option<&str>,
        summary: &str,
        ts: &str,
    ) -> Result<Event> {
        let event = Event {
            ts: ts.to_string(),
            actor: actor.trim().to_string(),
            event_type: event_type.to_string(),
            r#ref: r#ref.map(|s| s.to_string()),
            summary: summary.trim().to_string(),
        };
        let line = serde_json::to_string(&event)
            .map_err(|e| CoreError::malformed(self.root(), format!("cannot encode event: {e}")))?;
        fsx::append_line(&self.root().join("events.jsonl"), &line)?;
        Ok(event)
    }
}

// ---------------------------------------------------------------------------
// migrate — the one bridge from schema v1 (the central vault) to v2
// ---------------------------------------------------------------------------

/// Copy one project out of a v1 vault into `<to_location>/AgentMonitoring`.
///
/// Records, events and timestamps are carried over byte-for-byte; only `project.json` is
/// rewritten — `version: 2` added, `slug` and `status` dropped (v2 has neither), the v1
/// `id`, `name`, `description`, `tags` and `createdAt` kept, so links and history read
/// exactly as they did. Refuses if the target already holds a project; the vault itself
/// is left untouched (delete it yourself once `agentmon doctor` passes on the new folder).
pub fn migrate(from_vault: &Path, slug: &str, to_location: &Path) -> Result<Store> {
    // Slugs were validated in v1 exactly this way; re-check so a hostile slug cannot
    // traverse out of the vault.
    let slug_ok = !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if !slug_ok {
        return Err(CoreError::InvalidId {
            id: slug.to_string(),
            expected: "lowercase letters, digits, '-' or '_' (e.g. agent-monitoring)".into(),
        });
    }
    if !from_vault.join("vault.json").is_file() {
        return Err(CoreError::ProjectDirNotFound {
            path: from_vault.to_path_buf(),
            hint: "`--from` must be a v1 vault directory (the folder holding vault.json)".into(),
        });
    }
    let src = from_vault.join("projects").join(slug);
    if !src.join("project.json").is_file() {
        return Err(CoreError::ProjectDirNotFound {
            path: src,
            hint: format!("the vault has no project '{slug}' — check the folder names under projects/"),
        });
    }

    let dest = data_dir_for(to_location);
    if dest.join("project.json").is_file() {
        return Err(CoreError::conflict(
            format!("{} already holds a project", dest.display()),
            "pick a different --to location, or delete that folder first if it was a \
             failed earlier attempt",
        ));
    }

    // project.json: v1 in, v2 out.
    let raw = fs::read_to_string(src.join("project.json"))
        .map_err(|e| CoreError::io(src.join("project.json"), e))?;
    let old: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| CoreError::malformed(src.join("project.json"), format!("invalid project.json: {e}")))?;
    let field = |k: &str| old.get(k).cloned().unwrap_or(serde_json::Value::Null);
    let new = serde_json::json!({
        "version": crate::SCHEMA_VERSION,
        "id": field("id"),
        "name": field("name"),
        "description": field("description"),
        "tags": field("tags"),
        "createdAt": field("createdAt"),
    });
    let json = format!("{}\n", serde_json::to_string_pretty(&new).unwrap());

    fs::create_dir_all(dest.join("worklogs")).map_err(|e| CoreError::io(&dest, e))?;
    fs::create_dir_all(dest.join("bugs")).map_err(|e| CoreError::io(&dest, e))?;
    fs::create_dir_all(dest.join("notes")).map_err(|e| CoreError::io(&dest, e))?;
    for sub in ["worklogs", "bugs"] {
        let from_dir = src.join(sub);
        if !from_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&from_dir).map_err(|e| CoreError::io(&from_dir, e))? {
            let entry = entry.map_err(|e| CoreError::io(&from_dir, e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_file() && name.ends_with(".md") && !name.starts_with('.') {
                fs::copy(entry.path(), dest.join(sub).join(&name))
                    .map_err(|e| CoreError::io(entry.path(), e))?;
            }
        }
    }
    if src.join("events.jsonl").is_file() {
        fs::copy(src.join("events.jsonl"), dest.join("events.jsonl"))
            .map_err(|e| CoreError::io(src.join("events.jsonl"), e))?;
    }
    if !fsx::write_new(&dest.join("project.json"), &json)? {
        return Err(CoreError::conflict(
            format!("{} gained a project.json mid-migration", dest.display()),
            "another process is writing there — re-run against a quiet target",
        ));
    }
    Store::open(&dest)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Ids already taken, read from filenames — no parsing, so a corrupt record still
/// reserves its number instead of being handed out twice.
fn record_ids(dir: &Path, prefix: &str) -> Result<Vec<String>> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| CoreError::io(dir, e))? {
        let entry = entry.map_err(|e| CoreError::io(dir, e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(stem) = name.strip_suffix(".md") {
            if stem.starts_with(prefix) {
                out.push(stem.to_string());
            }
        }
    }
    Ok(out)
}

/// First and last `### <ts>` entry under `## Updates` — the window a new note or an
/// end-of-work timestamp has to fit around. Empty strings when there are no notes yet.
fn update_stamps(md: &str) -> (String, String) {
    let mut secs = body::sections(md);
    let updates = body::take_section(&mut secs, "Updates")
        .map(|s| body::work_updates(&s))
        .unwrap_or_default();
    let first = updates.first().map(|u| u.ts.clone()).unwrap_or_default();
    let last = time::latest(updates.iter().map(|u| u.ts.as_str()));
    (first, last)
}

/// Timestamp of the newest comment on a bug, or an empty string.
fn last_comment(md: &str) -> String {
    let mut secs = body::sections(md);
    let comments = body::take_section(&mut secs, "Comments")
        .map(|s| body::bug_comments(&s))
        .unwrap_or_default();
    time::latest(comments.iter().map(|c| c.ts.as_str()))
}

/// A note appended to a work log has to sit after the start and after every note already
/// there, or the rendered timeline reads backwards.
///
/// On a record that has closed, it also has to sit at or after `finished`: a correction is
/// something learned later, and a note stamped before the close would draw itself inside a
/// run that had already ended.
fn require_note_time(ts: &str, meta: &Worklog, md: &str) -> Result<()> {
    time::require_at_or_after(ts, "--at", &meta.started, "the work log's started time")?;
    time::require_at_or_after(ts, "--at", &update_stamps(md).1, "the previous note")?;
    match &meta.finished {
        Some(f) if meta.status != WorkStatus::InProgress => {
            time::require_at_or_after(ts, "--at", f, "the time this work log closed")
        }
        _ => Ok(()),
    }
}

fn read_work(path: &Path, id: &str) -> Result<(String, Worklog, String)> {
    let raw = read_record(path, id)?;
    let (fm, md) = body::split_frontmatter(&raw).ok_or_else(|| {
        CoreError::malformed(
            path,
            "missing YAML frontmatter — refusing to write over a file that is not a work log",
        )
    })?;
    let meta: Worklog = serde_yaml::from_str(fm)
        .map_err(|e| CoreError::malformed(path, format!("invalid worklog frontmatter: {e}")))?;
    Ok((fm.to_string(), meta, md.to_string()))
}

fn read_bug(path: &Path, id: &str) -> Result<(String, Bug, String)> {
    let raw = read_record(path, id)?;
    let (fm, md) = body::split_frontmatter(&raw).ok_or_else(|| {
        CoreError::malformed(
            path,
            "missing YAML frontmatter — refusing to write over a file that is not a bug",
        )
    })?;
    let meta: Bug = serde_yaml::from_str(fm)
        .map_err(|e| CoreError::malformed(path, format!("invalid bug frontmatter: {e}")))?;
    Ok((fm.to_string(), meta, md.to_string()))
}

fn read_note(path: &Path, name: &str) -> Result<(String, Note, String)> {
    let raw = read_record(path, name)?;
    let (fm, md) = body::split_frontmatter(&raw).ok_or_else(|| {
        CoreError::malformed(
            path,
            "missing YAML frontmatter — refusing to write over a file that is not a note",
        )
    })?;
    let meta: Note = serde_yaml::from_str(fm)
        .map_err(|e| CoreError::malformed(path, format!("invalid note frontmatter: {e}")))?;
    Ok((fm.to_string(), meta, md.to_string()))
}

fn read_record(path: &Path, id: &str) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CoreError::RecordNotFound {
            id: id.to_string(),
            path: path.to_path_buf(),
        }),
        Err(e) => Err(CoreError::io(path, e)),
    }
}

/// Frontmatter (canonical keys + anything unknown carried across) plus rendered body,
/// written atomically.
///
/// The human area is attached **here**, not by the callers, so the one function that puts
/// a work log or a bug on disk is also the one that proves the record can be read back with
/// its human area intact ([`human::render_body`]). A caller cannot forget the check, and a
/// record whose agent area would swallow the reserved section is refused before the
/// temp-file write starts — invariant 1 at the head of this module, applied to the half of
/// the record a human reads.
fn write_record(
    path: &Path,
    frontmatter: &str,
    original_frontmatter: &str,
    known_keys: &[&str],
    sections: &mut Vec<Section>,
    human: &str,
) -> Result<()> {
    let subject = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());
    let rendered = human::render_body(sections, human, &subject)?;
    let extra = body::extra_frontmatter(original_frontmatter, known_keys);
    let text = format!("---\n{frontmatter}{extra}---\n\n{rendered}");
    fsx::write_atomic(path, &text)
}

/// The human area a mutation writes: the one it was given, else the one already on the
/// record — and a refusal when there is neither.
///
/// This is the whole "legacy gains it on first touch" rule of SPEC.md in four lines. A
/// record written before the human area existed reads fine forever; the moment an agent
/// *changes* it, the change comes with a retelling, because otherwise the record would be
/// edited by an agent that had a chance to speak to the human and declined.
fn resolve_human(
    supplied: Option<String>,
    existing: Option<String>,
    subject: &str,
) -> Result<String> {
    match (supplied, existing) {
        (Some(new), _) => Ok(new),
        (None, Some(old)) => Ok(old),
        (None, None) => Err(human::missing(
            subject,
            "this record has none yet, and a mutation that touches it has to leave one",
        )),
    }
}

fn require_agent(agent: &str) -> Result<String> {
    let a = agent.trim();
    if a.is_empty() {
        return Err(CoreError::conflict(
            "--agent is empty",
            "pass the name you want to appear in the record, e.g. --agent cli-builder",
        ));
    }
    if a.len() > 64 {
        return Err(CoreError::conflict(
            "--agent is longer than 64 characters",
            "use a short stable handle, e.g. --agent cli-builder",
        ));
    }
    // Same reason as `require_title`: this lands as one YAML scalar on one line.
    if a.contains(['\n', '\r']) {
        return Err(CoreError::conflict(
            "--agent contains a line break",
            "use a short stable handle on one line, e.g. --agent cli-builder",
        ));
    }
    Ok(a.to_string())
}

pub(crate) fn require_title(title: &str, kind: &str) -> Result<String> {
    let t = title.trim();
    if t.is_empty() {
        return Err(CoreError::conflict(
            format!("--title is empty, and a {kind} without a title is unreadable in a list"),
            "pass a specific title, e.g. --title \"Wire the change watcher into the desktop app\"",
        ));
    }
    // A title is one YAML scalar on one frontmatter line, so a line break in it is not a
    // formatting choice — it is a second frontmatter line. The record was written anyway,
    // its event appended, and only then did reading it back fail (exit 6): a file no
    // parser accepts, an event pointing at it, and `work list` failing for the whole
    // project. With the right newline the record's first section became `## For humans`
    // holding agent prose, which is the one thing the reserved heading exists to prevent.
    if t.contains(['\n', '\r']) {
        return Err(CoreError::conflict(
            format!("--title for this {kind} contains a line break, and a title is one line"),
            "keep the title to a single line and put the rest in the body \
             (--body / --body-file)",
        ));
    }
    if t.chars().count() > 160 {
        return Err(CoreError::conflict(
            format!("--title is {} characters; the limit is 160", t.chars().count()),
            "put the detail in the body (## What / ## Why / ## How) and keep the title to one line",
        ));
    }
    Ok(t.to_string())
}

/// Trim, drop empties, keep order, drop duplicates.
fn clean_list(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values {
        let v = v.trim();
        if !v.is_empty() && !out.iter().any(|x| x == v) {
            out.push(v.to_string());
        }
    }
    out
}

fn merge_lists(existing: &[String], extra: &[String]) -> Vec<String> {
    let mut out = clean_list(existing);
    for v in clean_list(extra) {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

fn bad_value(what: &str, value: &str, expected: &str) -> CoreError {
    CoreError::InvalidValue {
        what: what.to_string(),
        value: value.trim().to_string(),
        expected: expected.to_string(),
    }
}

/// Parse a severity from the CLI, listing the alternatives on failure.
pub fn parse_severity(value: &str) -> Result<Severity> {
    match value.trim().to_ascii_lowercase().as_str() {
        "critical" => Ok(Severity::Critical),
        "high" => Ok(Severity::High),
        "medium" | "med" => Ok(Severity::Medium),
        "low" => Ok(Severity::Low),
        _ => Err(bad_value(
            "--severity",
            value,
            "one of: critical, high, medium, low",
        )),
    }
}

/// Parse a note type from the CLI, saying when to use each on failure — the choice *is*
/// the hard part of the flag.
pub fn parse_note_type(value: &str) -> Result<NoteType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "essential" | "required" => Ok(NoteType::Essential),
        "memory" => Ok(NoteType::Memory),
        "handoff" => Ok(NoteType::Handoff),
        "decision" => Ok(NoteType::Decision),
        "reference" | "ref" => Ok(NoteType::Reference),
        _ => Err(bad_value(
            "--type",
            value,
            "one of: essential (required reading at session start — the index), memory \
             (a durable fact or gotcha), handoff (state for whoever works next), decision \
             (a choice and its reasoning), reference (a pointer to something outside the \
             project)",
        )),
    }
}

/// Parse a work status filter.
pub fn parse_work_status(value: &str) -> Result<WorkStatus> {
    match value.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "in_progress" | "inprogress" | "open" | "active" => Ok(WorkStatus::InProgress),
        "done" | "finished" | "complete" => Ok(WorkStatus::Done),
        "abandoned" => Ok(WorkStatus::Abandoned),
        _ => Err(bad_value(
            "--status",
            value,
            "one of: in_progress, done, abandoned",
        )),
    }
}

/// Parse a bug status filter.
pub fn parse_bug_status(value: &str) -> Result<BugStatus> {
    match value.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "open" => Ok(BugStatus::Open),
        "in_progress" | "inprogress" | "claimed" => Ok(BugStatus::InProgress),
        "resolved" | "fixed" => Ok(BugStatus::Resolved),
        "closed" => Ok(BugStatus::Closed),
        _ => Err(bad_value(
            "--status",
            value,
            "one of: open, in_progress, resolved, closed",
        )),
    }
}

/// A `PathBuf` for the record a `Written` refers to, for callers that want to re-read it.
pub fn record_path(store: &Store, id: &str) -> PathBuf {
    if id.starts_with("BUG") {
        store.root().join("bugs").join(format!("{id}.md"))
    } else {
        store.root().join("worklogs").join(format!("{id}.md"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_location(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "agentmon-write-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn init_puts_the_project_in_an_agentmonitoring_child_and_never_resets_one() {
        let location = tmp_location("init");
        let store = Store::init(
            &location,
            &NewProject {
                name: "Demo".into(),
                description: "A demo project".into(),
                tags: vec!["demo".into()],
                actor: "test-agent".into(),
                at: None,
            },
        )
        .expect("init creates the project");
        assert_eq!(store.root(), location.join(DATA_DIR).as_path());
        let p = store.project().expect("project.json parses");
        assert_eq!(p.version, crate::SCHEMA_VERSION);
        assert_eq!(p.name, "Demo");
        assert!(p.id.starts_with("prj-"), "{}", p.id);
        assert_eq!(p.counts.events, 1, "project_created is on the feed");

        let again = Store::init(
            &location,
            &NewProject {
                name: "Demo 2".into(),
                actor: "test-agent".into(),
                ..Default::default()
            },
        );
        assert!(again.is_err(), "init never resets a live project");
        fs::remove_dir_all(&location).ok();
    }

    #[test]
    fn a_full_record_round_trip_in_the_new_layout() {
        let location = tmp_location("roundtrip");
        let store = Store::init(
            &location,
            &NewProject {
                name: "Roundtrip".into(),
                actor: "tester".into(),
                ..Default::default()
            },
        )
        .unwrap();

        let started = store
            .start_work(&StartWork {
                agent: "tester".into(),
                title: "Prove the writes work without a vault".into(),
                body: "## What\nA record for the round-trip test.\n## Why\nBecause the layout changed.\n## How\nBy writing it through the CLI path.".into(),
                human: "We checked that saving a record still works now that each project \
                        keeps its own folder.".into(),
                ..Default::default()
            })
            .expect("work start");
        assert_eq!(started.id, "WORK-0001");

        store
            .update_work(
                &started.id,
                "tester",
                Some("Halfway there and nothing is on fire."),
                None,
                None,
            )
            .expect("work update");
        let done = store
            .finish_work(
                &started.id,
                &FinishWork {
                    agent: "tester".into(),
                    outcome: "Shipped; verified by this very test.".into(),
                    human: "It works: a record written this way comes back out the same.".into(),
                    files: vec!["crates/agentmon-core/src/write.rs".into()],
                    ..Default::default()
                },
            )
            .expect("work done");
        assert_eq!(done.record.meta.status, WorkStatus::Done);

        let bug = store
            .create_bug(&NewBug {
                agent: "tester".into(),
                title: "The demo bug".into(),
                severity: Severity::Low,
                labels: vec![],
                refs: vec![started.id.clone()],
                body: "## Report\nRepro: run the test. Expected: pass. Actual: pass.".into(),
                human: "A pretend problem, filed so we can watch the whole life of a bug \
                        report."
                    .into(),
                created_at: None,
            })
            .expect("bug create");
        store
            .claim_bug(&bug.id, "tester", None, None)
            .expect("bug claim");
        store
            .resolve_bug(
                &bug.id,
                "tester",
                "Fixed by existing; verified by assertion.",
                "There was nothing really wrong, and the test says so.",
                None,
            )
            .expect("bug resolve");

        let p = store.project().unwrap();
        assert_eq!(p.counts.work_done, 1);
        assert_eq!(p.counts.bugs_total, 1);
        assert_eq!(p.counts.bugs_open, 0);
        // project_created + start + update + done + bug create/claim/resolve = 7
        assert_eq!(p.counts.events, 7);
        fs::remove_dir_all(&location).ok();
    }

    #[test]
    fn delete_takes_only_a_folder_named_agentmonitoring() {
        let location = tmp_location("delete");
        let store = Store::init(
            &location,
            &NewProject {
                name: "Doomed".into(),
                actor: "tester".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let deleted = store.delete_project().expect("delete removes the data folder");
        assert_eq!(deleted.name, "Doomed");
        assert!(!location.join(DATA_DIR).exists(), "the data folder is gone");
        assert!(location.exists(), "the location the human picked is untouched");
        fs::remove_dir_all(&location).ok();
    }

    #[test]
    fn migrate_carries_a_v1_project_forward_untouched() {
        // Build a tiny v1 vault by hand — the shape SPEC v1 defined.
        let base = tmp_location("migrate");
        let vault = base.join("vault");
        let src = vault.join("projects").join("demo");
        fs::create_dir_all(src.join("worklogs")).unwrap();
        fs::create_dir_all(src.join("bugs")).unwrap();
        fs::write(vault.join("vault.json"), r#"{ "version": 1, "name": "Old vault" }"#).unwrap();
        fs::write(
            src.join("project.json"),
            r#"{ "id": "prj-demo", "slug": "demo", "name": "Demo", "description": "d", "status": "active", "tags": ["t"], "createdAt": "2026-08-01T00:00:00Z" }"#,
        )
        .unwrap();
        let work = "---\nid: WORK-0001\ntitle: Old work\nagent: a\nstatus: done\nstarted: 2026-08-01T01:00:00Z\nfinished: 2026-08-01T02:00:00Z\ntags: []\nrefs: []\nfiles: []\n---\n\n## What\nx\n\n## Why\ny\n\n## How\nz\n\n## Outcome\ndone\n";
        fs::write(src.join("worklogs").join("WORK-0001.md"), work).unwrap();
        fs::write(
            src.join("events.jsonl"),
            "{\"ts\":\"2026-08-01T01:00:00Z\",\"actor\":\"a\",\"type\":\"work_started\",\"ref\":\"WORK-0001\",\"summary\":\"Old work\"}\n",
        )
        .unwrap();

        let dest = base.join("repo");
        fs::create_dir_all(&dest).unwrap();
        let store = migrate(&vault, "demo", &dest).expect("migrate succeeds");
        let p = store.project().expect("migrated project parses as v2");
        assert_eq!(p.version, crate::SCHEMA_VERSION);
        assert_eq!(p.id, "prj-demo", "identity survives the move");
        assert_eq!(p.name, "Demo");
        assert_eq!(p.counts.work_total, 1);
        assert_eq!(p.counts.events, 1);
        let detail = store.worklog("WORK-0001").expect("record carried over");
        assert_eq!(detail.meta.started, "2026-08-01T01:00:00Z", "timestamps untouched");

        assert!(migrate(&vault, "demo", &dest).is_err(), "refuses a second run onto the same target");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn essential_notes_parse_and_open_every_list() {
        assert_eq!(parse_note_type("essential").unwrap(), NoteType::Essential);
        assert_eq!(parse_note_type("required").unwrap(), NoteType::Essential, "the natural synonym lands");

        let location = tmp_location("essential");
        let store = Store::init(
            &location,
            &NewProject { name: "Demo".into(), actor: "t".into(), ..Default::default() },
        )
        .unwrap();
        let note = |name: &str, ty: NoteType, at: &str| NewNote {
            agent: "t".into(),
            name: Some(name.into()),
            title: format!("{name} title"),
            note_type: ty,
            description: "one line".into(),
            tags: vec![],
            refs: vec![],
            body: "a body long enough to pass validation".into(),
            human: "A short note in plain words, so this fixture is a legal record.".into(),
            at: Some(at.into()),
        };
        // The essential note is the OLDEST write; recency alone would bury it.
        store.add_note(&note("start-here", NoteType::Essential, "2026-08-01T00:00:00Z")).unwrap();
        store.add_note(&note("fresh-memory", NoteType::Memory, "2026-08-02T00:00:00Z")).unwrap();
        store.add_note(&note("fresh-handoff", NoteType::Handoff, "2026-08-03T00:00:00Z")).unwrap();
        let names: Vec<String> =
            store.notes().unwrap().into_iter().map(|n| n.meta.name).collect();
        assert_eq!(
            names,
            ["start-here", "fresh-handoff", "fresh-memory"],
            "essential first, then the rest by recency"
        );
        fs::remove_dir_all(&location).ok();
    }
}
