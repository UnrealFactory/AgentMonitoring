//! Tauri shell. Every command is a thin wrapper over agentmon-core — the desktop app
//! knows nothing about the on-disk format.
//!
//! The command names and payloads here are the same contract the Vite dev middleware
//! (`/vault-api/*`) serves in browser mode; `src/lib/api.ts` picks a transport at runtime.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use agentmon_core::{
    Bug, BugDetail, Event, Project, ProjectStatusSnapshot, Vault, VaultInfo, WorklogDetail,
    WorklogSummary,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};

/// Where the vault lives for this session. Mutable so a human can point the app at a
/// vault they copied to another machine (SPEC: portability).
struct VaultState(Mutex<Option<PathBuf>>);

/// The live filesystem watcher. Dropping it stops watching, so it has to be held
/// somewhere for the lifetime of the app — and replaced (not added to) when the vault
/// changes, or the app would keep reporting changes from the old directory.
struct WatcherState(Mutex<Option<RecommendedWatcher>>);

type CmdResult<T> = std::result::Result<T, String>;

fn open(state: &State<'_, VaultState>) -> CmdResult<Vault> {
    let explicit = state.0.lock().map_err(|_| "vault state poisoned")?.clone();
    match explicit {
        Some(path) => Vault::open(&path).map_err(|e| e.to_string()),
        None => Vault::resolve(None)
            .or_else(|first| discover().ok_or(first))
            .map_err(|e| e.to_string()),
    }
}

/// Fallback discovery for the packaged app, where the working directory is wherever the
/// user launched from: look next to the executable, then a few levels up (covers
/// `target/debug/agentmonitoring.exe` during development).
fn discover() -> Option<Vault> {
    let exe = std::env::current_exe().ok()?;
    let mut dir: Option<&Path> = exe.parent();
    for _ in 0..5 {
        let d = dir?;
        if let Ok(v) = Vault::open(d.join("vault")) {
            return Some(v);
        }
        dir = d.parent();
    }
    None
}

#[tauri::command]
fn get_vault_info(state: State<'_, VaultState>) -> CmdResult<VaultInfo> {
    open(&state)?.info().map_err(|e| e.to_string())
}

/// Point the app at a different vault directory (returns the new vault's info so the UI
/// can show the switch immediately, and leaves the old path in place on failure).
#[tauri::command]
fn set_vault_path(
    path: String,
    app: AppHandle,
    state: State<'_, VaultState>,
    watcher: State<'_, WatcherState>,
) -> CmdResult<VaultInfo> {
    let vault = Vault::open(&path).map_err(|e| e.to_string())?;
    let info = vault.info().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "vault state poisoned")? = Some(PathBuf::from(&path));
    // Re-arm the watcher on the new directory. A failure here is not fatal — the app
    // still reads the new vault, it just will not live-refresh — so it is logged, not
    // returned.
    rearm_watcher(&app, &watcher, vault.root());
    Ok(info)
}

// ---------------------------------------------------------------------------
// live updates (BUG-0002)
// ---------------------------------------------------------------------------

/// Coalescing window for a burst of filesystem events. One `agentmon work update` writes
/// a temp file, renames it over the record and appends to `events.jsonl`; an editor save
/// is similar. Without a window the UI would reload three or four times per write.
const DEBOUNCE: Duration = Duration::from_millis(250);
/// Upper bound on coalescing, so a long stream of writes still refreshes the UI while it
/// is happening instead of only when it stops.
const MAX_COALESCE: Duration = Duration::from_millis(1500);

/// Payload of the `vault-changed` event. The frontend currently just reloads, but the
/// slugs are here so a screen can decide whether the change concerns it.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChanged {
    vault: String,
    projects: Vec<String>,
}

fn rearm_watcher(app: &AppHandle, state: &State<'_, WatcherState>, root: &Path) {
    match watch_vault(app, root) {
        Ok(w) => {
            if let Ok(mut slot) = state.0.lock() {
                // Assigning drops the previous watcher, which closes its channel and
                // ends its debounce thread.
                *slot = Some(w);
            }
        }
        Err(e) => eprintln!(
            "agentmonitoring: not watching {} for changes ({e}); the app will still read it, \
             but screens will not refresh on their own",
            root.display()
        ),
    }
}

