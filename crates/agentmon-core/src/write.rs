//! The write half of the vault: every mutation the `agentmon` CLI performs.
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
use crate::model::*;
use crate::time;
use crate::validate::{self, BUG_SECTIONS, WORK_SECTIONS};
use crate::vault::{next_id, validate_id, validate_slug, Vault};

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

// ---------------------------------------------------------------------------
// inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct NewProject {
    pub slug: String,
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
    /// Archive or bring back: the one piece of project state a human, not an agent, sets.
    /// Archiving hides a project from the app's default view; it deletes nothing.
    pub status: Option<ProjectStatus>,
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
    /// `--started-at`: when the work actually began. `None` means now.
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct FinishWork {
    pub agent: String,
    pub outcome: String,
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
    /// `--created-at`: when the bug was found. `None` means now.
    pub created_at: Option<String>,
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

impl Vault {
    // -- vault --------------------------------------------------------------

    /// Create a vault at `root` (creating the directory if needed).
    ///
    /// Refuses to touch a directory that already holds a `vault.json` — re-running `init`
    /// on a live vault must never reset it.
    pub fn init(root: &Path, name: &str) -> Result<Vault> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::conflict(
                "vault name is empty",
                "pass --name \"<vault name>\", e.g. --name \"AgentMonitoring\"",
            ));
        }
        if root.join("vault.json").is_file() {
            return Err(CoreError::conflict(
                format!("{} already contains a vault.json", root.display()),
                "use that vault (`agentmon project list --vault <dir>`), or pick an empty \
                 directory for the new one",
            ));
        }
        fs::create_dir_all(root.join("projects")).map_err(|e| CoreError::io(root, e))?;
        let info = serde_json::json!({
            "version": crate::SCHEMA_VERSION,
            "name": name,
            "createdAt": crate::now_iso8601(),
        });
        let json = format!("{}\n", serde_json::to_string_pretty(&info).unwrap());
        if !fsx::write_new(&root.join("vault.json"), &json)? {
            return Err(CoreError::conflict(
                format!("{} already contains a vault.json", root.display()),
                "another process created it just now — nothing to do",
            ));
        }
        Vault::open(root)
    }

    // -- projects -----------------------------------------------------------

    pub fn create_project(&self, req: &NewProject) -> Result<Written<Project>> {
        let slug = validate_slug(&req.slug)?.to_string();
        let name = req.name.trim();
        if name.is_empty() {
            return Err(CoreError::conflict(
                "project name is empty",
                "pass --name \"<display name>\", e.g. --name \"AgentMonitoring\"",
            ));
        }
        let dir = self.projects_dir().join(&slug);
        let created_at = time::stamp(req.at.as_deref(), "--at")?;
        let project = serde_json::json!({
            "id": format!("prj-{slug}"),
            "slug": slug,
            "name": name,
            "description": req.description.trim(),
            "status": "active",
            "tags": req.tags,
            "createdAt": created_at,
        });
        let json = format!("{}\n", serde_json::to_string_pretty(&project).unwrap());

        fs::create_dir_all(dir.join("worklogs")).map_err(|e| CoreError::io(&dir, e))?;
        fs::create_dir_all(dir.join("bugs")).map_err(|e| CoreError::io(&dir, e))?;
        if !fsx::write_new(&dir.join("project.json"), &json)? {
            return Err(CoreError::conflict(
                format!("project '{slug}' already exists in {}", self.root().display()),
                "pick another slug, or use the existing project \
                 (`agentmon status -p <slug>`)",
            ));
        }

        let event = self.append_event_at(
            &slug,
            &req.actor,
            EV_PROJECT_CREATED,
            Some(&slug),
            &format!("Created project {slug} — {name}"),
            &created_at,
        )?;
        let record = self.project(&slug)?;
        Ok(Written::new(slug, &dir, event, record))
    }

    /// Change a project's display metadata (name, description, tags).
    ///
    /// Exists because the first thing an agent writes about a project is usually wrong by
    /// the second day, and hand-editing `project.json` skips the event log — which is
    /// what the app's activity feed is built from.
    pub fn update_project(&self, slug: &str, req: &UpdateProject) -> Result<Written<Project>> {
        let dir = self.project_dir(slug)?;
        let slug = validate_slug(slug)?.to_string();
        let actor = require_agent(&req.actor)?;
        if req.name.is_none()
            && req.description.is_none()
            && req.tags.is_none()
            && req.status.is_none()
        {
            return Err(CoreError::conflict(
                "nothing to update",
                "pass at least one of --name \"<display name>\", --description \"<one or two \
                 sentences>\", --tags a,b or --status active|archived",
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
        if let Some(status) = req.status {
            let text = match status {
                ProjectStatus::Active => "active",
                ProjectStatus::Archived => "archived",
            };
            if json.get("status").and_then(|v| v.as_str()).unwrap_or("active") != text {
                changed.push(format!(
                    "{} the project",
                    if status == ProjectStatus::Archived {
                        "archived"
                    } else {
                        "restored"
                    }
                ));
            }
            json["status"] = serde_json::Value::String(text.to_string());
        }
        let text = format!("{}\n", serde_json::to_string_pretty(&json).unwrap());
        fsx::write_atomic(&path, &text)?;

        let summary = if changed.is_empty() {
            format!("Re-saved project metadata for {slug} (no values changed)")
        } else {
            format!("Updated {slug}: {}", changed.join(", "))
        };
        let event =
            self.append_event_at(&slug, &actor, EV_PROJECT_UPDATED, Some(&slug), &summary, &ts)?;
        let record = self.project(&slug)?;
        Ok(Written::new(slug, &dir, event, record))
    }

    // -- work ---------------------------------------------------------------

    pub fn start_work(&self, slug: &str, req: &StartWork) -> Result<Written<WorklogDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(&req.agent)?;
        let title = require_title(&req.title, "work log")?;
        let parsed = validate::work_body(&req.body)?;
        let refs = normalize_refs(&req.refs)?;

        let started = time::stamp(req.started_at.as_deref(), "--started-at")?;

        let _lock = ProjectLock::acquire(&dir)?;
        let worklogs = dir.join("worklogs");

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
            let text = format!(
                "---\n{}---\n\n{}",
                meta.to_frontmatter(),
                body::render(&parsed.sections)
            );
            path = worklogs.join(format!("{id}.md"));
            if fsx::write_new(&path, &text)? {
                break;
            }
            // Somebody else owns that number (a stolen stale lock, or a file created
            // outside the CLI). Take the next one rather than clobbering their record.
            id = next_id(&[id], "WORK");
        }

        let event = self.append_event_at(
            slug,
            &agent,
            EV_WORK_STARTED,
            Some(&id),
            &title,
            &started,
        )?;
        let record = self.worklog(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    /// Append a timestamped note to a work log — while it runs, and after it closes.
    ///
    /// A closed record still accepts notes on purpose. Append-only means *nothing already
    /// written is changed*; it does not mean a record can never be corrected. When a
    /// finished work log turns out to state something false (WORK-0011 said relay had ten
    /// agents; it has four — BUG-0017, BUG-0018), the honest repair is a note dated when the
    /// error was found, sitting inside the record that carries the error, where its reader
    /// is. Refusing that pushed corrections into other records entirely, and a reader who
    /// stopped at the prose never met them.
    ///
    /// What stays fixed: the body above `## Updates` is never rewritten, the note lands at
    /// the end of the timeline, its timestamp must be at or after everything already in the
    /// record (including `finished`, so a note cannot pretend to predate the close), the
    /// status does not change, and the event is still `work_updated`.
    pub fn update_work(
        &self,
        slug: &str,
        id: &str,
        agent: &str,
        message: &str,
        at: Option<&str>,
    ) -> Result<Written<WorklogDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(agent)?;
        let note = validate::note(
            message,
            "work update",
            "agentmon work update WORK-0003 -p agent-monitoring --agent cli-builder \\\n  \
             --message \"Lock + temp-file writes are in; two concurrent starts now produce \
             two ids.\"",
        )?;
        let id = validate_id(id, "WORK")?;
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, meta, md) = read_work(&path, &id, slug)?;

        require_note_time(&ts, &meta, &md)?;

        let entry = if agent == meta.agent {
            note.clone()
        } else {
            // Keep the `### <timestamp>` heading exactly as SPEC.md defines it, but do not
            // lose who wrote the note.
            format!("_Update by {agent}._\n\n{note}")
        };
        let mut sections = body::sections(&md);
        body::append_entry(&mut sections, "Updates", &ts, &entry, WORK_SECTIONS);
        write_record(&path, &meta.to_frontmatter(), &fm, WORK_KEYS, &sections)?;

        let event = self.append_event_at(
            slug,
            &agent,
            EV_WORK_UPDATED,
            Some(&id),
            &body::excerpt(&note, 160),
            &ts,
        )?;
        let record = self.worklog(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    /// Stop a work log without finishing it: status `abandoned`, `finished` stamped with
    /// the moment it stopped, and the reason appended under `## Updates`.
    ///
    /// The alternative — leaving it `in_progress` forever — is worse: the dashboard shows
    /// an agent still working on something nobody is doing.
    pub fn abandon_work(
        &self,
        slug: &str,
        id: &str,
        req: &AbandonWork,
    ) -> Result<Written<WorklogDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(&req.agent)?;
        let reason = validate::note(
            &req.reason,
            "abandon reason",
            "agentmon work abandon WORK-0003 -p agent-monitoring --agent cli-builder \\\n  \
             --reason \"Superseded by WORK-0007, which solves the same problem in the core \
             crate; nothing from this branch was kept.\"",
        )?;
        let id = validate_id(id, "WORK")?;
        let ts = time::stamp(req.at.as_deref(), "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_work(&path, &id, slug)?;

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
        write_record(&path, &meta.to_frontmatter(), &fm, WORK_KEYS, &sections)?;

        let event = self.append_event_at(
            slug,
            &agent,
            EV_WORK_ABANDONED,
            Some(&id),
            &body::excerpt(&reason, 160),
            &ts,
        )?;
        let record = self.worklog(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn finish_work(
        &self,
        slug: &str,
        id: &str,
        req: &FinishWork,
    ) -> Result<Written<WorklogDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(&req.agent)?;
        let outcome = validate::outcome(&req.outcome)?;
        let extra_refs = normalize_refs(&req.refs)?;
        let id = validate_id(id, "WORK")?;
        let finished = time::stamp(req.finished_at.as_deref(), "--finished-at")?;
        let restart = req
            .started_at
            .as_deref()
            .map(|s| time::stamp(Some(s), "--started-at"))
            .transpose()?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_work(&path, &id, slug)?;

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
        write_record(&path, &meta.to_frontmatter(), &fm, WORK_KEYS, &sections)?;

        let event = self.append_event_at(
            slug,
            &agent,
            EV_WORK_DONE,
            Some(&id),
            &body::excerpt(&outcome, 160),
            &finished,
        )?;
        let record = self.worklog(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    // -- bugs ---------------------------------------------------------------

    pub fn create_bug(&self, slug: &str, req: &NewBug) -> Result<Written<BugDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(&req.agent)?;
        let title = require_title(&req.title, "bug")?;
        let sections = validate::bug_body(&req.body)?;
        let refs = normalize_refs(&req.refs)?;

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
            let text = format!(
                "---\n{}---\n\n{}",
                meta.to_frontmatter(),
                body::render(&sections)
            );
            path = bugs.join(format!("{id}.md"));
            if fsx::write_new(&path, &text)? {
                break;
            }
            id = next_id(&[id], "BUG");
        }

        let event =
            self.append_event_at(slug, &agent, EV_BUG_CREATED, Some(&id), &title, &created)?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn claim_bug(
        &self,
        slug: &str,
        id: &str,
        agent: &str,
        at: Option<&str>,
    ) -> Result<Written<BugDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(agent)?;
        let id = validate_id(id, "BUG")?;
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_bug(&path, &id, slug)?;

        match meta.status {
            BugStatus::Open => {}
            BugStatus::InProgress => {
                let holder = meta.assignee.clone().unwrap_or_else(|| "someone".into());
                if holder != agent {
                    return Err(CoreError::conflict(
                        format!("{id} is already claimed by {holder}"),
                        format!(
                            "coordinate instead of taking it over: \
                             `agentmon bug comment {id} -p {slug} --agent {agent} --message \"...\"`"
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
                         `agentmon bug comment {id} -p {slug} --agent {agent} --message \"...\"`, \
                         then file a new bug"
                    ),
                ))
            }
        }

        time::require_at_or_after(&ts, "--at", &meta.created, "the bug's created time")?;

        let already_mine = meta.status == BugStatus::InProgress;
        meta.status = BugStatus::InProgress;
        meta.assignee = Some(agent.clone());
        if meta.claimed.is_none() {
            meta.claimed = Some(ts.clone());
        }
        let sections = body::sections(&md);
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &sections)?;

        let summary = if already_mine {
            format!("Re-confirmed the claim on {id} — {}", meta.title)
        } else {
            format!("Claimed {id} — {}", meta.title)
        };
        let event = self.append_event_at(slug, &agent, EV_BUG_CLAIMED, Some(&id), &summary, &ts)?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn comment_bug(
        &self,
        slug: &str,
        id: &str,
        agent: &str,
        message: &str,
        at: Option<&str>,
    ) -> Result<Written<BugDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(agent)?;
        let note = validate::note(
            message,
            "bug comment",
            "agentmon bug comment BUG-0002 -p agent-monitoring --agent cli-builder \\\n  \
             --message \"Root cause: the watcher was never started, so no vault-changed \
             event was ever emitted.\"",
        )?;
        let id = validate_id(id, "BUG")?;
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, meta, md) = read_bug(&path, &id, slug)?;
        time::require_at_or_after(&ts, "--at", &meta.created, "the bug's created time")?;
        time::require_at_or_after(&ts, "--at", &last_comment(&md), "the previous comment")?;

        let mut sections = body::sections(&md);
        body::append_entry(
            &mut sections,
            "Comments",
            &format!("{ts} — {agent}"),
            &note,
            BUG_SECTIONS,
        );
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &sections)?;

        let event = self.append_event_at(
            slug,
            &agent,
            EV_BUG_COMMENTED,
            Some(&id),
            &body::excerpt(&note, 160),
            &ts,
        )?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn resolve_bug(
        &self,
        slug: &str,
        id: &str,
        agent: &str,
        resolution: &str,
        at: Option<&str>,
    ) -> Result<Written<BugDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(agent)?;
        let text = validate::resolution(resolution)?;
        let id = validate_id(id, "BUG")?;
        let ts = time::stamp(at, "--at")?;
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, mut meta, md) = read_bug(&path, &id, slug)?;

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
                         `agentmon bug create -p {slug} --agent {agent} --title \"...\" \
                         --severity high --refs {id} --body \"...\"`"
                    ),
                ))
            }
            BugStatus::Closed => {
                return Err(CoreError::conflict(
                    format!("{id} is closed"),
                    format!(
                        "file a new bug referencing it: \
                         `agentmon bug create -p {slug} --agent {agent} --refs {id} ...`"
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
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &sections)?;

        let event = self.append_event_at(
            slug,
            &agent,
            EV_BUG_RESOLVED,
            Some(&id),
            &body::excerpt(&text, 160),
            &ts,
        )?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    // -- events -------------------------------------------------------------

    /// Append one line to `projects/<slug>/events.jsonl`, stamped now.
    pub fn append_event(
        &self,
        slug: &str,
        actor: &str,
        event_type: &str,
        r#ref: Option<&str>,
        summary: &str,
    ) -> Result<Event> {
        self.append_event_at(slug, actor, event_type, r#ref, summary, &crate::now_iso8601())
    }

    /// Append one event carrying an explicit timestamp.
    ///
    /// Backdated mutations use this so the feed and the record agree: an event stamped
    /// "now" for work that finished yesterday would put the record at the top of the
    /// activity timeline and show a duration nobody worked.
    pub fn append_event_at(
        &self,
        slug: &str,
        actor: &str,
        event_type: &str,
        r#ref: Option<&str>,
        summary: &str,
        ts: &str,
    ) -> Result<Event> {
        let slug = validate_slug(slug)?;
        let event = Event {
            ts: ts.to_string(),
            actor: actor.trim().to_string(),
            event_type: event_type.to_string(),
            r#ref: r#ref.map(|s| s.to_string()),
            summary: summary.trim().to_string(),
        };
        let line = serde_json::to_string(&event)
            .map_err(|e| CoreError::malformed(self.root(), format!("cannot encode event: {e}")))?;
        fsx::append_line(&self.projects_dir().join(slug).join("events.jsonl"), &line)?;
        Ok(event)
    }
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

fn read_work(path: &Path, id: &str, slug: &str) -> Result<(String, Worklog, String)> {
    let raw = read_record(path, id, slug)?;
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

fn read_bug(path: &Path, id: &str, slug: &str) -> Result<(String, Bug, String)> {
    let raw = read_record(path, id, slug)?;
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

fn read_record(path: &Path, id: &str, slug: &str) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CoreError::RecordNotFound {
            id: id.to_string(),
            slug: slug.to_string(),
            path: path.to_path_buf(),
        }),
        Err(e) => Err(CoreError::io(path, e)),
    }
}

/// Frontmatter (canonical keys + anything unknown carried across) plus rendered body,
/// written atomically.
fn write_record(
    path: &Path,
    frontmatter: &str,
    original_frontmatter: &str,
    known_keys: &[&str],
    sections: &[Section],
) -> Result<()> {
    let extra = body::extra_frontmatter(original_frontmatter, known_keys);
    let text = format!("---\n{frontmatter}{extra}---\n\n{}", body::render(sections));
    fsx::write_atomic(path, &text)
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
    Ok(a.to_string())
}

fn require_title(title: &str, kind: &str) -> Result<String> {
    let t = title.trim();
    if t.is_empty() {
        return Err(CoreError::conflict(
            format!("--title is empty, and a {kind} without a title is unreadable in a list"),
            "pass a specific title, e.g. --title \"Wire the vault watcher into the desktop app\"",
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

/// `--refs` values must look like record ids, so a typo does not create a dangling link
/// the app renders as a broken reference.
fn normalize_refs(refs: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for r in clean_list(refs) {
        let upper = r.to_ascii_uppercase();
        let id = if upper.starts_with("WORK-") {
            validate_id(&upper, "WORK")?
        } else if upper.starts_with("BUG-") {
            validate_id(&upper, "BUG")?
        } else {
            return Err(CoreError::InvalidId {
                id: r.clone(),
                expected: "WORK-NNNN or BUG-NNNN (refs link records inside one project)".into(),
            });
        };
        if !out.contains(&id) {
            out.push(id);
        }
    }
    Ok(out)
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

/// Parse a project status (`agentmon project update --status`, and the app's archive button).
pub fn parse_project_status(value: &str) -> Result<ProjectStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "active" | "unarchived" => Ok(ProjectStatus::Active),
        "archived" | "archive" => Ok(ProjectStatus::Archived),
        _ => Err(bad_value("--status", value, "one of: active, archived")),
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
pub fn record_path(vault: &Vault, slug: &str, id: &str) -> PathBuf {
    let dir = vault.projects_dir().join(slug);
    if id.starts_with("BUG") {
        dir.join("bugs").join(format!("{id}.md"))
    } else {
        dir.join("worklogs").join(format!("{id}.md"))
    }
}
