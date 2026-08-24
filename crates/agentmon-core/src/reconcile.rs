//! `agentmon reconcile` — moving the **local** side of an id collision out of the way.
//!
//! Record ids are a per-project sequence allocated from local state: the next work log
//! after `WORK-0010` is `WORK-0011`, on every machine that has the folder. Two machines
//! working one repo offline therefore allocate the same numbers for different work, and the
//! first `git pull` after that finds two different files wanting one path (BUG-0027).
//!
//! Ids stay immutable per project — the app routes by them, refs and prose chips stand on
//! them — so the repair is not a new id scheme. It is this: **the side that has not been
//! pushed yet renumbers**, and everything that pointed at it is rewritten in the same
//! breath. What "everything" means, exactly:
//!
//!   * the record file is renamed, `worklogs/WORK-0011.md` → `worklogs/WORK-0015.md`;
//!   * its frontmatter `id:` follows;
//!   * every `refs:` entry naming it, in every local work log, bug and note;
//!   * every **bare mention in prose**, by the grammar the app linkifies
//!     (`src/lib/markdown-parse.ts`: `\b(?:WORK|BUG)-\d{1,8}\b`) — `[[note-names]]` cannot
//!     take that shape and are never touched;
//!   * `events.jsonl`: the `ref` field exactly, and id mentions inside `summary`.
//!
//! Three rules keep it honest:
//!
//!   1. **Nothing is written without a plan.** The default run computes the whole rewrite
//!      and prints it; `apply` is a second, deliberate call.
//!   2. **A file that is byte-identical to the incoming one is never touched.** That is
//!      what "already synced" means, and a rewrite there would invent a conflict.
//!   3. **Only the local side moves.** The incoming history is read and never written —
//!      it is what the rest of the world already has.
//!
//! The two event logs are merged by **git**, not here: `events.jsonl` is append-only and
//! its readers sort by timestamp, so `merge=union` is exactly right for it, and `apply`
//! installs that rule in `AgentMonitoring/.gitattributes` where it keeps working for every
//! future pull. See docs/AGENT_MANUAL.md, "Two machines, one repo".

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::body;
use crate::error::{CoreError, Result};
use crate::fsx::{self, ProjectLock};
use crate::model::{Bug, Event, Worklog};
use crate::store::{next_id, validate_id, Store};
use crate::time;
use crate::write::EV_PROJECT_UPDATED;

/// The file that teaches git how to merge the event log, written next to it inside the
/// folder agentmon owns, so it travels with the records and needs no repo-wide setup.
pub const GITATTRIBUTES: &str = ".gitattributes";

/// The one rule in it. `union` is built into git: on a conflicting hunk it keeps both
/// sides' lines instead of writing conflict markers — which for an append-only log whose
/// readers sort by `ts` is not a compromise, it is the correct merge.
pub const UNION_RULE: &str = "events.jsonl merge=union";

/// What a reconcile run was asked to do.
#[derive(Debug, Clone)]
pub struct ReconcileRequest {
    /// The incoming `AgentMonitoring` folder (or the directory holding one): a fetched
    /// worktree of the branch you are about to merge, or the other machine's clone.
    pub theirs: PathBuf,
    /// Write the plan out. `false` computes and returns it, touching nothing.
    pub apply: bool,
    /// Re-key exactly these local ids instead of the detected set — the override for a
    /// record reconcile classified wrong. Empty means "whatever collides".
    pub only: Vec<String>,
    /// Who is doing this; recorded as the actor of the one event a re-key logs.
    pub actor: String,
    /// `--at` for that event. `None` means now.
    pub at: Option<String>,
    /// Install the `merge=union` rule for `events.jsonl`. On by default; off for a repo
    /// that manages its own attributes.
    pub gitattributes: bool,
}

impl Default for ReconcileRequest {
    fn default() -> Self {
        ReconcileRequest {
            theirs: PathBuf::new(),
            apply: false,
            only: Vec::new(),
            actor: String::new(),
            at: None,
            gitattributes: true,
        }
    }
}