/// Watch `<vault>/projects` recursively and emit a debounced `vault-changed`.
fn watch_vault(app: &AppHandle, root: &Path) -> notify::Result<RecommendedWatcher> {
    let app = app.clone();
    spawn_vault_watcher(root, move |change| {
        let _ = app.emit("vault-changed", change);
    })
}

/// The watcher itself, independent of Tauri: watch a vault directory and call `on_change`
/// once per burst of filesystem activity. Split out from [`watch_vault`] so the debounce
/// and the slug extraction can be tested against a real directory without a window.
fn spawn_vault_watcher(
    root: &Path,
    on_change: impl Fn(VaultChanged) + Send + 'static,
) -> notify::Result<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if is_record_change(&event) {
                // The receiver is gone only when the watcher has been replaced; ignoring
                // the error lets this callback die quietly.
                let _ = tx.send(event.paths);
            }
        }
    })?;

    // Watch `projects/` when it exists so vault.json rewrites do not churn the UI; fall
    // back to the vault root for a vault that has no projects yet.
    let projects = root.join("projects");
    let target = if projects.is_dir() {
        projects
    } else {
        root.to_path_buf()
    };
    watcher.watch(&target, RecursiveMode::Recursive)?;

    let root = root.to_path_buf();
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut paths = first;
            let deadline = Instant::now() + MAX_COALESCE;
            loop {
                let window = DEBOUNCE.min(deadline.saturating_duration_since(Instant::now()));
                if window.is_zero() {
                    break;
                }
                match rx.recv_timeout(window) {
                    Ok(more) => paths.extend(more),
                    Err(_) => break,
                }
            }
            on_change(VaultChanged {
                vault: root.display().to_string(),
                projects: changed_projects(&root, &paths),
            });
        }
    });
    Ok(watcher)
}

/// Does this filesystem event touch a file a reader would render?
///
/// Only three things in a vault are readable data: `*.md` records, `events.jsonl` and
/// `*.json` metadata. Everything else a write produces is noise, and each kind of noise
/// caused a real symptom before it was filtered:
///
/// * `.agentmon.lock` and `.WORK-0003.md.<pid>.<nanos>.tmp` — agentmon's own lock and
///   temp files. The temp file's content lands under the real name via the rename that
///   follows, which is its own event.
/// * **Directory events.** Windows reports a `Modify` on the *containing directory* for
///   every file created or deleted inside it — and delivers some of them ~250ms late, so
///   a single `agentmon work update` produced three refreshes: one for the real burst,
///   then one per straggling directory notification that arrived after the debounce
///   window closed.
/// * `Access` events: reading a record is not a change.
fn is_record_change(event: &notify::Event) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|p| {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with('.') {
            return false;
        }
        // Extension, not `is_dir()`: a deleted path cannot be probed on disk.
        matches!(
            p.extension().and_then(|e| e.to_str()),
            Some("md") | Some("jsonl") | Some("json")
        )
    })
}

/// Project slugs touched by a burst of paths, deduplicated and in first-seen order.
fn changed_projects(root: &Path, paths: &[PathBuf]) -> Vec<String> {
    let projects = root.join("projects");
    let mut out: Vec<String> = Vec::new();
    for p in paths {
        if let Ok(rel) = p.strip_prefix(&projects) {
            if let Some(slug) = rel.components().next() {
                let slug = slug.as_os_str().to_string_lossy().to_string();
                if !slug.is_empty() && !out.contains(&slug) {
                    out.push(slug);
                }
            }
        }
    }
    out
}

