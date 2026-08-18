//! `agentmon doctor` — walk the vault and report everything that is wrong with it.
//!
//! Doctor reads the files directly rather than going through the normal reader, because
//! the normal reader is allowed to give up on the first corrupt record and doctor is not:
//! an agent running it wants the whole list, once, so it can fix everything in one pass.
//!
//! Two levels, and the distinction is load-bearing:
//!   * **error** — the app will render this record wrong, or a human will read something
//!     untrue (a `done` work log with no outcome, frontmatter that does not parse).
//!   * **warning** — the vault is readable but something is off (an event pointing at a
//!     record that no longer exists, a lock file left behind by a killed process).

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::body;
use crate::error::Result;
use crate::fsx::LOCK_FILE;
use crate::model::*;
use crate::vault::Vault;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub level: Level,
    /// Where the problem is, e.g. `agent-monitoring/WORK-0003` or `vault.json`.
    pub scope: String,
    pub message: String,
    /// What to do about it — always actionable, never "check the file".
    pub fix: String,
}

impl Problem {
    fn error(scope: impl Into<String>, message: impl Into<String>, fix: impl Into<String>) -> Self {
        Problem {
            level: Level::Error,
            scope: scope.into(),
            message: message.into(),
            fix: fix.into(),
        }
    }
    fn warn(scope: impl Into<String>, message: impl Into<String>, fix: impl Into<String>) -> Self {
        Problem {
            level: Level::Warning,
            scope: scope.into(),
            message: message.into(),
            fix: fix.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub vault: String,
    pub vault_name: String,
    pub schema_version: u32,
    pub projects: usize,
    pub worklogs: usize,
    pub bugs: usize,
    pub events: usize,
    pub problems: Vec<Problem>,
}

impl Report {
    pub fn errors(&self) -> usize {
        self.problems
            .iter()
            .filter(|p| p.level == Level::Error)
            .count()
    }
    pub fn warnings(&self) -> usize {
        self.problems
            .iter()
            .filter(|p| p.level == Level::Warning)
            .count()
    }
    pub fn records_checked(&self) -> usize {
        self.worklogs + self.bugs
    }
}

/// Known event types (SPEC.md). Unknown ones are a warning, not an error — a newer
/// writer is allowed to invent types this build has not heard of.
const EVENT_TYPES: &[&str] = &[
    "project_created",
    "work_started",
    "work_updated",
    "work_done",
    "work_abandoned",
    "bug_created",
    "bug_claimed",
    "bug_commented",
    "bug_resolved",
    "bug_closed",
];

pub fn check(vault: &Vault) -> Result<Report> {
    let mut problems: Vec<Problem> = Vec::new();
    let root = vault.root().to_path_buf();

    let info = vault.info()?;
    if info.version != crate::SCHEMA_VERSION {
        problems.push(Problem::error(
            "vault.json",
            format!(
                "schema version is {} but this build of agentmon speaks v{}",
                info.version,
                crate::SCHEMA_VERSION
            ),
            "upgrade agentmon (`cargo build --release -p agentmon-cli`) or point at a vault \
             written by a matching build",
        ));
    }
    if info.name.trim().is_empty() {
        problems.push(Problem::error(
            "vault.json",
            "\"name\" is empty; the app shows it as the vault's title",
            "set a name, e.g. \"name\": \"AgentMonitoring\"",
        ));
    }

    let projects_dir = root.join("projects");
    if !projects_dir.is_dir() {
        problems.push(Problem::error(
            "projects/",
            "the projects directory does not exist",
            "create the first project: `agentmon project create <slug> --name \"<name>\"`",
        ));
    }

    let mut n_projects = 0usize;
    let mut n_work = 0usize;
    let mut n_bugs = 0usize;
    let mut n_events = 0usize;

    let mut dirs: Vec<_> = if projects_dir.is_dir() {
        fs::read_dir(&projects_dir)
            .map_err(|e| crate::CoreError::io(&projects_dir, e))?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect()
    } else {
        Vec::new()
    };
    dirs.sort();

    for dir in dirs {
        let slug = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !dir.join("project.json").is_file() {
            problems.push(Problem::warn(
                format!("projects/{slug}"),
                "directory has no project.json, so the app will not list it",
                format!(
                    "create it with `agentmon project create {slug} --name \"<name>\"`, or delete \
                     the directory"
                ),
            ));
            continue;
        }
        n_projects += 1;
        check_project(&dir, &slug, &mut problems, &mut n_work, &mut n_bugs, &mut n_events);
    }

    Ok(Report {
        vault: info.path,
        vault_name: info.name,
        schema_version: info.version,
        projects: n_projects,
        worklogs: n_work,
        bugs: n_bugs,
        events: n_events,
        problems,
    })
}

fn check_project(
    dir: &Path,
    slug: &str,
    problems: &mut Vec<Problem>,
    n_work: &mut usize,
    n_bugs: &mut usize,
    n_events: &mut usize,
) {
    // -- project.json -------------------------------------------------------
    let pj = dir.join("project.json");
    match fs::read_to_string(&pj) {
        Err(e) => problems.push(Problem::error(
            format!("{slug}/project.json"),
            format!("cannot be read: {e}"),
            "restore the file or recreate the project with `agentmon project create`",
        )),
        Ok(raw) => match serde_json::from_str::<Project>(&raw) {
            Err(e) => problems.push(Problem::error(
                format!("{slug}/project.json"),
                format!("is not valid project JSON: {e}"),
                "required keys: id, slug, name, status (active|archived); see SPEC.md",
            )),
            Ok(p) => {
                if p.slug != slug {
                    problems.push(Problem::error(
                        format!("{slug}/project.json"),
                        format!("\"slug\" is \"{}\" but the directory is \"{slug}\"", p.slug),
                        format!("set \"slug\": \"{slug}\" — the directory name is what -p matches"),
                    ));
                }
                if p.name.trim().is_empty() {
                    problems.push(Problem::error(
                        format!("{slug}/project.json"),
                        "\"name\" is empty",
                        "set a display name; the sidebar shows it",
                    ));
                }
            }
        },
    }

    // -- worklogs -----------------------------------------------------------
    let mut work_ids: HashMap<String, String> = HashMap::new();
    for path in md_files(&dir.join("worklogs")) {
        *n_work += 1;
        check_worklog(&path, slug, problems, &mut work_ids);
    }

    // -- bugs ---------------------------------------------------------------
    let mut bug_ids: HashMap<String, String> = HashMap::new();
    for path in md_files(&dir.join("bugs")) {
        *n_bugs += 1;
        check_bug(&path, slug, problems, &mut bug_ids);
    }

    // -- events.jsonl -------------------------------------------------------
    let events = dir.join("events.jsonl");
    if events.is_file() {
        match fs::read_to_string(&events) {
            Err(e) => problems.push(Problem::error(
                format!("{slug}/events.jsonl"),
                format!("cannot be read: {e}"),
                "check file permissions; the app reads this on every dashboard load",
            )),
            Ok(raw) => {
                for (i, line) in raw.lines().enumerate() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    *n_events += 1;
                    match serde_json::from_str::<Event>(line) {
                        Err(e) => problems.push(Problem::error(
                            format!("{slug}/events.jsonl:{}", i + 1),
                            format!("line is not a valid event: {e}"),
                            "each line is one JSON object: {\"ts\":...,\"actor\":...,\
                             \"type\":...,\"ref\":...,\"summary\":...}. Delete or fix the line — \
                             readers skip it, so the activity feed is silently missing it",
                        )),
                        Ok(ev) => {
                            if !EVENT_TYPES.contains(&ev.event_type.as_str()) {
                                problems.push(Problem::warn(
                                    format!("{slug}/events.jsonl:{}", i + 1),
                                    format!("unknown event type \"{}\"", ev.event_type),
                                    format!("known types: {}", EVENT_TYPES.join(", ")),
                                ));
                            }
                            if let Some(r) = ev.r#ref.as_deref() {
                                let missing = if r.starts_with("WORK-") {
                                    !work_ids.contains_key(r)
                                } else if r.starts_with("BUG-") {
                                    !bug_ids.contains_key(r)
                                } else {
                                    false // project refs and free-form refs are fine
                                };
                                if missing {
                                    problems.push(Problem::warn(
                                        format!("{slug}/events.jsonl:{}", i + 1),
                                        format!("references {r}, which does not exist"),
                                        "the record was deleted or renamed; the activity feed \
                                         will link nowhere",
                                    ));
                                }
                            }
                            if let Err(msg) = check_ts(&ev.ts) {
                                problems.push(Problem::error(
                                    format!("{slug}/events.jsonl:{}", i + 1),
                                    format!("timestamp \"{}\" {msg}", ev.ts),
                                    "events sort by this string; use UTC ISO8601 \
                                     (2026-08-18T09:12:00Z)",
                                ));
                            }
                        }
                    }
                }
            }
        }
    } else if *n_work + *n_bugs > 0 {
        problems.push(Problem::warn(
            format!("{slug}/events.jsonl"),
            "missing, so the dashboard's activity feed is empty",
            "it is created by the first `agentmon work start` / `bug create` in this project",
        ));
    }

