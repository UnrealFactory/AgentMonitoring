//! `agentmon doctor` — walk the project folder and report everything wrong with it.
//!
//! Doctor reads the files directly rather than going through the normal reader, because
//! the normal reader is allowed to give up on the first corrupt record and doctor is not:
//! an agent running it wants the whole list, once, so it can fix everything in one pass.
//!
//! Two levels, and the distinction is load-bearing:
//!   * **error** — the app will render this record wrong, or a human will read something
//!     untrue (a `done` work log with no outcome, frontmatter that does not parse).
//!   * **warning** — the project is readable but something is off (an event pointing at a
//!     record that no longer exists, a lock file left behind by a killed process).

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::body;
use crate::error::Result;
use crate::fsx::LOCK_FILE;
use crate::model::*;
use crate::store::Store;

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
    /// Where the problem is, e.g. `WORK-0003.md` or `project.json`.
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
    pub path: String,
    pub name: String,
    pub schema_version: u32,
    pub worklogs: usize,
    pub bugs: usize,
    #[serde(default)]
    pub notes: usize,
    pub events: usize,
    /// Ids (and note names) of records with no `## For humans` section — the complete
    /// list, so a coverage sweep can be scripted off `agentmon doctor --json` instead of
    /// re-reading every file. The text report prints a count and the first few.
    #[serde(default)]
    pub missing_human: Vec<String>,
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
        self.worklogs + self.bugs + self.notes
    }
}

/// Known event types (SPEC.md). Unknown ones are a warning, not an error — a newer
/// writer is allowed to invent types this build has not heard of.
const EVENT_TYPES: &[&str] = &[
    "project_created",
    "project_updated",
    "work_started",
    "work_updated",
    "work_done",
    "work_abandoned",
    "bug_created",
    "bug_claimed",
    "bug_commented",
    "bug_resolved",
    "bug_closed",
    "note_created",
    "note_updated",
    "note_removed",
    "human_updated",
];