/// One id that moves, with both records named so a reader can see the plan is right before
/// anything is written — the local title and the incoming title are the evidence that these
/// really are two different pieces of work wearing one number.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    pub from: String,
    pub to: String,
    /// `work` or `bug`.
    pub kind: &'static str,
    pub local_title: String,
    pub local_agent: String,
    pub local_at: String,
    pub incoming_title: String,
    pub incoming_agent: String,
    pub incoming_at: String,
}

/// A file the re-key rewrites. `renamed_to` is set only for the moved records themselves.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRewrite {
    /// Relative to the project folder, e.g. `worklogs/WORK-0011.md`.
    pub path: String,
    pub renamed_to: Option<String>,
    /// How many id tokens change in it (frontmatter `id`, `refs` entries and prose alike).
    pub mentions: usize,
    #[serde(skip)]
    from: PathBuf,
    #[serde(skip)]
    to: PathBuf,
    #[serde(skip)]
    text: String,
}

/// What happens to `events.jsonl`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRewrite {
    /// Lines whose `ref` field names a moved record.
    pub refs: usize,
    /// Lines whose `summary` mentions one in prose.
    pub summaries: usize,
    pub total_lines: usize,
    #[serde(skip)]
    text: Option<String>,
}

/// An id that was looked at and left alone, and why — `identical` (the two files are the
/// same bytes: already synced), `diverged` (the same record edited on both sides: an
/// ordinary content merge, not a collision) or `not-selected` (`--only` named others).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub id: String,
    pub reason: &'static str,
    pub detail: String,
}

/// What `.gitattributes` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitAttributes {
    Created,
    Appended,
    AlreadyPresent,
    Skipped,
}

/// The plan — printed by a dry run, and returned by an applied one as the account of what
/// happened. This is the exact shape `--json` prints, so it is a contract.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcilePlan {
    pub ok: bool,
    /// `false` on a dry run: nothing on disk changed.
    pub applied: bool,
    pub local: String,
    pub incoming: String,
    pub mappings: Vec<Mapping>,
    pub files: Vec<FileRewrite>,
    pub events: EventRewrite,
    pub skipped: Vec<Skipped>,
    pub gitattributes: GitAttributes,
    /// The `project_updated` line a re-key logs. `None` on a dry run, and on a run that
    /// moved nothing — the feed is for things that happened.
    pub event: Option<Event>,
}

impl ReconcilePlan {
    /// Does this plan change anything on disk?
    pub fn is_empty(&self) -> bool {
        self.mappings.is_empty()
    }
}

// ---------------------------------------------------------------------------
// the entry point
// ---------------------------------------------------------------------------

