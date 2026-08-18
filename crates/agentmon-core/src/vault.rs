//! Reading a vault from disk. Every path the caller can influence (project slug, record
//! id) is validated before it touches the filesystem — ids arrive from URLs and from
//! agent-supplied CLI arguments, so `../` must never resolve to anything.

use std::fs;
use std::path::{Path, PathBuf};

use crate::body;
use crate::error::{CoreError, Result};
use crate::model::*;

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
    source: String,
}

impl Vault {
    /// `--vault` flag > `AGENTMON_VAULT` env > `./vault` > cwd (SPEC.md, "Vault resolution").
    pub fn resolve(explicit: Option<&Path>) -> Result<Vault> {
        if let Some(p) = explicit {
            return Vault::open_with_source(p, "flag");
        }
        if let Some(env) = std::env::var_os("AGENTMON_VAULT") {
            return Vault::open_with_source(Path::new(&env), "env");
        }
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let mut tried: Vec<PathBuf> = Vec::new();
        for (cand, src) in [(cwd.join("vault"), "cwd/vault"), (cwd.clone(), "cwd")] {
            if cand.join("vault.json").is_file() {
                return Vault::open_with_source(&cand, src);
            }
            tried.push(cand);
        }
        let listed = tried
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(" and ");
        Err(CoreError::VaultNotFound {
            path: tried.remove(0),
            hint: format!(
                "looked for vault.json in {listed}. Pass --vault <dir>, set AGENTMON_VAULT, or run `agentmon init` to create one."
            ),
        })
    }

    pub fn open(root: impl AsRef<Path>) -> Result<Vault> {
        Vault::open_with_source(root.as_ref(), "flag")
    }

