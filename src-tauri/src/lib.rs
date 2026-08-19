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
    Bug, BugDetail, Event, NewProject, Project, ProjectStatusSnapshot, UpdateProject, Vault,
    VaultInfo, WorklogDetail, WorklogSummary,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Where the vault lives for this session. Mutable so a human can point the app at a
/// vault they copied to another machine (SPEC: portability).
struct VaultState(Mutex<Option<PathBuf>>);

/// The live filesystem watcher, and the directory it is watching.
///
/// Dropping the watcher stops watching, so it has to be held somewhere for the lifetime of
/// the app — and replaced (not added to) when the vault changes, or the app would keep
/// reporting changes from the old directory. The root is kept beside it because the
/// watchdog below has to answer one question every few seconds: *is what we are watching
/// still the vault we are showing?*
#[derive(Default)]
struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    root: Mutex<Option<PathBuf>>,
}

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

/// Where the human's vault choice is remembered between runs.
///
/// A vault the human went and found in a folder picker has to still be there tomorrow, or
/// "open a vault you copied from another machine" is a party trick rather than the
/// portability SPEC.md asks for. One file, one key, next to the app's own config.
fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn saved_vault(app: &AppHandle) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(settings_file(app)?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let path = json.get("vaultPath")?.as_str()?;
    let path = PathBuf::from(path);
    // A remembered path that no longer holds a vault (an unplugged drive, a moved folder)
    // is not an error to shout about: fall back to the normal resolution order.
    Vault::open(&path).ok().map(|_| path)
}

fn remember_vault(app: &AppHandle, path: &Path) {
    let Some(file) = settings_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::json!({ "vaultPath": path.display().to_string() });
    if let Err(e) = std::fs::write(&file, format!("{}\n", serde_json::to_string_pretty(&json).unwrap()))
    {
        eprintln!(
            "agentmonitoring: could not remember the vault choice in {} ({e}); the app will \
             use it for this session only",
            file.display()
        );
    }
}

/// Everything switching vaults has to do, in one place: read it, remember it, watch it,
/// retitle the window and tell the UI. Both entry points below go through here so a vault
/// opened from the picker behaves exactly like one set from the frontend.
fn switch_vault(
    app: &AppHandle,
    state: &State<'_, VaultState>,
    watcher: &State<'_, WatcherState>,
    path: &Path,
) -> CmdResult<VaultInfo> {
    let vault = Vault::open(path).map_err(|e| e.to_string())?;
    let info = vault.info().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "vault state poisoned")? = Some(path.to_path_buf());
    remember_vault(app, path);
    set_window_title(app, &info);
    // Re-arm the watcher on the new directory. A failure here is not fatal — the app
    // still reads the new vault, it just will not live-refresh — so it is logged, not
    // returned.
    rearm_watcher(app, watcher, vault.root());
    // Every screen reloads off this event, so the switch lands everywhere at once.
    let _ = app.emit(
        "vault-changed",
        VaultChanged {
            vault: vault.root().display().to_string(),
            projects: Vec::new(),
        },
    );
    Ok(info)
}

fn set_window_title(app: &AppHandle, info: &VaultInfo) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&format!("AgentMonitoring — {}", info.name));
    }
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
    switch_vault(&app, &state, &watcher, Path::new(&path))
}

/// Open the native folder picker and switch to the vault the human chose.
///
/// `Ok(None)` means they closed the dialog — not an error, and the app carries on with the
/// vault it had. Choosing a directory with no `vault.json` in it *is* an error, and the
/// message says how to make one there.
///
/// `async` on purpose: the blocking picker must not run on the main thread (it is the
/// thread the dialog itself needs), and an async command is handed to the runtime instead.
#[tauri::command]
async fn choose_vault_folder(app: AppHandle) -> CmdResult<Option<VaultInfo>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open a vault folder")
        .blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked
        .simplified()
        .into_path()
        .map_err(|e| format!("that folder cannot be read: {e}"))?;

    if !dir.join("vault.json").is_file() {
        return Err(format!(
            "{} is not a vault: it has no vault.json. Pick the folder that contains \
             vault.json and projects/, or create one there with \
             `agentmon init --vault \"{}\" --name \"<vault name>\"`.",
            dir.display(),
            dir.display()
        ));
    }

    let state: State<'_, VaultState> = app.state();
    let watcher: State<'_, WatcherState> = app.state();
    switch_vault(&app, &state, &watcher, &dir).map(Some)
}

/// The name a vault gets when it is created from the app: the folder the human picked.
///
/// `agentmon init` makes the name an argument because a terminal has one; a folder picker
/// does not, and inventing "My vault" would put a word on the window title that means
/// nothing to whoever chose `D:\work\acme-vault`. The folder they named is the best name
/// they have already given it.
fn vault_name_for(dir: &Path) -> String {
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Vault".to_string())
}