pub fn reconcile(store: &Store, req: &ReconcileRequest) -> Result<ReconcilePlan> {
    let local_dir = store.root().to_path_buf();
    let theirs = Store::open(&req.theirs)?;
    let their_dir = theirs.root().to_path_buf();

    if local_dir == their_dir {
        return Err(CoreError::conflict(
            format!("--theirs points at this project itself ({})", their_dir.display()),
            "pass the *incoming* copy: a worktree of the branch you are about to merge \
             (`git worktree add ../incoming origin/main`, then --theirs \
             ../incoming/AgentMonitoring), or the other machine's clone",
        ));
    }
    // Two folders that were never the same project have no id collisions to speak of —
    // they have two different numbering schemes, and re-keying one against the other would
    // renumber records for no reason at all.
    let local_project = store.project()?;
    let their_project = theirs.project()?;
    if local_project.id != their_project.id {
        return Err(CoreError::conflict(
            format!(
                "these are different projects: this folder is {} (\"{}\") and --theirs is {} (\"{}\")",
                local_project.id, local_project.name, their_project.id, their_project.name
            ),
            "reconcile repairs one project whose records were written on two machines. \
             Point --theirs at the same project's folder — the id in project.json has to match",
        ));
    }

    // Everything from here reads and then writes the same files, so an applying run holds
    // the project lock across both halves: the plan a caller sees is the plan that ran.
    let _lock = if req.apply {
        Some(ProjectLock::acquire(&local_dir)?)
    } else {
        None
    };

    let only = normalize_only(&req.only)?;
    let mut mappings: Vec<Mapping> = Vec::new();
    let mut skipped: Vec<Skipped> = Vec::new();

    for (kind, sub, prefix) in [("work", "worklogs", "WORK"), ("bug", "bugs", "BUG")] {
        let local_ids = record_ids(&local_dir.join(sub), prefix)?;
        let their_ids = record_ids(&their_dir.join(sub), prefix)?;
        // The next free number has to be free on **both** sides, or the re-key just moves
        // the collision along. Every id either machine has ever used is taken.
        let mut taken: Vec<String> = local_ids.clone();
        taken.extend(their_ids.iter().cloned());

        let mut moving: Vec<String> = Vec::new();
        for id in &local_ids {
            if !their_ids.iter().any(|t| t == id) {
                continue; // local-only: nothing wants that number
            }
            let ours = read_record(&local_dir.join(sub).join(format!("{id}.md")))?;
            let theirs_raw = read_record(&their_dir.join(sub).join(format!("{id}.md")))?;
            let selected = only.is_empty() || only.iter().any(|o| o == id);

            if normalize_newlines(&ours) == normalize_newlines(&theirs_raw) {
                // Already synced. Re-keying it would split one record into two, so this is
                // the one case that refuses outright when a caller asks for it by name.
                if !only.is_empty() && selected {
                    return Err(CoreError::conflict(
                        format!("{id} is byte-identical on both sides — it is already synced"),
                        "re-keying it would turn one record into two copies of itself. \
                         Drop it from --only; a `git pull` brings nothing new for that id",
                    ));
                }
                skipped.push(Skipped {
                    id: id.clone(),
                    reason: "identical",
                    detail: "the same bytes on both sides — already synced".into(),
                });
                continue;
            }

            let ours_id = identity(&ours, prefix, &local_dir.join(sub).join(format!("{id}.md")))?;
            let their_id = identity(
                &theirs_raw,
                prefix,
                &their_dir.join(sub).join(format!("{id}.md")),
            )?;
            let same_record = ours_id == their_id;

            if !selected {
                skipped.push(Skipped {
                    id: id.clone(),
                    reason: "not-selected",
                    detail: "--only named other ids".into(),
                });
                continue;
            }
            if same_record && only.is_empty() {
                // One record, edited on both machines: the ids mean the same thing, so this
                // is an ordinary content merge and git is the tool for it. Re-keying here
                // would fork a record's history in two, which is worse than a conflict.
                skipped.push(Skipped {
                    id: id.clone(),
                    reason: "diverged",
                    detail: format!(
                        "the same record ({}, {}, {}) edited on both sides — merge the \
                         content, do not re-key",
                        ours_id.0, ours_id.1, ours_id.2
                    ),
                });
                continue;
            }
            moving.push(id.clone());
        }

        for id in moving {
            let ours = read_record(&local_dir.join(sub).join(format!("{id}.md")))?;
            let theirs_raw = read_record(&their_dir.join(sub).join(format!("{id}.md")))?;
            let (lt, la, lat) = identity(&ours, prefix, Path::new(&id))?;
            let (it, ia, iat) = identity(&theirs_raw, prefix, Path::new(&id))?;
            let to = next_free(&mut taken, prefix);
            mappings.push(Mapping {
                from: id,
                to,
                kind,
                local_title: lt,
                local_agent: la,
                local_at: lat,
                incoming_title: it,
                incoming_agent: ia,
                incoming_at: iat,
            });
        }
    }

    // An --only id that named nothing is a typo, and a typo that silently does nothing on a
    // history-rewriting command is the worst kind.
    for want in &only {
        let known = mappings.iter().any(|m| &m.from == want)
            || skipped.iter().any(|s| &s.id == want);
        if !known {
            return Err(CoreError::conflict(
                format!("--only names {want}, which is not a colliding id here"),
                "--only selects among the ids this project and --theirs both hold with \
                 different content. Run the command without it to see that list",
            ));
        }
    }

    let map: BTreeMap<String, String> = mappings
        .iter()
        .map(|m| (m.from.clone(), m.to.clone()))
        .collect();

    // The targets must be free on both sides. They are, by construction (allocated above
    // every number either machine has used), so this is a guard against the construction
    // being wrong rather than against the data — but it runs before a single byte moves.
    for m in &mappings {
        let sub = if m.kind == "work" { "worklogs" } else { "bugs" };
        for dir in [&local_dir, &their_dir] {
            let p = dir.join(sub).join(format!("{}.md", m.to));
            if p.exists() {
                return Err(CoreError::conflict(
                    format!(
                        "{} would move to {}, and {} already exists",
                        m.from,
                        m.to,
                        p.display()
                    ),
                    "re-run without --only, or report this: the next free id is computed \
                     from both sides and should never land on a file that is there",
                ));
            }
        }
    }

    let files = plan_files(&local_dir, &their_dir, &map)?;
    let events = plan_events(&local_dir, &map)?;

    let mut plan = ReconcilePlan {
        ok: true,
        applied: false,
        local: local_dir.display().to_string(),
        incoming: their_dir.display().to_string(),
        mappings,
        files,
        events,
        skipped,
        gitattributes: GitAttributes::Skipped,
        event: None,
    };

    if !req.apply {
        return Ok(plan);
    }

    // -- apply --------------------------------------------------------------
    //
    // New files first, old ones after: a crash between the two leaves a duplicate that
    // `agentmon doctor` names loudly, never a record that is simply gone.
    for f in &plan.files {
        if f.renamed_to.is_some() {
            if !fsx::write_new(&f.to, &f.text)? {
                return Err(CoreError::conflict(
                    format!("{} appeared while reconcile was running", f.to.display()),
                    "another process is writing to this project — re-run reconcile against \
                     a quiet folder",
                ));
            }
        } else {
            fsx::write_atomic(&f.to, &f.text)?;
        }
    }
    for f in &plan.files {
        if f.renamed_to.is_some() {
            fs::remove_file(&f.from).map_err(|e| CoreError::io(&f.from, e))?;
        }
    }
    if let Some(text) = plan.events.text.clone() {
        fsx::write_atomic(&local_dir.join("events.jsonl"), &text)?;
    }
    if req.gitattributes {
        plan.gitattributes = write_gitattributes(&local_dir)?;
    }
    if !plan.mappings.is_empty() {
        let ts = time::stamp(req.at.as_deref(), "--at")?;
        let actor = req.actor.trim();
        let actor = if actor.is_empty() { "agentmon" } else { actor };
        let moved: Vec<String> = plan
            .mappings
            .iter()
            .map(|m| format!("{} → {}", m.from, m.to))
            .collect();
        let summary = format!(
            "Reconciled {} colliding record id{} against the incoming history: {}",
            plan.mappings.len(),
            if plan.mappings.len() == 1 { "" } else { "s" },
            moved.join(", ")
        );
        plan.event = Some(store.append_event_at(actor, EV_PROJECT_UPDATED, None, &summary, &ts)?);
    }
    plan.applied = true;
    Ok(plan)
}

