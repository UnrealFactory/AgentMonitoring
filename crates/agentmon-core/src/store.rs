//! Reading a project's `AgentMonitoring` folder from disk. Every path the caller can
//! influence (record id) is validated before it touches the filesystem — ids arrive from
//! URLs and from agent-supplied CLI arguments, so `../` must never resolve to anything.
//!
//! One `Store` is one open project: the folder named [`DATA_DIR`] that sits inside
//! whatever directory the human picked (typically a code repo root). There is no vault
//! and no slug — the folder *is* the project, exactly the way `.git` is the repository.

use std::fs;
use std::path::{Path, PathBuf};

use crate::body;
use crate::error::{CoreError, Result};
use crate::model::*;

/// The one folder name this app owns. Discovery (walking up from cwd, "is this already a
/// project?") is a string comparison on this constant, which is why it is a constant.
pub const DATA_DIR: &str = "AgentMonitoring";

/// Extensions a record body may reference as an image. `<img>` is the only surface these
/// reach, and `<img>` executes nothing — which is the property the whole feature rests on.
pub const ASSET_EXTENSIONS: &[&str] = &["svg", "png", "jpg", "jpeg", "gif", "webp"];

/// The largest file [`Store::asset`] hands over. Diagrams are kilobytes; the cap is about
/// not marshalling a mistaken screen recording through the IPC.
pub const ASSET_MAX_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Store {
    /// The `AgentMonitoring` directory itself.
    root: PathBuf,
    source: String,
}

impl Store {
    /// `--dir` flag > `AGENTMON_DIR` env > walk up from cwd (SPEC.md, "resolution").
    ///
    /// The walk is exactly how `git` finds `.git`: from the current directory upward,
    /// the first `AgentMonitoring/project.json` wins. An agent working inside a repo
    /// therefore needs no flags at all.
    pub fn resolve(explicit: Option<&Path>) -> Result<Store> {
        if let Some(p) = explicit {
            return Store::open_with_source(p, "flag");
        }
        if let Some(env) = std::env::var_os("AGENTMON_DIR") {
            return Store::open_with_source(Path::new(&env), "env");
        }
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut probe: Option<&Path> = Some(cwd.as_path());
        while let Some(dir) = probe {
            let cand = dir.join(DATA_DIR);
            if cand.join("project.json").is_file() {
                return Store::open_with_source(&cand, "walk");
            }
            probe = dir.parent();
        }
        Err(CoreError::ProjectDirNotFound {
            path: cwd.clone(),
            hint: format!(
                "no {DATA_DIR}/project.json here or in any parent directory. Run from inside \
                 a project, pass --dir <folder>, set AGENTMON_DIR, or create one with \
                 `agentmon init --name \"<project name>\"`."
            ),
        })
    }

    /// Open a project folder: either the `AgentMonitoring` directory itself, or the
    /// directory that contains one (the location the human picked).
    pub fn open(path: impl AsRef<Path>) -> Result<Store> {
        Store::open_with_source(path.as_ref(), "flag")
    }

    pub fn open_with_source(path: &Path, source: &str) -> Result<Store> {
        let path = normalize(path);
        let root = if path.join("project.json").is_file() {
            path
        } else if path.join(DATA_DIR).join("project.json").is_file() {
            path.join(DATA_DIR)
        } else {
            return Err(CoreError::ProjectDirNotFound {
                path,
                hint: format!(
                    "no {DATA_DIR}/project.json in that directory. Pick the folder that holds \
                     the {DATA_DIR} folder, or create a project there with \
                     `agentmon init --dir <folder> --name \"<project name>\"`."
                ),
            });
        };
        let store = Store {
            root,
            source: source.to_string(),
        };
        store.require_v2()?;
        Ok(store)
    }