/// Make a vault in a folder the human picks, and open it — the GUI's `agentmon init`.
///
/// Without this, a human who installs the app and has no vault has nothing to press: the
/// three remedies the resolution error offers are a CLI flag, an environment variable and a
/// command, and the recovery screen's other button (Open vault folder…) presumes a vault
/// that already exists. This is the one path that ends with the app showing something.
///
/// Picking a folder that is *already* a vault opens it rather than failing, because that is
/// plainly what was meant; `Vault::init` refuses to overwrite one either way.
#[tauri::command]
async fn create_vault_folder(app: AppHandle) -> CmdResult<Option<VaultInfo>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a folder for the new vault")
        .blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked
        .simplified()
        .into_path()
        .map_err(|e| format!("that folder cannot be used: {e}"))?;

    if !dir.join("vault.json").is_file() {
        Vault::init(&dir, &vault_name_for(&dir)).map_err(|e| e.to_string())?;
    }

    let state: State<'_, VaultState> = app.state();
    let watcher: State<'_, WatcherState> = app.state();
    switch_vault(&app, &state, &watcher, &dir).map(Some)
}

/// The `agentmon` CLI shipped beside the app, if this build has one.
///
/// The installer puts the binary next to `agentmonitoring.exe` (bundle.externalBin in
/// tauri.conf.json). The onboarding screen prints command lines; on an installed machine
/// `agentmon` is not on PATH, so those lines are unrunnable unless they name the binary the
/// human actually has. Returning `None` (a dev build, a portable copy without it) is not an
/// error — the screen falls back to the bare `agentmon`.
#[tauri::command]
fn cli_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["agentmon.exe", "agentmon"] {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate.display().to_string());
        }
    }
    None
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

fn rearm_watcher(app: &AppHandle, state: &WatcherState, root: &Path) {
    match watch_vault(app, root) {
        Ok(w) => {
            if let Ok(mut slot) = state.watcher.lock() {
                // Assigning drops the previous watcher, which closes its channel and
                // ends its debounce thread.
                *slot = Some(w);
            }
            if let Ok(mut at) = state.root.lock() {
                *at = Some(root.to_path_buf());
            }
        }
        Err(e) => {
            // Leave the slot empty rather than half-armed: the watchdog re-tries every
            // few seconds, so a directory that comes back is watched again by itself.
            if let Ok(mut slot) = state.watcher.lock() {
                *slot = None;
            }
            if let Ok(mut at) = state.root.lock() {
                *at = None;
            }
            eprintln!(
                "agentmonitoring: not watching {} for changes ({e}); the app will still read \
                 it, but screens will not refresh on their own until it comes back",
                root.display()
            )
        }
    }
}

// ---------------------------------------------------------------------------
// watcher health (the desktop half of "not reading the vault right now")
// ---------------------------------------------------------------------------

/// How often the app checks that the vault it is watching is still there.
///
/// A `notify` handle on a directory that has been renamed, unmounted or unplugged does not
/// fail — it simply never fires again. Browser mode polls the dev server and can say "not
/// reading the vault right now"; without this the desktop app, which is the product, would
/// sit on stale numbers indefinitely with no tell, and would *stay* frozen after the vault
/// came back because the dead watcher is never replaced. One `vault.json` read every five
/// seconds is a rounding error next to the file watch itself.
const HEALTH_INTERVAL: Duration = Duration::from_secs(5);

/// What the UI is told about the vault's reachability. `src/lib/api.ts` turns it into the
/// same banner the browser poll raises, so both transports say the same sentence.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultHealth {
    ok: bool,
    error: Option<String>,
    vault: Option<String>,
}

/// One tick of the watchdog, as a decision. Pure, so the rule is testable without a window.
#[derive(Debug, PartialEq)]
enum Beat {
    /// Readable, and already watched: say nothing.
    Steady,
    /// Readable but not watched — first tick after it came back, or after a switch.
    /// Re-arm on this root and tell the UI to re-read what it missed.
    Rearm(PathBuf),
    /// The vault stopped answering.
    Lost(String),
}

fn beat(found: Result<PathBuf, String>, watching: Option<&Path>) -> Beat {
    match found {
        Ok(root) => match watching {
            Some(at) if at == root => Beat::Steady,
            _ => Beat::Rearm(root),
        },
        Err(e) => Beat::Lost(e),
    }
}