// ---------------------------------------------------------------------------
// the rewrite
// ---------------------------------------------------------------------------

/// Every local record file that changes, with its new text already rendered.
fn plan_files(
    local_dir: &Path,
    their_dir: &Path,
    map: &BTreeMap<String, String>,
) -> Result<Vec<FileRewrite>> {
    let mut out: Vec<FileRewrite> = Vec::new();
    if map.is_empty() {
        return Ok(out);
    }
    for sub in ["worklogs", "bugs", "notes"] {
        for path in md_files(&local_dir.join(sub)) {
            let name = file_name(&path);
            let stem = name.trim_end_matches(".md").to_string();
            let moves_to = map.get(&stem).cloned();
            let raw = read_record(&path)?;

            // Rule 2: a file the incoming side already has, byte for byte, is not ours to
            // rewrite — it is the shared history, and touching it would invent a conflict.
            // (A record that is being re-keyed can never be in this state; it is here
            // *because* the two sides differ.)
            if moves_to.is_none() {
                if let Ok(theirs) = fs::read_to_string(their_dir.join(sub).join(&name)) {
                    if normalize_newlines(&raw) == normalize_newlines(&theirs) {
                        continue;
                    }
                }
            }

            let (text, mentions) = rewrite_ids(&raw, map);
            if mentions == 0 && moves_to.is_none() {
                continue;
            }
            let to = match &moves_to {
                Some(new_id) => path.with_file_name(format!("{new_id}.md")),
                None => path.clone(),
            };
            out.push(FileRewrite {
                path: format!("{sub}/{name}"),
                renamed_to: moves_to.map(|id| format!("{sub}/{id}.md")),
                mentions,
                from: path,
                to,
                text,
            });
        }
    }
    Ok(out)
}