    /// v1 vault data is not read by this build — `agentmon migrate` is the bridge. A
    /// `project.json` without `"version": 2` gets that answer instead of half-rendering.
    fn require_v2(&self) -> Result<()> {
        let path = self.root.join("project.json");
        let raw = read_to_string(&path)?;
        let json: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| CoreError::malformed(&path, format!("invalid project.json: {e}")))?;
        let version = json.get("version").and_then(|v| v.as_u64()).unwrap_or(1);
        if version != crate::SCHEMA_VERSION as u64 {
            return Err(CoreError::malformed(
                &path,
                format!(
                    "schema version is {version} but this build of agentmon speaks v{}. \
                     Old vault data is moved forward with `agentmon migrate --from <vault> \
                     --project <slug> --to <folder>`",
                    crate::SCHEMA_VERSION
                ),
            ));
        }
        Ok(())
    }

    /// The `AgentMonitoring` directory this store reads and writes.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The directory the human picked — the parent that holds [`DATA_DIR`].
    pub fn location(&self) -> &Path {
        self.root.parent().unwrap_or(&self.root)
    }

    // -- project.json --------------------------------------------------------

    pub fn project(&self) -> Result<Project> {
        let path = self.root.join("project.json");
        let raw = read_to_string(&path)?;
        let mut project: Project = serde_json::from_str(&raw)
            .map_err(|e| CoreError::malformed(&path, format!("invalid project.json: {e}")))?;
        project.counts = self.counts()?;
        project.path = self.root.display().to_string();
        project.source = self.source.clone();
        Ok(project)
    }

    fn counts(&self) -> Result<ProjectCounts> {
        let works = self.worklogs()?;
        let bugs = self.bugs()?;
        let notes = self.notes()?;
        let events = self.events(None)?;
        let mut last = String::new();
        for w in &works {
            if w.last_activity > last {
                last = w.last_activity.clone();
            }
        }
        for b in &bugs {
            if b.last_activity > last {
                last = b.last_activity.clone();
            }
        }
        for n in &notes {
            if n.last_activity > last {
                last = n.last_activity.clone();
            }
        }
        if let Some(e) = events.first() {
            if e.ts > last {
                last = e.ts.clone();
            }
        }
        Ok(ProjectCounts {
            work_total: works.len(),
            work_in_progress: works
                .iter()
                .filter(|w| w.meta.status == WorkStatus::InProgress)
                .count(),
            work_done: works
                .iter()
                .filter(|w| w.meta.status == WorkStatus::Done)
                .count(),
            bugs_total: bugs.len(),
            bugs_open: bugs.iter().filter(|b| b.meta.status.is_open()).count(),
            notes_total: notes.len(),
            events: events.len(),
            last_activity: if last.is_empty() { None } else { Some(last) },
        })
    }

    // -- worklogs -----------------------------------------------------------

    pub fn worklogs(&self) -> Result<Vec<WorklogSummary>> {
        let dir = self.root.join("worklogs");
        let mut out: Vec<WorklogSummary> = Vec::new();
        for path in record_files(&dir, "WORK-")? {
            let detail = self.parse_worklog(&path)?;
            let mut parts: Vec<&str> = vec![&detail.what, &detail.why, &detail.how];
            parts.extend(detail.updates.iter().map(|u| u.body.as_str()));
            if let Some(o) = &detail.outcome {
                parts.push(o);
            }
            parts.extend(detail.extra_sections.iter().map(|s| s.body.as_str()));
            out.push(WorklogSummary {
                excerpt: body::excerpt(&detail.what, 180),
                search_text: body::search_text(&parts),
                update_count: detail.updates.len(),
                last_activity: detail.last_activity.clone(),
                meta: detail.meta,
            });
        }
        out.sort_by(|a, b| b.last_activity.cmp(&a.last_activity).then_with(|| b.meta.id.cmp(&a.meta.id)));
        Ok(out)
    }

    pub fn worklog(&self, id: &str) -> Result<WorklogDetail> {
        let id = validate_id(id, "WORK")?;
        let path = self.root.join("worklogs").join(format!("{id}.md"));
        if !path.is_file() {
            return Err(CoreError::RecordNotFound {
                id: id.to_string(),
                path,
            });
        }
        self.parse_worklog(&path)
    }

    fn parse_worklog(&self, path: &Path) -> Result<WorklogDetail> {
        let raw = read_to_string(path)?;
        let (fm, md) = body::split_frontmatter(&raw).ok_or_else(|| {
            CoreError::malformed(
                path,
                "missing YAML frontmatter — a worklog must start with a `---` fenced block (see SPEC.md)",
            )
        })?;
        let meta: Worklog = serde_yaml::from_str(fm)
            .map_err(|e| CoreError::malformed(path, format!("invalid worklog frontmatter: {e}")))?;

        let mut secs = body::sections(md);
        secs.retain(|s| !(s.title.is_empty() && s.body.trim().is_empty()));
        let what = body::take_section(&mut secs, "What").unwrap_or_default();
        let why = body::take_section(&mut secs, "Why").unwrap_or_default();
        let how = body::take_section(&mut secs, "How").unwrap_or_default();
        let updates = body::take_section(&mut secs, "Updates")
            .map(|s| body::work_updates(&s))
            .unwrap_or_default();
        let outcome = body::take_section(&mut secs, "Outcome").filter(|s| !s.trim().is_empty());

        let mut last = meta.started.clone();
        if let Some(f) = &meta.finished {
            if *f > last {
                last = f.clone();
            }
        }
        for u in &updates {
            if u.ts > last {
                last = u.ts.clone();
            }
        }

        Ok(WorklogDetail {
            meta,
            what,
            why,
            how,
            updates,
            outcome,
            extra_sections: secs,
            body: md.trim().to_string(),
            last_activity: last,
        })
    }

    // -- bugs ---------------------------------------------------------------

    pub fn bugs(&self) -> Result<Vec<BugSummary>> {
        let dir = self.root.join("bugs");
        let mut out: Vec<BugSummary> = Vec::new();
        for path in record_files(&dir, "BUG-")? {
            let detail = self.parse_bug(&path)?;
            let mut parts: Vec<&str> = vec![&detail.report];
            for c in &detail.comments {
                // the commenter's name too: a bug is often remembered by who answered on it
                parts.push(&c.agent);
                parts.push(&c.body);
            }
            if let Some(r) = &detail.resolution {
                parts.push(r);
            }
            parts.extend(detail.extra_sections.iter().map(|s| s.body.as_str()));
            out.push(BugSummary {
                excerpt: body::excerpt(&detail.report, 180),
                search_text: body::search_text(&parts),
                comment_count: detail.comments.len(),
                last_activity: detail.last_activity.clone(),
                meta: detail.meta,
            });
        }
        out.sort_by(|a, b| {
            b.meta
                .status
                .is_open()
                .cmp(&a.meta.status.is_open())
                .then_with(|| a.meta.severity.cmp(&b.meta.severity))
                .then_with(|| b.last_activity.cmp(&a.last_activity))
        });
        Ok(out)
    }

    pub fn bug(&self, id: &str) -> Result<BugDetail> {
        let id = validate_id(id, "BUG")?;
        let path = self.root.join("bugs").join(format!("{id}.md"));
        if !path.is_file() {
            return Err(CoreError::RecordNotFound {
                id: id.to_string(),
                path,
            });
        }
        self.parse_bug(&path)
    }

    fn parse_bug(&self, path: &Path) -> Result<BugDetail> {
        let raw = read_to_string(path)?;
        let (fm, md) = body::split_frontmatter(&raw).ok_or_else(|| {
            CoreError::malformed(
                path,
                "missing YAML frontmatter — a bug must start with a `---` fenced block (see SPEC.md)",
            )
        })?;
        let meta: Bug = serde_yaml::from_str(fm)
            .map_err(|e| CoreError::malformed(path, format!("invalid bug frontmatter: {e}")))?;

        let mut secs = body::sections(md);
        secs.retain(|s| !(s.title.is_empty() && s.body.trim().is_empty()));
        let report = body::take_section(&mut secs, "Report").unwrap_or_default();
        let comments = body::take_section(&mut secs, "Comments")
            .map(|s| body::bug_comments(&s))
            .unwrap_or_default();
        let resolution =
            body::take_section(&mut secs, "Resolution").filter(|s| !s.trim().is_empty());

        let mut last = meta.created.clone();
        for t in [&meta.claimed, &meta.resolved].into_iter().flatten() {
            if *t > last {
                last = t.clone();
            }
        }
        for c in &comments {
            if c.ts > last {
                last = c.ts.clone();
            }
        }

        Ok(BugDetail {
            meta,
            report,
            comments,
            resolution,
            extra_sections: secs,
            body: md.trim().to_string(),
            last_activity: last,
        })
    }

    // -- notes --------------------------------------------------------------

    /// Every note, most recently updated first — the order an arriving agent wants,
    /// because the newest handoff is the one addressed to it.
    pub fn notes(&self) -> Result<Vec<NoteSummary>> {
        let dir = self.root.join("notes");
        let mut out: Vec<NoteSummary> = Vec::new();
        for path in record_files(&dir, "")? {
            let detail = self.parse_note(&path)?;
            out.push(NoteSummary {
                excerpt: body::excerpt(&detail.body, 180),
                search_text: body::search_text(&[
                    &detail.meta.description,
                    &detail.body,
                    &detail.meta.tags.join(" "),
                ]),
                last_activity: detail.last_activity.clone(),
                meta: detail.meta,
            });
        }
        out.sort_by(|a, b| {
            b.last_activity
                .cmp(&a.last_activity)
                .then_with(|| a.meta.name.cmp(&b.meta.name))
        });
        Ok(out)
    }

    pub fn note(&self, name: &str) -> Result<NoteDetail> {
        let name = validate_note_name(name)?;
        let path = self.root.join("notes").join(format!("{name}.md"));
        if !path.is_file() {
            return Err(CoreError::RecordNotFound {
                id: name.to_string(),
                path,
            });
        }
        self.parse_note(&path)
    }

    fn parse_note(&self, path: &Path) -> Result<NoteDetail> {
        let raw = read_to_string(path)?;
        let (fm, md) = body::split_frontmatter(&raw).ok_or_else(|| {
            CoreError::malformed(
                path,
                "missing YAML frontmatter — a note must start with a `---` fenced block (see SPEC.md)",
            )
        })?;
        let meta: Note = serde_yaml::from_str(fm)
            .map_err(|e| CoreError::malformed(path, format!("invalid note frontmatter: {e}")))?;
        let last = if meta.updated > meta.created {
            meta.updated.clone()
        } else {
            meta.created.clone()
        };
        Ok(NoteDetail {
            meta,
            body: md.trim().to_string(),
            last_activity: last,
        })
    }

    // -- record assets (images referenced from bodies) -----------------------

    /// A file a record body references (`![alt](assets/diagram.svg)`), as raw bytes.
    ///
    /// The reference is text an agent wrote, so it is validated the way an id is:
    /// relative, forward-slash segments, no `..`, no dotfiles, no drive letters; it must
    /// resolve — after symlinks — to a file *inside this store's own folder*, wear an
    /// image extension, and be of sane size. The renderer shows these through `<img>`,
    /// where even an SVG is script-inert (src/lib/markdown.tsx), and this method is why a
    /// body can never name a file outside the AgentMonitoring folder. The dev server's
    /// twin of these rules is `readProjectAsset` in scripts/project-fs.mjs.
    pub fn asset(&self, rel: &str) -> Result<Vec<u8>> {
        let expected = format!(
            "a relative path inside the {DATA_DIR} folder ending in one of: {} \
             (e.g. assets/diagram.svg)",
            ASSET_EXTENSIONS.join(" ")
        );
        let invalid = |value: &str| CoreError::InvalidValue {
            what: "image path".into(),
            value: value.to_string(),
            expected: expected.clone(),
        };
        let rel = rel.trim();
        if rel.is_empty() || rel.len() > 512 {
            return Err(invalid(rel));
        }
        // Windows also reads `\` as a separator; unify before the segment checks so a
        // `..\` cannot slip past a `/`-only rule.
        let unified = rel.replace('\\', "/");
        if unified.starts_with('/') || unified.contains(':') {
            return Err(invalid(rel));
        }
        if unified
            .split('/')
            .any(|seg| seg.is_empty() || seg == ".." || seg.starts_with('.'))
        {
            return Err(invalid(rel));
        }
        let ext = unified.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if !unified.contains('.') || !ASSET_EXTENSIONS.contains(&ext.as_str()) {
            return Err(invalid(rel));
        }

        let path = self.root.join(&unified);
        // Resolve symlinks before the containment check: a link inside the folder that
        // points out of it must not read what it points at.
        let real = fs::canonicalize(&path).map_err(|_| CoreError::RecordNotFound {
            id: rel.to_string(),
            path: path.clone(),
        })?;
        let root = fs::canonicalize(&self.root).map_err(|e| CoreError::io(&self.root, e))?;
        if !real.starts_with(&root) {
            return Err(invalid(rel));
        }
        let meta = fs::metadata(&real).map_err(|e| CoreError::io(&real, e))?;
        if !meta.is_file() {
            return Err(CoreError::RecordNotFound {
                id: rel.to_string(),
                path,
            });
        }
        if meta.len() > ASSET_MAX_BYTES {
            return Err(CoreError::InvalidValue {
                what: "image file".into(),
                value: rel.to_string(),
                expected: format!("a file of at most {} MB", ASSET_MAX_BYTES / (1024 * 1024)),
            });
        }
        fs::read(&real).map_err(|e| CoreError::io(&real, e))
    }

    // -- events -------------------------------------------------------------

    /// Newest first. Malformed lines are skipped rather than failing the whole feed —
    /// an append-only log written by many agents must degrade gracefully.
    pub fn events(&self, limit: Option<usize>) -> Result<Vec<Event>> {
        let path = self.root.join("events.jsonl");
        if !path.is_file() {
            return Ok(Vec::new());
        }
        let raw = read_to_string(&path)?;
        // Timestamps have second precision, so several events routinely share one. Ties
        // break on file order (reversed), which is append order — the last line written
        // is the most recent thing that happened.
        let mut events: Vec<(usize, Event)> = raw
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<Event>(l).ok())
            .enumerate()
            .collect();
        events.sort_by(|(ai, a), (bi, b)| b.ts.cmp(&a.ts).then_with(|| bi.cmp(ai)));
        let mut events: Vec<Event> = events.into_iter().map(|(_, e)| e).collect();
        if let Some(n) = limit {
            events.truncate(n);
        }
        Ok(events)
    }

    // -- dashboard snapshot -------------------------------------------------

    pub fn status(&self) -> Result<ProjectStatusSnapshot> {
        let project = self.project()?;
        let works = self.worklogs()?;
        let bugs = self.bugs()?;
        let notes = self.notes()?;
        let recent_events = self.events(Some(50))?;

        let mut agents: Vec<AgentActivity> = Vec::new();
        for w in &works {
            let i = agent_slot(&mut agents, &w.meta.agent);
            match w.meta.status {
                WorkStatus::InProgress => agents[i].in_progress += 1,
                WorkStatus::Done => agents[i].done += 1,
                WorkStatus::Abandoned => {}
            }
            if w.last_activity > agents[i].last_activity {
                agents[i].last_activity = w.last_activity.clone();
            }
        }
        for b in &bugs {
            let i = agent_slot(&mut agents, &b.meta.reporter);
            agents[i].bugs_reported += 1;
            if b.last_activity > agents[i].last_activity {
                agents[i].last_activity = b.last_activity.clone();
            }
            if let Some(r) = &b.meta.resolved_by {
                let i = agent_slot(&mut agents, r);
                agents[i].bugs_resolved += 1;
            }
        }
        for n in &notes {
            let i = agent_slot(&mut agents, &n.meta.agent);
            agents[i].notes += 1;
            if n.last_activity > agents[i].last_activity {
                agents[i].last_activity = n.last_activity.clone();
            }
        }
        agents.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));

        Ok(ProjectStatusSnapshot {
            project,
            active_work: works
                .iter()
                .filter(|w| w.meta.status == WorkStatus::InProgress)
                .cloned()
                .collect(),
            open_bugs: bugs
                .iter()
                .filter(|b| b.meta.status.is_open())
                .cloned()
                .collect(),
            recent_notes: notes.into_iter().take(5).collect(),
            recent_events,
            agents,
        })
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// Index of `name` in the per-agent rollup, appending an empty row when first seen.
fn agent_slot(agents: &mut Vec<AgentActivity>, name: &str) -> usize {
    if let Some(i) = agents.iter().position(|a| a.agent == name) {
        return i;
    }
    agents.push(AgentActivity {
        agent: name.to_string(),
        in_progress: 0,
        done: 0,
        bugs_reported: 0,
        bugs_resolved: 0,
        notes: 0,
        last_activity: String::new(),
    });
    agents.len() - 1
}