/// Watch the watcher: emit `vault-health` when the vault goes away, and re-arm when it
/// comes back. Started once, from `setup`, and it outlives every vault switch.
fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        let mut healthy = true;
        loop {
            std::thread::sleep(HEALTH_INTERVAL);
            let vault_state: State<'_, VaultState> = app.state();
            let watcher: State<'_, WatcherState> = app.state();
            let found = open(&vault_state).map(|v| v.root().to_path_buf());
            let watching = watcher.root.lock().ok().and_then(|r| r.clone());
            match beat(found, watching.as_deref()) {
                Beat::Steady => {
                    if !healthy {
                        healthy = true;
                        let _ = app.emit(
                            "vault-health",
                            VaultHealth { ok: true, error: None, vault: None },
                        );
                    }
                }
                Beat::Rearm(root) => {
                    rearm_watcher(&app, &watcher, &root);
                    let _ = app.emit(
                        "vault-health",
                        VaultHealth {
                            ok: true,
                            error: None,
                            vault: Some(root.display().to_string()),
                        },
                    );
                    // Whatever happened while it was unreachable never reached this window.
                    if !healthy {
                        let _ = app.emit(
                            "vault-changed",
                            VaultChanged {
                                vault: root.display().to_string(),
                                projects: Vec::new(),
                            },
                        );
                    }
                    healthy = true;
                }
                Beat::Lost(error) => {
                    // The watcher is on a directory that is not there any more; drop it so
                    // the tick that finds the vault again arms a live one.
                    if let Ok(mut slot) = watcher.watcher.lock() {
                        *slot = None;
                    }
                    if let Ok(mut at) = watcher.root.lock() {
                        *at = None;
                    }
                    if healthy {
                        healthy = false;
                        let _ = app.emit(
                            "vault-health",
                            VaultHealth { ok: false, error: Some(error), vault: None },
                        );
                    }
                }
            }
        }
    });
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

/// Create a project from the app, through the same `agentmon-core` write path the CLI uses
/// — including the `project_created` event, which is what the activity feed is built from.
/// Hand-writing a project.json here would produce a project with no history.
#[tauri::command]
fn create_project(
    slug: String,
    name: String,
    description: String,
    tags: Vec<String>,
    agent: String,
    state: State<'_, VaultState>,
) -> CmdResult<Project> {
    let written = open(&state)?
        .create_project(&NewProject {
            slug,
            name,
            description,
            tags,
            actor: agent,
            at: None,
        })
        .map_err(|e| e.to_string())?;
    Ok(written.record)
}