/// `events.jsonl`, rewritten line by line.
///
/// The rewrite is textual on purpose. An event line may carry keys this build has never
/// heard of (SPEC.md: parsing is lenient, forward compatibility is a promise), and
/// re-serializing a parsed struct would drop them. A record id contains nothing JSON
/// escapes, so the token in the raw line *is* the token in the field.
fn plan_events(local_dir: &Path, map: &BTreeMap<String, String>) -> Result<EventRewrite> {
    let path = local_dir.join("events.jsonl");
    let mut out = EventRewrite::default();
    if map.is_empty() || !path.is_file() {
        return Ok(out);
    }
    let raw = read_record(&path)?;
    let eol = if raw.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = Vec::new();
    let mut changed = false;
    for line in raw.lines() {
        out.total_lines += 1;
        // A line no reader can parse is left exactly as it is: doctor reports it, and
        // guessing at its shape here would turn one broken line into two.
        let Ok(ev) = serde_json::from_str::<Event>(line) else {
            lines.push(line.to_string());
            continue;
        };
        if ev.r#ref.as_deref().map(|r| map.contains_key(r)).unwrap_or(false) {
            out.refs += 1;
        }
        if rewrite_ids(&ev.summary, map).1 > 0 {
            out.summaries += 1;
        }
        let (rewritten, n) = rewrite_ids(line, map);
        if n > 0 {
            changed = true;
        }
        lines.push(rewritten);
    }
    if changed {
        let mut text = lines.join(eol);
        text.push_str(eol);
        out.text = Some(text);
    }
    Ok(out)
}

/// Rewrite every record id in `text` that the map moves, by the grammar the app linkifies
/// (`src/lib/markdown-parse.ts`): `\b(?:WORK|BUG)-\d{1,8}\b`, uppercase, word-bounded.
///
/// One pass, looking each token up as it is found, so a chain (`WORK-0011`→`WORK-0015`
/// while `WORK-0015`→`WORK-0019`) can never be applied twice to the same token.
///
/// Inside code spans and fences too. The app does not *link* an id there, but a record that
/// quotes `agentmon work update WORK-0011 …` is quoting a command that stopped being true
/// the moment the record moved, and leaving it right beside the rewritten prose would be
/// the one place a reader is told the old number.
pub(crate) fn rewrite_ids(text: &str, map: &BTreeMap<String, String>) -> (String, usize) {
    if map.is_empty() || text.is_empty() {
        return (text.to_string(), 0);
    }
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    let mut count = 0usize;
    let mut i = 0usize;
    while i < b.len() {
        // A byte equal to `W`/`B` is ASCII, so it is always a char boundary: slicing here
        // is safe whatever else the text is written in.
        let prefix_len = if b[i] == b'W' && text[i..].starts_with("WORK-") {
            5
        } else if b[i] == b'B' && text[i..].starts_with("BUG-") {
            4
        } else {
            i += 1;
            continue;
        };
        // `\b` before the prefix: the character in front may not be a word character.
        if i > 0 && is_word(b[i - 1]) {
            i += 1;
            continue;
        }
        let ds = i + prefix_len;
        let mut de = ds;
        while de < b.len() && b[de].is_ascii_digit() {
            de += 1;
        }
        // 1–8 digits, and `\b` after them: a longer run, or a letter welded to the end,
        // is a different token and the app does not link it either.
        if de == ds || de - ds > 8 || (de < b.len() && is_word(b[de])) {
            i = de.max(i + 1);
            continue;
        }
        if let Some(new) = map.get(&text[i..de]) {
            out.push_str(&text[last..i]);
            out.push_str(new);
            last = de;
            count += 1;
        }
        i = de;
    }
    if count == 0 {
        return (text.to_string(), 0);
    }
    out.push_str(&text[last..]);
    (out, count)
}