#[tauri::command]
fn list_projects(state: State<'_, VaultState>) -> CmdResult<Vec<Project>> {
    open(&state)?.projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_project(project: String, state: State<'_, VaultState>) -> CmdResult<Project> {
    open(&state)?.project(&project).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_worklogs(project: String, state: State<'_, VaultState>) -> CmdResult<Vec<WorklogSummary>> {
    open(&state)?.worklogs(&project).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_worklog(
    project: String,
    id: String,
    state: State<'_, VaultState>,
) -> CmdResult<WorklogDetail> {
    open(&state)?
        .worklog(&project, &id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_bugs(
    project: String,
    state: State<'_, VaultState>,
) -> CmdResult<Vec<agentmon_core::BugSummary>> {
    open(&state)?.bugs(&project).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_bug(project: String, id: String, state: State<'_, VaultState>) -> CmdResult<BugDetail> {
    open(&state)?.bug(&project, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_events(
    project: String,
    limit: Option<usize>,
    state: State<'_, VaultState>,
) -> CmdResult<Vec<Event>> {
    open(&state)?
        .events(&project, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_status(project: String, state: State<'_, VaultState>) -> CmdResult<ProjectStatusSnapshot> {
    open(&state)?.status(&project).map_err(|e| e.to_string())
}

/// Kept so the frontend's `Bug` type has a Rust-side witness in this crate's API surface.
#[allow(dead_code)]
fn _type_witness(_: Bug) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState(Mutex::new(
            std::env::var_os("AGENTMON_VAULT").map(PathBuf::from),
        )))
        .manage(WatcherState(Mutex::new(None)))
        .setup(|app| {
            let state: State<'_, VaultState> = app.state();
            if let Ok(vault) = open(&state) {
                // Surface the resolved vault in the window title so a human always knows
                // which data they are looking at.
                if let Ok(info) = vault.info() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title(&format!("AgentMonitoring — {}", info.name));
                    }
                }
                // Watch it, so a record an agent writes shows up without a navigation.
                let watcher: State<'_, WatcherState> = app.state();
                rearm_watcher(app.handle(), &watcher, vault.root());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault_info,
            set_vault_path,
            list_projects,
            get_project,
            list_worklogs,
            get_worklog,
            list_bugs,
            get_bug,
            list_events,
            get_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentMonitoring");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::channel;

    fn tmp_vault(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "agentmonitoring-watch-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join("projects").join("demo").join("worklogs")).unwrap();
        fs::write(dir.join("vault.json"), "{\"version\":1,\"name\":\"t\"}").unwrap();
        dir
    }

    /// The whole point of BUG-0002: a write to the vault produces exactly one refresh,
    /// naming the project that changed.
    #[test]
    fn a_record_write_produces_one_debounced_change_event() {
        let root = tmp_vault("burst");
        let (tx, rx) = channel::<VaultChanged>();
        let _watcher = spawn_vault_watcher(&root, move |c| {
            let _ = tx.send(c);
        })
        .expect("watcher starts");
        // Give the platform backend a moment to arm before touching the directory.
        std::thread::sleep(Duration::from_millis(300));

        // What `agentmon work update` does: temp file, rename over the record, append to
        // the event log — three filesystem operations, one logical change.
        let dir = root.join("projects").join("demo");
        let tmp = dir.join("worklogs").join(".WORK-0001.md.123.456.tmp");
        fs::write(&tmp, "---\nid: WORK-0001\n---\n\n## What\n\nx\n").unwrap();
        fs::rename(&tmp, dir.join("worklogs").join("WORK-0001.md")).unwrap();
        fs::write(dir.join("events.jsonl"), "{\"ts\":\"t\"}\n").unwrap();

        let change = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("a vault-changed event arrives");
        assert_eq!(change.projects, vec!["demo".to_string()]);
        assert_eq!(change.vault, root.display().to_string());
        // The burst coalesced: nothing else arrives right behind it.
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "one write must not produce a second refresh"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn temp_files_and_lock_files_are_not_changes() {
        let ev = |name: &str| notify::Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from(name)],
            attrs: Default::default(),
        };
        assert!(!is_record_change(&ev(".agentmon.lock")));
        assert!(!is_record_change(&ev(".WORK-0001.md.9.9.tmp")));
        assert!(is_record_change(&ev("WORK-0001.md")));
        assert!(is_record_change(&ev("events.jsonl")));
        assert!(is_record_change(&ev("project.json")));
        // Windows reports a Modify on the containing directory too, sometimes hundreds of
        // milliseconds after the burst it belongs to. Those must not become refreshes.
        assert!(!is_record_change(&ev("worklogs")));
        assert!(!is_record_change(&ev("agent-monitoring")));

        let mut read = ev("WORK-0001.md");
        read.kind = EventKind::Access(notify::event::AccessKind::Read);
        assert!(!is_record_change(&read), "reading a record is not a change");
    }

    #[test]
    fn changed_projects_names_every_touched_project_once() {
        let root = PathBuf::from("/v");
        let paths = vec![
            PathBuf::from("/v/projects/alpha/worklogs/WORK-0001.md"),
            PathBuf::from("/v/projects/alpha/events.jsonl"),
            PathBuf::from("/v/projects/beta/bugs/BUG-0001.md"),
            PathBuf::from("/v/vault.json"),
        ];
        assert_eq!(changed_projects(&root, &paths), vec!["alpha", "beta"]);
    }
}