    // -- leftovers ----------------------------------------------------------
    let lock = dir.join(LOCK_FILE);
    if let Ok(meta) = fs::metadata(&lock) {
        let age = meta
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if age > 300 {
            problems.push(Problem::warn(
                format!("{slug}/{LOCK_FILE}"),
                format!("a write lock has been held for {age}s — the process holding it \
                         probably died"),
                format!("delete {}; agentmon reclaims it automatically after 120s", lock.display()),
            ));
        }
    }
}

fn check_worklog(
    path: &Path,
    slug: &str,
    problems: &mut Vec<Problem>,
    seen: &mut HashMap<String, String>,
) {
    let file = file_name(path);
    let scope = format!("{slug}/{file}");
    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) => {
            problems.push(Problem::error(
                scope,
                format!("cannot be read: {e}"),
                "check file permissions",
            ));
            return;
        }
    };
    let Some((fm, md)) = body::split_frontmatter(&raw) else {
        problems.push(Problem::error(
            scope,
            "has no YAML frontmatter (the file must start with a `---` fenced block)",
            "see the worklog schema in SPEC.md; the fastest fix is to recreate the record with \
             `agentmon work start`",
        ));
        return;
    };
    let meta: Worklog = match serde_yaml::from_str(fm) {
        Ok(m) => m,
        Err(e) => {
            problems.push(Problem::error(
                scope,
                format!("frontmatter does not parse: {e}"),
                "required keys: id, title, agent, status (in_progress|done|abandoned), started. \
                 Quote any title containing a colon",
            ));
            return;
        }
    };

    let stem = file.trim_end_matches(".md");
    if meta.id != stem {
        problems.push(Problem::error(
            &scope,
            format!("frontmatter id is \"{}\" but the file is {file}", meta.id),
            format!("rename the file to {}.md, or set id: {stem} — ids are matched by both", meta.id),
        ));
    }
    if let Some(prev) = seen.insert(meta.id.clone(), file.clone()) {
        problems.push(Problem::error(
            &scope,
            format!("duplicate id — {} already uses {}", meta.id, prev),
            "ids are per-project and immutable; give one of the two records a new id and \
             rename its file to match",
        ));
    }

    let mut secs = body::sections(md);
    for name in ["What", "Why", "How"] {
        let mut probe = secs.clone();
        match body::take_section(&mut probe, name) {
            Some(s) if !s.trim().is_empty() => {}
            _ => problems.push(Problem::error(
                &scope,
                format!("has no `## {name}` section (or it is empty)"),
                "every work log answers What / Why / How — a reader cannot reconstruct the work \
                 without them. Add the section to the file",
            )),
        }
    }
    let outcome = body::take_section(&mut secs, "Outcome").filter(|s| !s.trim().is_empty());

    match meta.status {
        WorkStatus::Done => {
            if outcome.is_none() {
                problems.push(Problem::error(
                    &scope,
                    "status is done but there is no `## Outcome` section",
                    "record what shipped and how it was verified — the app shows done work \
                     without an outcome as an empty result",
                ));
            }
            if meta.finished.is_none() {
                problems.push(Problem::error(
                    &scope,
                    "status is done but `finished` is null",
                    "set finished to the UTC ISO8601 completion time; charts bucket work by it",
                ));
            }
        }
        WorkStatus::InProgress => {
            if meta.finished.is_some() {
                problems.push(Problem::error(
                    &scope,
                    format!(
                        "status is in_progress but `finished` is set ({})",
                        meta.finished.clone().unwrap_or_default()
                    ),
                    "either set status: done (and write `## Outcome`), or set finished: null",
                ));
            }
            if outcome.is_some() {
                problems.push(Problem::warn(
                    &scope,
                    "status is in_progress but the record already has an `## Outcome`",
                    "close it with `agentmon work done` so status, finished and the outcome agree",
                ));
            }
        }
        WorkStatus::Abandoned => {}
    }

    if let Err(msg) = check_ts(&meta.started) {
        problems.push(Problem::error(
            &scope,
            format!("`started` \"{}\" {msg}", meta.started),
            "use UTC ISO8601, e.g. started: 2026-08-18T09:12:00Z",
        ));
    }
    if let Some(f) = &meta.finished {
        if let Err(msg) = check_ts(f) {
            problems.push(Problem::error(
                &scope,
                format!("`finished` \"{f}\" {msg}"),
                "use UTC ISO8601, e.g. finished: 2026-08-18T11:22:00Z",
            ));
        } else if f < &meta.started {
            problems.push(Problem::error(
                &scope,
                format!("`finished` ({f}) is before `started` ({})", meta.started),
                "fix whichever timestamp is wrong; duration is computed from the pair",
            ));
        }
    }
    if meta.title.trim().is_empty() {
        problems.push(Problem::error(
            &scope,
            "`title` is empty",
            "give it the one-line summary the work list shows",
        ));
    }
    if meta.agent.trim().is_empty() {
        problems.push(Problem::error(
            &scope,
            "`agent` is empty",
            "set the agent handle that did the work; the dashboard groups by it",
        ));
    }
}