/// JavaScript's `\w`, which is what the app's regex boundaries are measured in: ASCII
/// letters, digits and `_`. Everything else — including every non-Latin letter — is a
/// boundary there, so it is a boundary here.
fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Add the union rule to `AgentMonitoring/.gitattributes`, creating the file if needed and
/// never touching a rule that is already there.
fn write_gitattributes(dir: &Path) -> Result<GitAttributes> {
    let path = dir.join(GITATTRIBUTES);
    let line = format!("# events.jsonl is append-only and its readers sort by timestamp,\n# so both sides' lines are the correct merge (agentmon reconcile).\n{UNION_RULE}\n");
    match fs::read_to_string(&path) {
        Ok(existing) => {
            if existing
                .lines()
                .any(|l| l.trim() == UNION_RULE || l.trim().starts_with("events.jsonl merge="))
            {
                return Ok(GitAttributes::AlreadyPresent);
            }
            let mut text = existing;
            if !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(&line);
            fsx::write_atomic(&path, &text)?;
            Ok(GitAttributes::Appended)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fsx::write_atomic(&path, &line)?;
            Ok(GitAttributes::Created)
        }
        Err(e) => Err(CoreError::io(&path, e)),
    }
}

/// What makes a record *that* record rather than another one with the same number: its
/// title, who wrote it, and when it began. None of the three is ever rewritten by an
/// agentmon verb, so two files that agree on all three are one record that was edited on
/// two machines — and two files that do not are two different pieces of work.
fn identity(raw: &str, prefix: &str, path: &Path) -> Result<(String, String, String)> {
    let (fm, _) = body::split_frontmatter(raw).ok_or_else(|| {
        CoreError::malformed(
            path,
            "missing YAML frontmatter — reconcile will not renumber a file it cannot read",
        )
    })?;
    if prefix == "WORK" {
        let meta: Worklog = serde_yaml::from_str(fm).map_err(|e| {
            CoreError::malformed(path, format!("invalid worklog frontmatter: {e}"))
        })?;
        Ok((meta.title, meta.agent, meta.started))
    } else {
        let meta: Bug = serde_yaml::from_str(fm)
            .map_err(|e| CoreError::malformed(path, format!("invalid bug frontmatter: {e}")))?;
        Ok((meta.title, meta.reporter, meta.created))
    }
}

fn next_free(taken: &mut Vec<String>, prefix: &str) -> String {
    let id = next_id(taken, prefix);
    taken.push(id.clone());
    id
}

fn normalize_only(only: &[String]) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for raw in only {
        let v = raw.trim();
        if v.is_empty() {
            continue;
        }
        let upper = v.to_ascii_uppercase();
        let id = if upper.starts_with("WORK-") {
            validate_id(&upper, "WORK")?
        } else if upper.starts_with("BUG-") {
            validate_id(&upper, "BUG")?
        } else {
            return Err(CoreError::InvalidId {
                id: raw.clone(),
                expected: "WORK-NNNN or BUG-NNNN — --only names records, and only a work \
                           log or a bug carries a number that can collide"
                    .into(),
            });
        };
        if !out.contains(&id) {
            out.push(id);
        }
    }
    Ok(out)
}

