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

use std::fs;
use std::path::{Path, PathBuf};

use crate::body;
use crate::error::{CoreError, Result};
use crate::fsx::{self, ProjectLock};
use crate::model::*;
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

#[derive(Debug, Clone)]
pub struct NewProject {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub actor: String,
}

#[derive(Debug, Clone)]
pub struct StartWork {
    pub agent: String,
    pub title: String,
    pub tags: Vec<String>,
    pub refs: Vec<String>,
    /// Raw markdown; must contain `## What`, `## Why`, `## How`.
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct FinishWork {
    pub agent: String,
    pub outcome: String,
    pub files: Vec<String>,
    pub refs: Vec<String>,
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
pub const EV_WORK_STARTED: &str = "work_started";
pub const EV_WORK_UPDATED: &str = "work_updated";
pub const EV_WORK_DONE: &str = "work_done";
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
        let created_at = crate::now_iso8601();
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

        let event = self.append_event(
            &slug,
            &req.actor,
            EV_PROJECT_CREATED,
            Some(&slug),
            &format!("Created project {slug} — {name}"),
        )?;
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

        let _lock = ProjectLock::acquire(&dir)?;
        let worklogs = dir.join("worklogs");
        let started = crate::now_iso8601();

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

        let event = self.append_event(
            slug,
            &agent,
            EV_WORK_STARTED,
            Some(&id),
            &title,
        )?;
        let record = self.worklog(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn update_work(
        &self,
        slug: &str,
        id: &str,
        agent: &str,
        message: &str,
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
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("worklogs").join(format!("{id}.md"));
        let (fm, meta, md) = read_work(&path, &id, slug)?;

        match meta.status {
            WorkStatus::InProgress => {}
            WorkStatus::Done => {
                return Err(CoreError::conflict(
                    format!(
                        "{id} is already done (finished {})",
                        meta.finished.as_deref().unwrap_or("unknown")
                    ),
                    "a finished work log is a historical record. Start a new one with \
                     `agentmon work start`, or add a note to the bug it relates to",
                ))
            }
            WorkStatus::Abandoned => {
                return Err(CoreError::conflict(
                    format!("{id} was abandoned"),
                    "start a new work log with `agentmon work start`",
                ))
            }
        }

        let ts = crate::now_iso8601();
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

        let event = self.append_event(
            slug,
            &agent,
            EV_WORK_UPDATED,
            Some(&id),
            &body::excerpt(&note, 160),
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

        meta.status = WorkStatus::Done;
        meta.finished = Some(crate::now_iso8601());
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

        let event = self.append_event(
            slug,
            &agent,
            EV_WORK_DONE,
            Some(&id),
            &body::excerpt(&outcome, 160),
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

        let _lock = ProjectLock::acquire(&dir)?;
        let bugs = dir.join("bugs");
        let created = crate::now_iso8601();

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

        let event = self.append_event(slug, &agent, EV_BUG_CREATED, Some(&id), &title)?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn claim_bug(&self, slug: &str, id: &str, agent: &str) -> Result<Written<BugDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(agent)?;
        let id = validate_id(id, "BUG")?;
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

        let already_mine = meta.status == BugStatus::InProgress;
        meta.status = BugStatus::InProgress;
        meta.assignee = Some(agent.clone());
        if meta.claimed.is_none() {
            meta.claimed = Some(crate::now_iso8601());
        }
        let sections = body::sections(&md);
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &sections)?;

        let summary = if already_mine {
            format!("Re-confirmed the claim on {id} — {}", meta.title)
        } else {
            format!("Claimed {id} — {}", meta.title)
        };
        let event = self.append_event(slug, &agent, EV_BUG_CLAIMED, Some(&id), &summary)?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    pub fn comment_bug(
        &self,
        slug: &str,
        id: &str,
        agent: &str,
        message: &str,
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
        let _lock = ProjectLock::acquire(&dir)?;
        let path = dir.join("bugs").join(format!("{id}.md"));
        let (fm, meta, md) = read_bug(&path, &id, slug)?;

        let ts = crate::now_iso8601();
        let mut sections = body::sections(&md);
        body::append_entry(
            &mut sections,
            "Comments",
            &format!("{ts} — {agent}"),
            &note,
            BUG_SECTIONS,
        );
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &sections)?;

        let event = self.append_event(
            slug,
            &agent,
            EV_BUG_COMMENTED,
            Some(&id),
            &body::excerpt(&note, 160),
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
    ) -> Result<Written<BugDetail>> {
        let dir = self.project_dir(slug)?;
        let agent = require_agent(agent)?;
        let text = validate::resolution(resolution)?;
        let id = validate_id(id, "BUG")?;
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

        meta.status = BugStatus::Resolved;
        meta.resolved = Some(crate::now_iso8601());
        meta.resolved_by = Some(agent.clone());
        if meta.assignee.is_none() {
            // Whoever wrote the fix owns it, even if they never ran `bug claim`.
            meta.assignee = Some(agent.clone());
            meta.claimed.get_or_insert_with(crate::now_iso8601);
        }

        let mut sections = body::sections(&md);
        body::upsert_section(&mut sections, "Resolution", &text, BUG_SECTIONS);
        write_record(&path, &meta.to_frontmatter(), &fm, BUG_KEYS, &sections)?;

        let event = self.append_event(
            slug,
            &agent,
            EV_BUG_RESOLVED,
            Some(&id),
            &body::excerpt(&text, 160),
        )?;
        let record = self.bug(slug, &id)?;
        Ok(Written::new(id, &path, event, record))
    }

    // -- events -------------------------------------------------------------

    /// Append one line to `projects/<slug>/events.jsonl`.
    pub fn append_event(
        &self,
        slug: &str,
        actor: &str,
        event_type: &str,
        r#ref: Option<&str>,
        summary: &str,
    ) -> Result<Event> {
        let slug = validate_slug(slug)?;
        let event = Event {
            ts: crate::now_iso8601(),
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
