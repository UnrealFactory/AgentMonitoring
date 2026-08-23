//! `agentmon doctor` — walk the project folder and report everything wrong with it.
//!
//! Doctor reads the files directly rather than going through the normal reader, because
//! the normal reader is allowed to give up on the first corrupt record and doctor is not:
//! an agent running it wants the whole list, once, so it can fix everything in one pass.
//!
//! Two levels, and the distinction is load-bearing:
//!   * **error** — the app will render this record wrong, a human will read something
//!     untrue (a `done` work log with no outcome, frontmatter that does not parse, an
//!     event announcing a progress note the record does not contain), or agentmon itself
//!     will refuse to write to the record ever again (an open code fence).
//!   * **warning** — the project is readable but something is off (an event pointing at a
//!     record that no longer exists, a lock file left behind by a killed process).
//!
//! Doctor used to check an event's *shape* — valid JSON, a known type, a `ref` that
//! resolves, a timestamp that parses — and never its *claim*. That gap shipped: nine
//! `work_updated` events sat in this project's own log announcing progress notes that no
//! record held, and doctor printed "No problems found" over all nine while the dashboard
//! read them out as nine notes. Shape is not integrity. See `pair_work_updated` below.

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
    /// `WORK-NNNN@<ts>` for every `work_updated` event that has no matching note in its
    /// record *and* is accounted for by the project's reconciliation note. Not a problem —
    /// but never silent either: doctor prints this list on every run, because the feed is
    /// still saying something the files do not, and a reader deserves to know which nine.
    #[serde(default)]
    pub reconciled_events: Vec<String>,
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
    // Every `### <ts>` under each work log's `## Updates`, read with the same parser the
    // app and the writer use (`body::work_updates`), so what doctor pairs against is
    // exactly what a reader sees — not a second, looser grammar that could agree with the
    // event log while the screen disagrees.
    let mut work_notes: HashMap<String, Vec<String>> = HashMap::new();
    for path in md_files(&dir.join("worklogs")) {
        n_work += 1;
        check_worklog(&path, &mut problems, &mut work_ids, &mut work_notes, &mut gaps);
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
    // Missing one is a warning, not an error: a record written before the human area existed
    // is not corrupt, it is incomplete, and the app renders it with a designed empty state.
    // It becomes actionable the next time an agent touches that record, which is exactly
    // when the write path refuses to leave it without one. The one exception is below —
    // a record the write path will not accept at all is corrupt by that same measure.
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
    // swallow the section, so the write path refuses it — and refuses everything else with
    // it. An **error**, alone among the human-area findings, because it is not the same kind
    // of thing: the records above are incomplete but still writable, while one of these is a
    // record no agent can touch again. `work update`, `bug comment`, `note update`, every
    // MCP tool: all of them fail on it until a person edits the file. A project carrying one
    // is broken, not untidy, and SPEC has doctor exit non-zero on that.
    //
    // Said separately from the warning above for the same reason it is louder: the repair is
    // a different action by a different hand — the one human-area repair that is not a
    // command anyone can run.
    if !gaps.unclosed_fence.is_empty() {
        problems.push(Problem::error(
            "human area",
            format!(
                "{} of those record(s) leave a code fence (```) open in the agent area: a \
                 `## For humans` section written after it would read back as code, so agentmon \
                 refuses every write to them — they are frozen until the file is repaired: {}",
                gaps.unclosed_fence.len(),
                listing(&gaps.unclosed_fence)
            ),
            "no agentmon command can repair this and an agent must not paper over it by \
             rewriting the record: a person opens each file at the line named above — the ``` \
             that has no partner — and adds a line holding ``` and nothing else at the end of \
             that fence's code, changing not one other byte. Then the record accepts writes \
             again and the usual `--human` gives it its human area",
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
    let mut reconciled: Vec<String> = Vec::new();
    let accounted = accounted_orphans(&dir);
    let reconcile_note_exists = reconcile_note_path(&dir).is_file();
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
                                } else if let Some(p) = pair_work_updated(
                                    &ev,
                                    r,
                                    i + 1,
                                    &work_notes,
                                    &accounted,
                                    reconcile_note_exists,
                                    // The sweep above already read every record; a record
                                    // it did not name has a human area, so the repair line
                                    // it prints needs no `--human`.
                                    !gaps.missing.iter().any(|m| m == r),
                                    &mut reconciled,
                                ) {
                                    problems.push(p);
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
        reconciled_events: reconciled,
        problems,
    })
}

/// The note that accounts for orphaned events, by name. Fixed and documented in SPEC so
/// that "explained" is a thing doctor can read, not a thing an agent asserts in a commit
/// message that no tool will ever see again.
pub const RECONCILE_NOTE: &str = "event-reconciliation";

/// Does the activity feed's claim match the record? For `work_updated` the claim is exact:
/// "a progress note was posted on this record at this timestamp", and `write.rs` can only
/// ever emit it in the same breath as `body::append_entry(.., "Updates", ..)` — the event
/// and the `### <ts>` entry are written together or not at all. So an event with no entry
/// is not a stale reference or a tidiness problem; it is proof that something other than
/// the CLI wrote one half of a pair, and the dashboard is announcing a note that a reader
/// clicking through will not find. **Error**, by doctor's own rule: a human reads something
/// untrue.
///
/// The escape hatch is not a flag and not an allowlist in the source — it is a note in the
/// project, `notes/<RECONCILE_NOTE>.md`, naming each orphan as `WORK-NNNN@<ts>`. That is
/// deliberate, and it is the only shape that satisfies doctor's other contract, that a
/// `fix:` line is always an action someone can take. Some orphans have no repair: when the
/// note text is gone, writing the event's 160-character summary into the record as if it
/// were the note is not restoration, it is invention, and the one thing live records must
/// never carry is invented history. What a person *can* always do is say what happened, in
/// the corpus, where the app renders it next to the records it concerns — so that is what
/// doctor asks for, one exact `ref@ts` at a time. No wildcards, no "everything by this
/// actor": accounting for an orphan costs a sentence about that orphan.
///
/// Both halves of the fix line are state-aware, and both states are read off the disk rather
/// than assumed: `note_exists` picks the verb the accounting command prints (see
/// [`reconcile_command`]) and `record_has_human` decides whether the repair command carries
/// `--human` (see [`repair_command`]).
fn pair_work_updated(
    ev: &Event,
    r: &str,
    line: usize,
    work_notes: &HashMap<String, Vec<String>>,
    accounted: &std::collections::HashSet<String>,
    note_exists: bool,
    record_has_human: bool,
    reconciled: &mut Vec<String>,
) -> Option<Problem> {
    if ev.event_type != "work_updated" {
        return None;
    }
    let stamps = work_notes.get(r)?;
    if stamps.iter().any(|ts| ts == &ev.ts) {
        return None;
    }
    let token = format!("{r}@{}", ev.ts);
    if accounted.contains(&token) {
        reconciled.push(token);
        return None;
    }
    Some(Problem::error(
        format!("events.jsonl:{line}"),
        format!(
            "says a progress note was posted on {r} at {} — the activity feed reads it out as \
             one — but {r} has no `### {}` under `## Updates` ({}). The feed and the record \
             disagree, and the feed is the one a person sees first",
            ev.ts,
            ev.ts,
            if stamps.is_empty() {
                "that record holds no progress notes at all".to_string()
            } else {
                format!("it holds {}, none of them this one", stamps.join(", "))
            }
        ),
        format!(
            "agentmon writes this event and that entry together, so one without the other means \
             a hand or a script wrote half a pair. If the note is real and recoverable, post it: \
             `{}`. If it never existed, or its text is gone and only the event's truncated \
             summary survives, do not invent a body for it — account for it instead, in \
             {RECONCILE_NOTE}: `{}` with a line naming this one as {token} and a sentence on \
             what actually happened",
            repair_command(r, &ev.ts, record_has_human),
            reconcile_command(note_exists)
        ),
    ))
}

/// The command that repairs a recoverable orphan — posting the note the feed already
/// announced, at the timestamp it announced it for.
///
/// `--human` for the same reason as [`reconcile_command`] and one more: this write lands on
/// a **record**, and a record with no `## For humans` cannot take any write that would leave
/// it without one (SPEC.md, "The human area"). That is not a rare state on the project most
/// likely to be reading this hint — `agentmon migrate` leaves every record it converts
/// without a human area until something touches it, and doctor prints its own human-area
/// warning naming that same id a few lines above this error. A fix line that exits 2 on the
/// record it names is not a fix line.
///
/// State-aware rather than always printed, for the mirror-image reason: on a record that
/// already has a human area, `--human "<retelling>"` is not needed and pasting it in would
/// overwrite a retelling somebody wrote with a placeholder — an error traded for a lie. The
/// state is read off the disk, from the same human-area sweep that feeds the warning above.
///
/// The one record this cannot help is the one whose agent area leaves a fence open: no write
/// reaches it at all. That is the error just above, and its fix is the only one here that is
/// not a command.
fn repair_command(r: &str, ts: &str, has_human: bool) -> String {
    if has_human {
        format!("agentmon work update {r} --agent <you> --at {ts} --message \"…\"")
    } else {
        format!(
            "agentmon work update {r} --agent <you> --at {ts} --message \"…\" \
             --human \"<retelling>\""
        )
    }
}

/// The command that accounts for an orphan — the exact line the fix prints, in whichever of
/// the two states the project is actually in.
///
/// The reconciliation note is an ordinary file, so a project meets this problem in one of
/// two states and each has exactly one verb that works. On a project that has never had an
/// orphan there is nothing to update: `note update` reads the file first and exits 3, so a
/// hint naming it hands a reader a dead end on their very first orphan — the common case,
/// every time. Once the note exists, `note add` refuses the name (exit 5), because one fact
/// keeps one file.
///
/// Both carry `--human`. A body written with `--body-file` **replaces** what the note knows,
/// which makes the retelling of the old knowledge stale by definition, so the write path
/// refuses either verb without one (SPEC.md, "The human area") — a fix line that omitted it
/// would exit 2 on a contract this same project enforces. `--description` and the retelling
/// are the reader's to write, which is why they are placeholders and not prose we invented:
/// what the note accounts for is the one thing only the person looking at it knows.
fn reconcile_command(note_exists: bool) -> String {
    if note_exists {
        format!(
            "agentmon note update {RECONCILE_NOTE} --agent <you> --body-file - \
             --human \"<retelling>\""
        )
    } else {
        format!(
            "agentmon note add --name {RECONCILE_NOTE} --agent <you> --type memory \
             --title \"Event reconciliation\" --description \"…\" --body-file - \
             --human \"<retelling>\""
        )
    }
}

/// Where the reconciliation note lives. One expression, because two readers of it — the
/// token scan and the verb the fix line prints — going out of step would print a `note add`
/// over a file that is already there.
fn reconcile_note_path(dir: &Path) -> std::path::PathBuf {
    dir.join("notes").join(format!("{RECONCILE_NOTE}.md"))
}

/// `WORK-NNNN@<ts>` tokens named by the project's reconciliation note. Read straight out of
/// the note body: no frontmatter key, no parser to get out of step with what a person reads
/// on the screen — the token has to be visible in the prose that explains it.
fn accounted_orphans(dir: &Path) -> std::collections::HashSet<String> {
    let path = reconcile_note_path(dir);
    let Ok(raw) = fs::read_to_string(&path) else {
        return std::collections::HashSet::new();
    };
    let mut out = std::collections::HashSet::new();
    // WORK-<digits>@<ISO8601 with no spaces>, wherever it appears — a bullet, a table cell,
    // a sentence. Trailing punctuation is not part of the timestamp.
    for (i, _) in raw.match_indices("WORK-") {
        let tail = &raw[i..];
        let end = tail
            .find(|c: char| c.is_whitespace() || c == ')' || c == ']' || c == ',' || c == '`')
            .unwrap_or(tail.len());
        let token = tail[..end].trim_end_matches(['.', ';', ':', '*', '_']);
        if let Some((id, ts)) = token.split_once('@') {
            if id.len() == 9 && id[5..].chars().all(|c| c.is_ascii_digit()) && check_ts(ts).is_ok() {
                out.insert(token.to_string());
            }
        }
    }
    out
}

/// What the human-area sweep found: which records have no `## For humans` section, and
/// which of those cannot gain one until a person edits the file.
#[derive(Default)]
struct HumanGaps {
    /// Records with no human area — the `missingHuman` list in `--json`.
    missing: Vec<String>,
    /// The subset whose agent area leaves a code fence open, each with the file line the
    /// fence opened on. The write path refuses to add a human area to these (it would be
    /// swallowed by the fence and read back as code), so the repair is a person closing the
    /// fence, not another `--human` — and a person needs the line, not just the id.
    unclosed_fence: Vec<String>,
    /// Records with a single telling past `human::WORDS_MAX`, each with that telling's own
    /// count, so the warning says how far over it is rather than only that it is over.
    long_telling: Vec<String>,
}

/// Note the record if its body carries no human area (SPEC.md, "The human area"), or if
/// one telling inside it runs past the style contract's ceiling.
///
/// `raw` is the whole file and `md` its body: an open fence is reported at the line a
/// person's editor shows, which is the body's line plus the frontmatter above it.
fn note_human(raw: &str, md: &str, id: &str, gaps: &mut HumanGaps) {
    match crate::human::split(md).1 {
        None => {
            gaps.missing.push(id.to_string());
            if let Some(line) = crate::human::open_fence_line(md) {
                let frontmatter = raw.lines().count().saturating_sub(md.lines().count());
                gaps.unclosed_fence.push(format!("{id} (line {})", line + frontmatter));
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

    note_human(&raw, md, &meta.name, gaps);

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
    notes: &mut HashMap<String, Vec<String>>,
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

    note_human(&raw, md, &meta.id, gaps);
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
    // Recorded before the section-by-section checks consume `secs`. A record with no
    // `## Updates` at all is stored as an empty list, not skipped: "this work log holds no
    // progress notes" is precisely the fact the event pairing needs.
    notes.insert(
        meta.id.clone(),
        body::take_section(&mut secs.clone(), "Updates")
            .map(|s| body::work_updates(&s).into_iter().map(|u| u.ts).collect())
            .unwrap_or_default(),
    );
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

    note_human(&raw, md, &meta.id, gaps);
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