pub fn check(store: &Store) -> Result<Report> {
    let mut problems: Vec<Problem> = Vec::new();
    let dir = store.root().to_path_buf();

    // -- project.json -------------------------------------------------------
    let mut name = String::new();
    let mut version = 0u32;
    let pj = dir.join("project.json");
    match fs::read_to_string(&pj) {
        Err(e) => problems.push(Problem::error(
            "project.json",
            format!("cannot be read: {e}"),
            "restore the file or recreate the project with `agentmon init`",
        )),
        Ok(raw) => match serde_json::from_str::<Project>(&raw) {
            Err(e) => problems.push(Problem::error(
                "project.json",
                format!("is not valid project JSON: {e}"),
                "required keys: version (2), id, name; see SPEC.md",
            )),
            Ok(p) => {
                name = p.name.clone();
                version = p.version;
                if p.version != crate::SCHEMA_VERSION {
                    problems.push(Problem::error(
                        "project.json",
                        format!(
                            "schema version is {} but this build of agentmon speaks v{}",
                            p.version,
                            crate::SCHEMA_VERSION
                        ),
                        "v1 vault data is moved forward with `agentmon migrate --from <vault> \
                         --project <slug> --to <folder>`",
                    ));
                }
                if p.id.trim().is_empty() {
                    problems.push(Problem::error(
                        "project.json",
                        "\"id\" is empty; the app routes by it",
                        "set a stable id, e.g. \"id\": \"prj-checkout\"",
                    ));
                }
                if p.name.trim().is_empty() {
                    problems.push(Problem::error(
                        "project.json",
                        "\"name\" is empty",
                        "set a display name; the sidebar shows it",
                    ));
                }
            }
        },
    }

    // Records that speak to only one audience. Collected across all three kinds and
    // reported once, because the fix is one sweep and 60 identical warnings are noise.
    let mut gaps = HumanGaps::default();

    // -- worklogs -----------------------------------------------------------
    let mut n_work = 0usize;
    let mut work_ids: HashMap<String, String> = HashMap::new();
    for path in md_files(&dir.join("worklogs")) {
        n_work += 1;
        check_worklog(&path, &mut problems, &mut work_ids, &mut gaps);
    }

    // -- bugs ---------------------------------------------------------------
    let mut n_bugs = 0usize;
    let mut bug_ids: HashMap<String, String> = HashMap::new();
    for path in md_files(&dir.join("bugs")) {
        n_bugs += 1;
        check_bug(&path, &mut problems, &mut bug_ids, &mut gaps);
    }

    // -- notes --------------------------------------------------------------
    let mut n_notes = 0usize;
    for path in md_files(&dir.join("notes")) {
        n_notes += 1;
        check_note(&path, &mut problems, &mut gaps);
    }

    // -- the human area -----------------------------------------------------
    //
    // A warning, never an error: a record written before the human area existed is not
    // corrupt, it is incomplete, and the app renders it with a designed empty state. It
    // becomes actionable the next time an agent touches that record, which is exactly
    // when the write path refuses to leave it without one.
    const SHOWN: usize = 10;
    let listing = |ids: &[String]| {
        let listed = ids.iter().take(SHOWN).cloned().collect::<Vec<_>>().join(", ");
        let rest = ids.len().saturating_sub(SHOWN);
        if rest > 0 {
            format!("{listed}, and {rest} more (agentmon doctor --json lists them all)")
        } else {
            listed
        }
    };
    if !gaps.missing.is_empty() {
        problems.push(Problem::warn(
            "human area",
            format!(
                "{} record(s) have no `## For humans` section, so the app can show them to \
                 agents only: {}",
                gaps.missing.len(),
                listing(&gaps.missing)
            ),
            "write one for each: `agentmon work update <id> --agent <you> --human \"…\"`, \
             `agentmon bug comment <id> --agent <you> --human \"…\"`, `agentmon note update \
             <name> --agent <you> --human \"…\"` — `agentmon human-style` prints the contract",
        ));
    }
    // The subset that `--human` alone cannot fix: an unclosed ``` in the agent area would
    // swallow the section, so the write path refuses it. Said separately because the fix is
    // a different action by a different hand — this is the one human-area repair that is
    // not a command an agent can run.
    if !gaps.unclosed_fence.is_empty() {
        problems.push(Problem::warn(
            "human area",
            format!(
                "{} of those record(s) leave a code fence (```) open in the agent area, so a \
                 `## For humans` section written after it would read back as code: {}",
                gaps.unclosed_fence.len(),
                listing(&gaps.unclosed_fence)
            ),
            "close the fence in the record file itself (every ``` needs a partner), then \
             write the human area with the usual `--human`; agentmon refuses the write until \
             then rather than saving a record whose human area is invisible",
        ));
    }
    // Length, for the same reason and at the same level: a long retelling is readable and
    // true, so it is never an error, and the repair is a rewrite by the agent that wrote
    // it. Warned about at all because the ceiling used to live only in docs/HUMAN_STYLE.md,
    // where no code read it — a 703-word human area shipped, and the only thing that
    // noticed was a person counting words by hand.
    //
    // One telling, not one record. This warning counted whole records once, and the cost of
    // that is measured: it reported a work log that shipped five things and retold all five,
    // its hint said to cut, and the agent that followed the hint dropped two deliverables
    // out of the retelling whole. A gate whose false positive is "delete a fact you owed"
    // is worse than no gate, so what is counted is the longest run of prose with no beat
    // break in it — certainly one telling, and over the ceiling only when a telling is.
    if !gaps.long_telling.is_empty() {
        problems.push(Problem::warn(
            "human area",
            format!(
                "{} record(s) tell one thing at more than the style contract's {}-word \
                 ceiling: {}",
                gaps.long_telling.len(),
                crate::human::WORDS_MAX,
                listing(&gaps.long_telling)
            ),
            "the ceiling bounds one telling, never a record's total, so split before you cut: \
             a record that shipped several separate things owes every one of them a beat-block \
             of its own, opened by a bold lead-in that states something. Never cut a fact to \
             reach a number — only where one thing's own telling is still over does anything \
             go, and then a name carrying no fact of its own first, then a fact stated twice, \
             never a gloss. `agentmon human-style` prints the contract",
        ));
    }

    // -- events.jsonl -------------------------------------------------------
    let mut n_events = 0usize;
    let events = dir.join("events.jsonl");
    if events.is_file() {
        match fs::read_to_string(&events) {
            Err(e) => problems.push(Problem::error(
                "events.jsonl",
                format!("cannot be read: {e}"),
                "check file permissions; the app reads this on every dashboard load",
            )),
            Ok(raw) => {
                for (i, line) in raw.lines().enumerate() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    n_events += 1;
                    match serde_json::from_str::<Event>(line) {
                        Err(e) => problems.push(Problem::error(
                            format!("events.jsonl:{}", i + 1),
                            format!("line is not a valid event: {e}"),
                            "each line is one JSON object: {\"ts\":...,\"actor\":...,\
                             \"type\":...,\"ref\":...,\"summary\":...}. Delete or fix the line — \
                             readers skip it, so the activity feed is silently missing it",
                        )),
                        Ok(ev) => {
                            if !EVENT_TYPES.contains(&ev.event_type.as_str()) {
                                problems.push(Problem::warn(
                                    format!("events.jsonl:{}", i + 1),
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
                                    false // free-form refs are fine
                                };
                                if missing {
                                    problems.push(Problem::warn(
                                        format!("events.jsonl:{}", i + 1),
                                        format!("references {r}, which does not exist"),
                                        "the record was deleted or renamed; the activity feed \
                                         will link nowhere",
                                    ));
                                }
                            }
                            if let Err(msg) = check_ts(&ev.ts) {
                                problems.push(Problem::error(
                                    format!("events.jsonl:{}", i + 1),
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
    } else if n_work + n_bugs > 0 {
        problems.push(Problem::warn(
            "events.jsonl",
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
                LOCK_FILE,
                format!("a write lock has been held for {age}s — the process holding it \
                         probably died"),
                format!("delete {}; agentmon reclaims it automatically after 120s", lock.display()),
            ));
        }
    }

    Ok(Report {
        path: dir.display().to_string(),
        name,
        schema_version: version,
        worklogs: n_work,
        bugs: n_bugs,
        notes: n_notes,
        events: n_events,
        missing_human: gaps.missing,
        problems,
    })
}

/// What the human-area sweep found: which records have no `## For humans` section, and
/// which of those cannot gain one until a person edits the file.
#[derive(Default)]
struct HumanGaps {
    /// Records with no human area — the `missingHuman` list in `--json`.
    missing: Vec<String>,
    /// The subset whose agent area leaves a code fence open. The write path refuses to add
    /// a human area to these (it would be swallowed by the fence and read back as code),
    /// so the repair is a person closing the fence, not another `--human`.
    unclosed_fence: Vec<String>,
    /// Records with a single telling past `human::WORDS_MAX`, each with that telling's own
    /// count, so the warning says how far over it is rather than only that it is over.
    long_telling: Vec<String>,
}

/// Note the record if its body carries no human area (SPEC.md, "The human area"), or if
/// one telling inside it runs past the style contract's ceiling.
fn note_human(md: &str, id: &str, gaps: &mut HumanGaps) {
    match crate::human::split(md).1 {
        None => {
            gaps.missing.push(id.to_string());
            if crate::human::has_open_fence(md) {
                gaps.unclosed_fence.push(id.to_string());
            }
        }
        Some(human) => {
            // `longest_telling`, not `words`: the ceiling bounds one telling, and a record
            // that shipped several things is meant to run past it in total.
            let words = crate::human::longest_telling(&human);
            if words > crate::human::WORDS_MAX {
                gaps.long_telling.push(format!("{id} ({words} words in one telling)"));
            }
        }
    }
}

fn check_note(path: &Path, problems: &mut Vec<Problem>, gaps: &mut HumanGaps) {
    let file = file_name(path);
    let scope = file.clone();
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
            "see the note schema in SPEC.md; the fastest fix is to rewrite it with \
             `agentmon note add`",
        ));
        return;
    };
    let meta: Note = match serde_yaml::from_str(fm) {
        Ok(m) => m,
        Err(e) => {
            problems.push(Problem::error(
                scope,
                format!("frontmatter does not parse: {e}"),
                "required keys: name, title, type (memory|handoff|decision|reference), \
                 description, agent, created, updated. Quote any value containing a colon",
            ));
            return;
        }
    };

    note_human(md, &meta.name, gaps);

    let stem = file.trim_end_matches(".md");
    if meta.name != stem {
        problems.push(Problem::error(
            &scope,
            format!("frontmatter name is \"{}\" but the file is {file}", meta.name),
            format!(
                "rename the file to {}.md, or set name: {stem} — the name is the note's \
                 identity and its address",
                meta.name
            ),
        ));
    }
    if crate::store::validate_note_name(&meta.name).is_err() {
        problems.push(Problem::error(
            &scope,
            format!("name \"{}\" is not a valid note name", meta.name),
            "names are kebab-case, 2–64 letters, digits and hyphens — they double as file \
             names, URLs and --refs values",
        ));
    }
    if meta.title.trim().is_empty() {
        problems.push(Problem::error(
            &scope,
            "`title` is empty",
            "give it the one-line summary the notes list shows",
        ));
    }
    if meta.description.trim().is_empty() {
        problems.push(Problem::error(
            &scope,
            "`description` is empty",
            "one line saying what this note knows — it is how agents decide whether to \
             open the body",
        ));
    }
    if meta.agent.trim().is_empty() {
        problems.push(Problem::error(
            &scope,
            "`agent` is empty",
            "set the agent handle that wrote the note",
        ));
    }
    for (key, value) in [("created", &meta.created), ("updated", &meta.updated)] {
        if let Err(msg) = check_ts(value) {
            problems.push(Problem::error(
                &scope,
                format!("`{key}` \"{value}\" {msg}"),
                "use UTC ISO8601, e.g. 2026-08-18T09:12:00Z",
            ));
        }
    }
    if check_ts(&meta.created).is_ok()
        && check_ts(&meta.updated).is_ok()
        && meta.updated < meta.created
    {
        problems.push(Problem::error(
            &scope,
            format!(
                "`updated` ({}) is before `created` ({})",
                meta.updated, meta.created
            ),
            "fix whichever timestamp is wrong; the notes list sorts by updated (essential first)",
        ));
    }
}

fn check_worklog(
    path: &Path,
    problems: &mut Vec<Problem>,
    seen: &mut HashMap<String, String>,
    gaps: &mut HumanGaps,
) {
    let file = file_name(path);
    let scope = file.clone();
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

    note_human(md, &meta.id, gaps);
    let (md, _) = crate::human::split(md);

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

    let mut secs = body::sections(&md);
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
    problems: &mut Vec<Problem>,
    seen: &mut HashMap<String, String>,
    gaps: &mut HumanGaps,
) {
    let file = file_name(path);
    let scope = file.clone();
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

    note_human(md, &meta.id, gaps);
    let (md, _) = crate::human::split(md);

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

    let mut secs = body::sections(&md);
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