/// Archive or restore a project. Deletes nothing: the records stay in the vault and the
/// change is logged like any other mutation.
#[tauri::command]
fn set_project_status(
    project: String,
    status: String,
    agent: String,
    state: State<'_, VaultState>,
) -> CmdResult<Project> {
    let status = agentmon_core::parse_project_status(&status).map_err(|e| e.to_string())?;
    let written = open(&state)?
        .update_project(
            &project,
            &UpdateProject {
                status: Some(status),
                actor: agent,
                ..Default::default()
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(written.record)
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
        .manage(WatcherState::default())
        .setup(|app| {
            let state: State<'_, VaultState> = app.state();
            // Resolution order, most explicit first: AGENTMON_VAULT (how a launcher pins a
            // vault, and the same variable the CLI reads), then the folder the human last
            // opened in this app, then ./vault beside the binary.
            if state.0.lock().map(|s| s.is_none()).unwrap_or(false) {
                if let Some(path) = saved_vault(app.handle()) {
                    if let Ok(mut slot) = state.0.lock() {
                        *slot = Some(path);
                    }
                }
            }
            if let Ok(vault) = open(&state) {
                // Surface the resolved vault in the window title so a human always knows
                // which data they are looking at.
                if let Ok(info) = vault.info() {
                    set_window_title(app.handle(), &info);
                }
                // Watch it, so a record an agent writes shows up without a navigation.
                let watcher: State<'_, WatcherState> = app.state();
                rearm_watcher(app.handle(), &watcher, vault.root());
            }
            // …and watch the watcher, so a vault that goes away says so instead of the
            // window quietly freezing on the last numbers it read.
            spawn_watchdog(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault_info,
            set_vault_path,
            choose_vault_folder,
            create_vault_folder,
            cli_path,
            list_projects,
            get_project,
            create_project,
            set_project_status,
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

    /**
     * Switching vaults has to move the watcher, not add one.
     *
     * `rearm_watcher` assigns the new watcher into the state slot, which drops the old one —
     * that drop is what closes its channel and ends its debounce thread. If it did not, a
     * human who opened a second vault would get refreshes from the first one they had
     * stopped looking at, and the two vaults' events would interleave. This exercises the
     * assignment directly (the command wrapper around it needs a Tauri AppHandle; the
     * behaviour that can go wrong is here).
     */
    #[test]
    fn re_arming_the_watcher_moves_it_to_the_new_vault() {
        let old = tmp_vault("rearm-old");
        let new = tmp_vault("rearm-new");
        let (tx, rx) = channel::<VaultChanged>();
        let tx_new = tx.clone();

        let mut slot: Option<RecommendedWatcher> = Some(
            spawn_vault_watcher(&old, move |c| {
                let _ = tx.send(c);
            })
            .expect("watcher starts on the first vault"),
        );
        std::thread::sleep(Duration::from_millis(300));
        assert!(slot.is_some(), "the first vault is being watched");

        // What switch_vault does: the new watcher takes the slot, and the old one drops.
        slot = Some(
            spawn_vault_watcher(&new, move |c| {
                let _ = tx_new.send(c);
            })
            .expect("watcher starts on the second vault"),
        );
        std::thread::sleep(Duration::from_millis(300));

        let record = |root: &PathBuf, body: &str| {
            fs::write(
                root.join("projects").join("demo").join("worklogs").join("WORK-0001.md"),
                body,
            )
            .unwrap();
        };

        record(&old, "---\nid: WORK-0001\n---\n\n## What\n\nold vault\n");
        assert!(
            rx.recv_timeout(Duration::from_millis(1500)).is_err(),
            "the vault that was switched away from must not report changes any more"
        );

        record(&new, "---\nid: WORK-0001\n---\n\n## What\n\nnew vault\n");
        let change = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("a write to the newly opened vault is reported");
        assert_eq!(change.vault, new.display().to_string());
        assert_eq!(change.projects, vec!["demo".to_string()]);

        assert!(slot.is_some(), "the app holds exactly one watcher");
        drop(slot);
        fs::remove_dir_all(&old).ok();
        fs::remove_dir_all(&new).ok();
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

    /**
     * The watchdog's rule, without a window: a vault that is readable and already watched
     * is left alone; one that is readable but *not* watched is re-armed (this is the tick
     * that un-freezes the app after the drive comes back); one that cannot be read at all
     * is reported, so the desktop raises the same banner browser mode does.
     */
    #[test]
    fn the_watchdog_re_arms_a_dead_watcher_and_reports_a_vault_that_went_away() {
        let root = PathBuf::from("/v");
        let other = PathBuf::from("/w");

        assert_eq!(beat(Ok(root.clone()), Some(&root)), Beat::Steady);

        // Nothing is being watched — the state a failed arm, a fresh start, or an outage
        // that has just ended leaves behind.
        assert_eq!(beat(Ok(root.clone()), None), Beat::Rearm(root.clone()));
        // Watching the wrong directory is the same defect with a different cause.
        assert_eq!(beat(Ok(root.clone()), Some(&other)), Beat::Rearm(root.clone()));

        let lost = beat(Err("no vault.json in /v".into()), Some(&root));
        assert_eq!(lost, Beat::Lost("no vault.json in /v".into()));
    }

    /// And the real thing: a vault that disappears is unreadable, and readable again when
    /// it comes back — which is what the watchdog's `found` argument is built from.
    #[test]
    fn a_vault_that_goes_away_stops_opening_and_opens_again_when_it_returns() {
        let root = tmp_vault("health");
        let read = || Vault::open(&root).map(|v| v.root().to_path_buf()).map_err(|e| e.to_string());

        assert!(matches!(beat(read(), Some(&root)), Beat::Steady));

        let moved = root.with_extension("moved");
        fs::rename(&root, &moved).unwrap();
        let lost = beat(read(), Some(&root));
        assert!(matches!(lost, Beat::Lost(_)), "a vault that is gone must be reported: {lost:?}");

        fs::rename(&moved, &root).unwrap();
        // Back, but nothing is watching it any more — so the next tick re-arms.
        assert_eq!(beat(read(), None), Beat::Rearm(root.clone()));
        fs::remove_dir_all(&root).ok();
    }

    /**
     * The GUI's `agentmon init`, without the picker: an empty folder becomes a vault the
     * app can open, named after the folder the human chose.
     *
     * This is the only exit from the first-run dead end for somebody who installed the app
     * and has no vault and no CLI, so the part that can go wrong — init on a directory that
     * exists but is empty, then open it again — is tested rather than assumed.
     */
    #[test]
    fn creating_a_vault_in_a_picked_folder_makes_one_the_app_can_open() {
        let dir = std::env::temp_dir().join(format!(
            "agentmonitoring-newvault-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(vault_name_for(&dir), dir.file_name().unwrap().to_string_lossy());

        Vault::init(&dir, &vault_name_for(&dir)).expect("an empty folder becomes a vault");
        let info = Vault::open(&dir).expect("and opens").info().expect("with its info");
        assert_eq!(info.name, vault_name_for(&dir));
        assert!(dir.join("projects").is_dir(), "and is ready for its first project");

        // Picking the same folder again must not reset it: the command opens it instead.
        assert!(Vault::init(&dir, "second").is_err(), "init never overwrites a live vault");
        fs::remove_dir_all(&dir).ok();
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