fn check_bug(
    path: &Path,
    slug: &str,
    problems: &mut Vec<Problem>,
    seen: &mut HashMap<String, String>,
) {
    let file = file_name(path);
    let scope = format!("{slug}/{file}");
    let raw = match fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) => {
            problems.push(Problem::error(
                scope,
                format!("cannot be read: {e}"),
                "check file permissions",
            ));
            return;
        }
    };
    let Some((fm, md)) = body::split_frontmatter(&raw) else {
        problems.push(Problem::error(
            scope,
            "has no YAML frontmatter (the file must start with a `---` fenced block)",
            "see the bug schema in SPEC.md; the fastest fix is to refile it with \
             `agentmon bug create`",
        ));
        return;
    };
    let meta: Bug = match serde_yaml::from_str(fm) {
        Ok(m) => m,
        Err(e) => {
            problems.push(Problem::error(
                scope,
                format!("frontmatter does not parse: {e}"),
                "required keys: id, title, reporter, severity (critical|high|medium|low), \
                 status (open|in_progress|resolved|closed), created",
            ));
            return;
        }
    };

    let stem = file.trim_end_matches(".md");
    if meta.id != stem {
        problems.push(Problem::error(
            &scope,
            format!("frontmatter id is \"{}\" but the file is {file}", meta.id),
            format!("rename the file to {}.md, or set id: {stem}", meta.id),
        ));
    }
    if let Some(prev) = seen.insert(meta.id.clone(), file.clone()) {
        problems.push(Problem::error(
            &scope,
            format!("duplicate id — {} already uses {}", meta.id, prev),
            "give one of the two records a new id and rename its file to match",
        ));
    }

    let mut secs = body::sections(md);
    match body::take_section(&mut secs, "Report") {
        Some(s) if !s.trim().is_empty() => {}
        _ => problems.push(Problem::error(
            &scope,
            "has no `## Report` section (or it is empty)",
            "a bug without repro steps, expected and actual is not actionable — add the section",
        )),
    }
    let resolution = body::take_section(&mut secs, "Resolution").filter(|s| !s.trim().is_empty());

    match meta.status {
        BugStatus::Resolved | BugStatus::Closed => {
            if resolution.is_none() {
                problems.push(Problem::error(
                    &scope,
                    format!(
                        "status is {} but there is no `## Resolution` section",
                        meta.status.as_str()
                    ),
                    "record what the fix was and how it was verified — a closed bug with no \
                     resolution teaches nobody anything",
                ));
            }
            if meta.resolved.is_none() {
                problems.push(Problem::error(
                    &scope,
                    format!("status is {} but `resolved` is null", meta.status.as_str()),
                    "set resolved to the UTC ISO8601 time it was fixed",
                ));
            }
            if meta.resolved_by.is_none() {
                problems.push(Problem::error(
                    &scope,
                    format!("status is {} but `resolved_by` is null", meta.status.as_str()),
                    "set resolved_by to the agent that fixed it; the dashboard credits it",
                ));
            }
        }
        BugStatus::InProgress => {
            if meta.assignee.is_none() {
                problems.push(Problem::error(
                    &scope,
                    "status is in_progress but `assignee` is null",
                    "run `agentmon bug claim` (it sets both), or set assignee in the frontmatter",
                ));
            }
            if resolution.is_some() {
                problems.push(Problem::warn(
                    &scope,
                    "status is in_progress but the record already has a `## Resolution`",
                    "close it with `agentmon bug resolve` so status and resolution agree",
                ));
            }
        }
        BugStatus::Open => {
            if meta.assignee.is_some() {
                problems.push(Problem::error(
                    &scope,
                    format!(
                        "status is open but `assignee` is {}",
                        meta.assignee.clone().unwrap_or_default()
                    ),
                    "claiming sets status to in_progress — run `agentmon bug claim`, or clear \
                     assignee so the board shows it as unowned",
                ));
            }
            if resolution.is_some() {
                problems.push(Problem::error(
                    &scope,
                    "status is open but the record has a `## Resolution`",
                    "run `agentmon bug resolve` to set status, resolved and resolved_by together",
                ));
            }
        }
    }

    if let Err(msg) = check_ts(&meta.created) {
        problems.push(Problem::error(
            &scope,
            format!("`created` \"{}\" {msg}", meta.created),
            "use UTC ISO8601, e.g. created: 2026-08-18T09:12:00Z",
        ));
    }
    for (key, value) in [("claimed", &meta.claimed), ("resolved", &meta.resolved)] {
        if let Some(v) = value {
            if let Err(msg) = check_ts(v) {
                problems.push(Problem::error(
                    &scope,
                    format!("`{key}` \"{v}\" {msg}"),
                    "use UTC ISO8601, e.g. 2026-08-18T11:02:00Z",
                ));
            }
        }
    }
    if meta.title.trim().is_empty() {
        problems.push(Problem::error(
            &scope,
            "`title` is empty",
            "give it the one-line summary the bug board shows",
        ));
    }
}

fn md_files(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out: Vec<std::path::PathBuf> = match fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension().map(|e| e == "md").unwrap_or(false)
                    && !file_name(p).starts_with('.')
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    out.sort();
    out
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Timestamps are compared as strings everywhere (sorting an event feed, "last activity"),
/// which only works if they are all UTC ISO8601 with the same shape.
fn check_ts(ts: &str) -> std::result::Result<(), &'static str> {
    if ts.trim().is_empty() {
        return Err("is empty");
    }
    if chrono::DateTime::parse_from_rfc3339(ts).is_err() {
        return Err("is not ISO8601");
    }
    if !ts.ends_with('Z') {
        return Err("is not UTC (must end with Z)");
    }
    Ok(())
}