    fn open_with_source(root: &Path, source: &str) -> Result<Vault> {
        let root = normalize(root);
        if !root.join("vault.json").is_file() {
            return Err(CoreError::VaultNotFound {
                path: root.clone(),
                hint: "no vault.json in that directory. Run `agentmon init --vault <dir>` to create one."
                    .into(),
            });
        }
        Ok(Vault {
            root,
            source: source.to_string(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn projects_dir(&self) -> PathBuf {
        self.root.join("projects")
    }

    pub fn project_dir(&self, slug: &str) -> Result<PathBuf> {
        let slug = validate_slug(slug)?;
        let dir = self.projects_dir().join(slug);
        if !dir.join("project.json").is_file() {
            return Err(CoreError::ProjectNotFound {
                slug: slug.to_string(),
                vault: self.root.clone(),
            });
        }
        Ok(dir)
    }

    // -- vault.json ---------------------------------------------------------

    pub fn info(&self) -> Result<VaultInfo> {
        let path = self.root.join("vault.json");
        let raw = read_to_string(&path)?;
        let mut info: VaultInfo = serde_json::from_str(&raw)
            .map_err(|e| CoreError::malformed(&path, format!("invalid vault.json: {e}")))?;
        info.path = self.root.display().to_string();
        info.source = self.source.clone();
        Ok(info)
    }

    // -- projects -----------------------------------------------------------

    pub fn projects(&self) -> Result<Vec<Project>> {
        let dir = self.projects_dir();
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| CoreError::io(&dir, e))? {
            let entry = entry.map_err(|e| CoreError::io(&dir, e))?;
            if !entry.path().is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            if !entry.path().join("project.json").is_file() {
                continue;
            }
            out.push(self.project(&slug)?);
        }
        out.sort_by(|a, b| {
            b.counts
                .last_activity
                .cmp(&a.counts.last_activity)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    pub fn project(&self, slug: &str) -> Result<Project> {
        let dir = self.project_dir(slug)?;
        let path = dir.join("project.json");
        let raw = read_to_string(&path)?;
        let mut project: Project = serde_json::from_str(&raw)
            .map_err(|e| CoreError::malformed(&path, format!("invalid project.json: {e}")))?;
        project.counts = self.counts(slug)?;
        Ok(project)
    }

    fn counts(&self, slug: &str) -> Result<ProjectCounts> {
        let works = self.worklogs(slug)?;
        let bugs = self.bugs(slug)?;
        let events = self.events(slug, None)?;
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
            events: events.len(),
            last_activity: if last.is_empty() { None } else { Some(last) },
        })
    }

    // -- worklogs -----------------------------------------------------------

    pub fn worklogs(&self, slug: &str) -> Result<Vec<WorklogSummary>> {
        let dir = self.project_dir(slug)?.join("worklogs");
        let mut out: Vec<WorklogSummary> = Vec::new();
        for path in record_files(&dir, "WORK-")? {
            let detail = self.parse_worklog(&path)?;
            out.push(WorklogSummary {
                excerpt: body::excerpt(&detail.what, 180),
                update_count: detail.updates.len(),
                last_activity: detail.last_activity.clone(),
                meta: detail.meta,
            });
        }
        out.sort_by(|a, b| b.last_activity.cmp(&a.last_activity).then_with(|| b.meta.id.cmp(&a.meta.id)));
        Ok(out)
    }

    pub fn worklog(&self, slug: &str, id: &str) -> Result<WorklogDetail> {
        let id = validate_id(id, "WORK")?;
        let path = self.project_dir(slug)?.join("worklogs").join(format!("{id}.md"));
        if !path.is_file() {
            return Err(CoreError::RecordNotFound {
                id: id.to_string(),
                slug: slug.to_string(),
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

    pub fn bugs(&self, slug: &str) -> Result<Vec<BugSummary>> {
        let dir = self.project_dir(slug)?.join("bugs");
        let mut out: Vec<BugSummary> = Vec::new();
        for path in record_files(&dir, "BUG-")? {
            let detail = self.parse_bug(&path)?;
            out.push(BugSummary {
                excerpt: body::excerpt(&detail.report, 180),
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

    pub fn bug(&self, slug: &str, id: &str) -> Result<BugDetail> {
        let id = validate_id(id, "BUG")?;
        let path = self.project_dir(slug)?.join("bugs").join(format!("{id}.md"));
        if !path.is_file() {
            return Err(CoreError::RecordNotFound {
                id: id.to_string(),
                slug: slug.to_string(),
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

    // -- events -------------------------------------------------------------

    /// Newest first. Malformed lines are skipped rather than failing the whole feed —
    /// an append-only log written by many agents must degrade gracefully.
    pub fn events(&self, slug: &str, limit: Option<usize>) -> Result<Vec<Event>> {
        let path = self.project_dir(slug)?.join("events.jsonl");
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

    pub fn status(&self, slug: &str) -> Result<ProjectStatusSnapshot> {
        let project = self.project(slug)?;
        let works = self.worklogs(slug)?;
        let bugs = self.bugs(slug)?;
        let recent_events = self.events(slug, Some(50))?;

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
        last_activity: String::new(),
    });
    agents.len() - 1
}

fn read_to_string(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(|e| CoreError::io(path, e))
}

fn normalize(p: &Path) -> PathBuf {
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
        if path.is_file() && name.starts_with(prefix) && name.ends_with(".md") {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

pub fn validate_slug(slug: &str) -> Result<&str> {
    let ok = !slug.is_empty()
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if ok {
        Ok(slug)
    } else {
        Err(CoreError::InvalidId {
            id: slug.to_string(),
            expected: "lowercase letters, digits, '-' or '_' (e.g. agent-monitoring)".into(),
        })
    }
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
        assert!(validate_slug("../secrets").is_err());
        assert!(validate_slug("agent-monitoring").is_ok());
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
    fn reads_the_repo_vault() {
        // The vault at ./vault is this app's own build history; if it is present it must parse.
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("vault");
        if !root.join("vault.json").is_file() {
            return;
        }
        let vault = Vault::open(&root).expect("open vault");
        let info = vault.info().expect("vault.json parses");
        assert_eq!(info.version, crate::SCHEMA_VERSION);
        let projects = vault.projects().expect("projects parse");
        assert!(!projects.is_empty(), "vault has at least one project");
        for p in &projects {
            let works = vault.worklogs(&p.slug).expect("worklogs parse");
            for w in &works {
                let detail = vault.worklog(&p.slug, &w.meta.id).expect("worklog detail");
                assert!(!detail.what.trim().is_empty(), "{} has ## What", w.meta.id);
                assert!(!detail.why.trim().is_empty(), "{} has ## Why", w.meta.id);
                assert!(!detail.how.trim().is_empty(), "{} has ## How", w.meta.id);
                if detail.meta.status == WorkStatus::Done {
                    assert!(detail.outcome.is_some(), "{} done => ## Outcome", w.meta.id);
                }
            }
            let bugs = vault.bugs(&p.slug).expect("bugs parse");
            for b in &bugs {
                let detail = vault.bug(&p.slug, &b.meta.id).expect("bug detail");
                assert!(!detail.report.trim().is_empty(), "{} has ## Report", b.meta.id);
            }
            vault.status(&p.slug).expect("status snapshot");
        }
    }
}