fn read_to_string(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|e| CoreError::io(path, e))
}

/// A path as the filesystem really has it: symlinks and junctions resolved, `..` gone, and
/// Windows' `\\?\` prefix taken back off. Used when a project is opened, and again by
/// [`crate::write::Store::delete_project`], which may only remove a directory that really
/// is the store's own root after every one of those has been resolved.
pub(crate) fn normalize(p: &Path) -> PathBuf {
    // dunce-free: canonicalize when possible, otherwise keep what we were given so the
    // error message shows the path the user actually typed.
    match fs::canonicalize(p) {
        Ok(c) => {
            let s = c.display().to_string();
            PathBuf::from(s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s))
        }
        Err(_) => p.to_path_buf(),
    }
}

/// Record files in a directory, sorted by name (== chronological, ids are sequential).
fn record_files(dir: &Path, prefix: &str) -> Result<Vec<PathBuf>> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| CoreError::io(dir, e))? {
        let entry = entry.map_err(|e| CoreError::io(dir, e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_file() && name.starts_with(prefix) && name.ends_with(".md") && !name.starts_with('.') {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// `WORK-0001` / `BUG-0012`. Case-insensitive in, canonical (upper) out.
pub fn validate_id(id: &str, prefix: &str) -> Result<String> {
    let upper = id.trim().to_ascii_uppercase();
    let expected = format!("{prefix}-NNNN (e.g. {prefix}-0001)");
    let digits = match upper.strip_prefix(&format!("{prefix}-")) {
        Some(d) => d,
        None => {
            return Err(CoreError::InvalidId {
                id: id.to_string(),
                expected,
            })
        }
    };
    if digits.is_empty() || digits.len() > 8 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(CoreError::InvalidId {
            id: id.to_string(),
            expected,
        });
    }
    Ok(upper)
}

/// Windows refuses these as file stems whatever the extension; a note named `con` would
/// be a file that cannot be created, read or deleted normally.
const RESERVED_NOTE_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A note name: kebab-case, 2–64 chars, and safe to be a file name, a URL segment and a
/// `--refs` value. Case-insensitive in, canonical (lower) out — like [`validate_id`].
pub fn validate_note_name(name: &str) -> Result<String> {
    let lower = name.trim().to_ascii_lowercase();
    let expected = "a kebab-case name of 2–64 letters, digits and hyphens \
                    (e.g. registry-gate-gotcha)";
    let shape_ok = lower.len() >= 2
        && lower.len() <= 64
        && !lower.starts_with('-')
        && !lower.ends_with('-')
        && lower
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !shape_ok || RESERVED_NOTE_NAMES.contains(&lower.as_str()) {
        return Err(CoreError::InvalidId {
            id: name.to_string(),
            expected: expected.into(),
        });
    }
    // `work-0012` in a refs list must always mean the work log, never a note.
    let looks_like_record_id = lower
        .strip_prefix("work-")
        .or_else(|| lower.strip_prefix("bug-"))
        .map(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false);
    if looks_like_record_id {
        return Err(CoreError::InvalidId {
            id: name.to_string(),
            expected: "a name that cannot be mistaken for a record id — WORK-/BUG-number \
                       shapes are reserved for work logs and bugs"
                .into(),
        });
    }
    Ok(lower)
}

/// Derive a note name from its title: ascii letters and digits kept, everything else
/// becomes a hyphen, runs collapsed. Returns `None` when the title has too little ascii
/// to make a meaningful name (e.g. a fully non-Latin title) — the caller then asks for an
/// explicit `--name` instead of inventing a junk one.
pub fn slugify_note_name(title: &str) -> Option<String> {
    let mut out = String::new();
    let mut pending_dash = false;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.push(c.to_ascii_lowercase());
        } else {
            pending_dash = true;
        }
        if out.len() >= 64 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.len() < 3 {
        return None;
    }
    validate_note_name(&out).ok()
}

/// Next free id in a sequence, e.g. `WORK-0003`. Used by the CLI when creating records.
pub fn next_id(existing: &[String], prefix: &str) -> String {
    let max = existing
        .iter()
        .filter_map(|id| {
            id.to_ascii_uppercase()
                .strip_prefix(&format!("{prefix}-"))
                .and_then(|d| d.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    format!("{prefix}-{:04}", max + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_validated_against_traversal() {
        assert!(validate_id("../../etc/passwd", "WORK").is_err());
        assert!(validate_id("WORK-0001/../x", "WORK").is_err());
        assert_eq!(validate_id("work-0001", "WORK").unwrap(), "WORK-0001");
    }

    #[test]
    fn note_names_are_validated_against_traversal_reserved_and_id_shapes() {
        assert!(validate_note_name("../../etc/passwd").is_err());
        assert!(validate_note_name("a").is_err(), "too short");
        assert!(validate_note_name("-leading").is_err());
        assert!(validate_note_name("trailing-").is_err());
        assert!(validate_note_name("has space").is_err());
        assert!(validate_note_name("con").is_err(), "Windows device name");
        assert!(validate_note_name("work-0012").is_err(), "reads as a record id");
        assert!(validate_note_name("bug-7").is_err(), "reads as a record id");
        assert!(validate_note_name("work-in-progress-notes").is_ok(), "words are fine");
        assert_eq!(
            validate_note_name("Registry-Gate-Gotcha").unwrap(),
            "registry-gate-gotcha"
        );
    }

    #[test]
    fn slugify_makes_kebab_names_and_refuses_junk() {
        assert_eq!(
            slugify_note_name("Gate scripts must sandbox the registry!").as_deref(),
            Some("gate-scripts-must-sandbox-the-registry")
        );
        assert_eq!(slugify_note_name("P13:  Notes/메모").as_deref(), Some("p13-notes"));
        assert_eq!(slugify_note_name("핸드오프 노트"), None, "no ascii to work with");
        assert_eq!(slugify_note_name("!!"), None);
        let long = slugify_note_name(&"word ".repeat(40)).expect("long titles still slug");
        assert!(long.len() <= 64, "{long}");
    }

    #[test]
    fn next_id_is_zero_padded_and_monotonic() {
        assert_eq!(next_id(&[], "WORK"), "WORK-0001");
        assert_eq!(
            next_id(&["WORK-0001".into(), "WORK-0009".into()], "WORK"),
            "WORK-0010"
        );
        assert_eq!(next_id(&["BUG-0123".into()], "BUG"), "BUG-0124");
    }

    #[test]
    fn reads_the_repo_project() {
        // The AgentMonitoring folder beside this workspace is this app's own build
        // history; if it is present it must parse.
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(DATA_DIR);
        if !root.join("project.json").is_file() {
            return;
        }
        let store = Store::open(&root).expect("open project");
        let p = store.project().expect("project.json parses");
        assert_eq!(p.version, crate::SCHEMA_VERSION);
        let works = store.worklogs().expect("worklogs parse");
        assert!(!works.is_empty(), "the project has at least one work log");
        for w in &works {
            let detail = store.worklog(&w.meta.id).expect("worklog detail");
            assert!(!detail.what.trim().is_empty(), "{} has ## What", w.meta.id);
            assert!(!detail.why.trim().is_empty(), "{} has ## Why", w.meta.id);
            assert!(!detail.how.trim().is_empty(), "{} has ## How", w.meta.id);
            if detail.meta.status == WorkStatus::Done {
                assert!(detail.outcome.is_some(), "{} done => ## Outcome", w.meta.id);
            }
        }
        let bugs = store.bugs().expect("bugs parse");
        for b in &bugs {
            let detail = store.bug(&b.meta.id).expect("bug detail");
            assert!(!detail.report.trim().is_empty(), "{} has ## Report", b.meta.id);
            // The board searches `search_text`, so it must carry the whole record:
            // the thread and the fix, not only the excerpt the row prints.
            for part in detail
                .comments
                .iter()
                .map(|c| c.body.as_str())
                .chain(detail.resolution.as_deref())
            {
                if let Some(word) = part
                    .split_whitespace()
                    .find(|w| w.len() > 6 && w.chars().all(|c| c.is_ascii_alphanumeric()))
                {
                    assert!(
                        b.search_text.contains(word),
                        "{}: search_text is missing '{word}' from the record body",
                        b.meta.id
                    );
                }
            }
        }
        store.status().expect("status snapshot");
    }

    #[test]
    fn open_accepts_the_folder_or_its_parent_and_nothing_else() {
        let base = std::env::temp_dir().join(format!(
            "agentmon-store-open-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = base.join(DATA_DIR);
        fs::create_dir_all(&data).unwrap();
        fs::write(
            data.join("project.json"),
            r#"{ "version": 2, "id": "prj-test", "name": "Test", "createdAt": "2026-08-20T00:00:00Z" }"#,
        )
        .unwrap();

        let via_parent = Store::open(&base).expect("the picked folder opens");
        let via_data = Store::open(&data).expect("the data folder itself opens");
        assert_eq!(via_parent.root(), via_data.root());
        assert_eq!(via_parent.location(), base.as_path());

        let empty = base.join("elsewhere");
        fs::create_dir_all(&empty).unwrap();
        assert!(Store::open(&empty).is_err(), "a folder with no project refuses");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn assets_are_path_locked_to_the_project_folder() {
        let base = std::env::temp_dir().join(format!(
            "agentmon-store-asset-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = base.join(DATA_DIR);
        fs::create_dir_all(data.join("assets")).unwrap();
        fs::write(
            data.join("project.json"),
            r#"{ "version": 2, "id": "prj-asset", "name": "Asset", "createdAt": "2026-08-20T00:00:00Z" }"#,
        )
        .unwrap();
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"4\" height=\"4\"/></svg>";
        fs::write(data.join("assets").join("diagram.svg"), svg).unwrap();
        // A real file *outside* the store, to prove traversal cannot reach it.
        fs::write(base.join("secret.svg"), "outside").unwrap();

        let store = Store::open(&base).unwrap();

        assert_eq!(store.asset("assets/diagram.svg").unwrap(), svg.as_bytes());
        assert_eq!(
            store.asset("assets\\diagram.svg").unwrap(),
            svg.as_bytes(),
            "backslash separators are the same path on Windows"
        );

        for bad in [
            "../secret.svg",
            "assets/../../secret.svg",
            "..\\secret.svg",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "assets/.hidden.svg",
            "assets/diagram.txt", // not an image extension
            "project",            // no extension at all
            "",
        ] {
            let err = store.asset(bad).expect_err(bad);
            assert_eq!(err.kind(), "invalid_argument", "{bad} → {err}");
        }

        // Missing-but-well-formed is "not found", the retryable-after-a-write answer,
        // not "invalid" — the reference may describe a file another agent is about to add.
        let missing = store.asset("assets/not-there.svg").expect_err("missing file");
        assert_eq!(missing.kind(), "record_not_found", "{missing}");

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn v1_data_is_refused_with_the_migrate_hint() {
        let base = std::env::temp_dir().join(format!(
            "agentmon-store-v1-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let data = base.join(DATA_DIR);
        fs::create_dir_all(&data).unwrap();
        // A v1 project.json: no version key, slug/status still present.
        fs::write(
            data.join("project.json"),
            r#"{ "id": "prj-old", "slug": "old", "name": "Old", "status": "active" }"#,
        )
        .unwrap();
        let err = Store::open(&base).expect_err("v1 data does not half-render");
        assert!(err.to_string().contains("agentmon migrate"), "{err}");
        fs::remove_dir_all(&base).ok();
    }
}