/// Ids present in a directory, read from file names and sorted — the same rule the writer
/// allocates by, so a record whose frontmatter is unreadable still holds its number.
fn record_ids(dir: &Path, prefix: &str) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir).map_err(|e| CoreError::io(dir, e))? {
        let entry = entry.map_err(|e| CoreError::io(dir, e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(stem) = name.strip_suffix(".md") else {
            continue;
        };
        if !stem.starts_with(prefix) || name.starts_with('.') {
            continue;
        }
        if let Ok(id) = validate_id(stem, prefix) {
            if id == stem && !out.contains(&id) {
                out.push(id);
            }
        }
    }
    out.sort();
    Ok(out)
}

fn md_files(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_file() && name.ends_with(".md") && !name.starts_with('.') {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn read_record(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|e| CoreError::io(path, e))
}

/// Two clones of one repo can hold the same record with different line endings
/// (`core.autocrlf`), and "the same bytes" has to mean the same record, not the same
/// checkout setting.
fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
    }

    #[test]
    fn rewrites_the_ids_the_app_would_link_and_nothing_else() {
        let m = map(&[("WORK-0011", "WORK-0015"), ("BUG-0006", "BUG-0009")]);
        let (out, n) = rewrite_ids(
            "Refs WORK-0011 and BUG-0006, see (WORK-0011). Not: WORK-0011x, xWORK-0011, \
             WORK-00110, work-0011, WORK-0012, [[work-notes]].",
            &m,
        );
        assert_eq!(n, 3, "three linkable mentions: {out}");
        assert!(out.starts_with("Refs WORK-0015 and BUG-0009, see (WORK-0015)."), "{out}");
        assert!(out.contains("WORK-0011x"), "a letter welded on is another token: {out}");
        assert!(out.contains("xWORK-0011"), "no boundary in front: {out}");
        assert!(out.contains("WORK-00110"), "more digits is another id: {out}");
        assert!(out.contains("work-0011"), "lowercase is not the linked shape: {out}");
        assert!(out.contains("WORK-0012"), "an id nobody moved: {out}");
        assert!(out.contains("[[work-notes]]"), "note links are untouched: {out}");
    }

    #[test]
    fn a_chain_is_applied_once_per_token() {
        // The exact shape a second reconcile round produces: what moves into 0015 must not
        // be carried on into 0019 by the same pass.
        let m = map(&[("WORK-0011", "WORK-0015"), ("WORK-0015", "WORK-0019")]);
        let (out, n) = rewrite_ids("WORK-0011 → ? and WORK-0015 → ?", &m);
        assert_eq!(out, "WORK-0015 → ? and WORK-0019 → ?");
        assert_eq!(n, 2);
    }

    #[test]
    fn rewrites_frontmatter_refs_and_json_lines_the_same_way() {
        let m = map(&[("WORK-0011", "WORK-0015")]);
        let (fm, n) = rewrite_ids("id: WORK-0011\nrefs: [WORK-0011, BUG-0002]\n", &m);
        assert_eq!(fm, "id: WORK-0015\nrefs: [WORK-0015, BUG-0002]\n");
        assert_eq!(n, 2);

        let line = r#"{"ts":"2026-08-22T04:10:00Z","actor":"a","type":"work_started","ref":"WORK-0011","summary":"Follows WORK-0011"}"#;
        let (out, n) = rewrite_ids(line, &m);
        assert_eq!(n, 2);
        let ev: Event = serde_json::from_str(&out).expect("still one JSON object");
        assert_eq!(ev.r#ref.as_deref(), Some("WORK-0015"));
        assert_eq!(ev.summary, "Follows WORK-0015");
    }

    #[test]
    fn non_ascii_neighbours_are_boundaries_exactly_as_they_are_in_the_app() {
        let m = map(&[("WORK-0011", "WORK-0015")]);
        let (out, n) = rewrite_ids("한국어 WORK-0011를 참조", &m);
        assert_eq!(n, 1, "{out}");
        assert_eq!(out, "한국어 WORK-0015를 참조");
    }

    #[test]
    fn an_empty_map_is_a_verbatim_copy() {
        let (out, n) = rewrite_ids("WORK-0011 stays put", &BTreeMap::new());
        assert_eq!(out, "WORK-0011 stays put");
        assert_eq!(n, 0);
    }
}
