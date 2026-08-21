//! Tauri shell. Every command is a thin wrapper over agentmon-core — the desktop app
//! knows nothing about the on-disk format.
//!
//! v2: the app shows **every registered project at once**. The per-user list lives in
//! `~/.AgentMonitoring/registry.json` (agentmon_core::Registry); each entry is one
//! `AgentMonitoring` folder, watched independently, so one unplugged drive dims one row
//! instead of freezing the window.
//!
//! The command names and payloads here are the same contract the Vite dev middleware
//! (`/project-api/*`) serves in browser mode; `src/lib/api.ts` picks a transport at runtime.

mod update;

use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use agentmon_core::{
    Bug, BugDetail, Deleted, Event, NewProject, NoteDetail, NoteSummary, Project,
    ProjectStatusSnapshot, Registry, Store, WorklogDetail, WorklogSummary, DATA_DIR,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;

type CmdResult<T> = std::result::Result<T, String>;

// ---------------------------------------------------------------------------
// which projects this window shows
// ---------------------------------------------------------------------------

/// Roots that are part of this session without being in the registry file: the folder
/// `AGENTMON_DIR` names, and (in development) an `AgentMonitoring` folder found beside the
/// executable. Computed once at startup; the registry is re-read on every use because the
/// CLI appends to it while the app runs.
struct ExtraRoots(Vec<PathBuf>);

fn discover_extra_roots() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(env) = std::env::var_os("AGENTMON_DIR") {
        let p = PathBuf::from(env);
        let root = if p.join("project.json").is_file() {
            p
        } else {
            p.join(DATA_DIR)
        };
        out.push(root);
    }
    // Development fallback: `target/debug/agentmonitoring.exe` is a few levels below the
    // repo root, and the repo's own AgentMonitoring folder is the live demo data.
    if let Ok(exe) = std::env::current_exe() {
        let mut dir: Option<&Path> = exe.parent();
        for _ in 0..5 {
            let Some(d) = dir else { break };
            let cand = d.join(DATA_DIR);
            if cand.join("project.json").is_file() {
                out.push(cand);
                break;
            }
            dir = d.parent();
        }
    }
    out
}

/// Every root this window should show: registry entries first (their order is the human's),
/// then the extra roots, deduplicated on the stored path.
fn all_roots(extra: &[PathBuf]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for p in Registry::load()
        .projects
        .iter()
        .map(|e| e.path.clone())
        .chain(extra.iter().cloned())
    {
        let key = std::fs::canonicalize(&p).unwrap_or_else(|_| p.clone());
        if seen.insert(key) {
            out.push(p);
        }
    }
    out
}

/// The stable id inside a root's project.json, without computing counts.
fn id_at(root: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(root.join("project.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("id")?.as_str().map(str::to_string)
}

/// Resolve a project id to its open store, or say why it cannot be.
///
/// Two different answers on purpose. When every registered folder is readable and none
/// carries the id, the id is not on this machine — a stale route, and the screens draw
/// the no-such-project card. When a registered folder *cannot be read*, it might be the
/// one asked for — an unplugged drive is not a deleted project — so the answer is a
/// sentence the frontend classifies as "unreadable", which keeps the last good screen up
/// instead of replacing it with an error card every time a folder blinks.
fn store_for(extra: &State<'_, ExtraRoots>, id: &str) -> CmdResult<Store> {
    let mut unreachable: Vec<PathBuf> = Vec::new();
    for root in all_roots(&extra.0) {
        if !root.join("project.json").is_file() {
            unreachable.push(root);
            continue;
        }
        if id_at(&root).as_deref() == Some(id) {
            return Store::open_with_source(&root, "registry").map_err(|e| e.to_string());
        }
    }
    if !unreachable.is_empty() {
        return Err(format!(
            "cannot tell whether project '{id}' is here — {} registered folder(s) cannot be \
             read right now: {}",
            unreachable.len(),
            unreachable
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    Err(format!(
        "no project with id '{id}' is registered on this machine (the folder may have been \
         removed from the list, or its drive unplugged)"
    ))
}

/// One row of the Projects screen / sidebar. `project` is present when the folder is
/// readable; `error` says why when it is not. An unreadable row is information, not a
/// crash — the other projects keep rendering.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRow {
    available: bool,
    path: String,
    /// Last name the registry saw, for labelling an unavailable row.
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<Project>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn row_for(root: &Path, cached_name: Option<String>) -> ProjectRow {
    match Store::open_with_source(root, "registry").and_then(|s| s.project()) {
        Ok(p) => ProjectRow {
            available: true,
            path: root.display().to_string(),
            name: Some(p.name.clone()),
            project: Some(p),
            error: None,
        },
        Err(e) => ProjectRow {
            available: false,
            path: root.display().to_string(),
            name: cached_name,
            project: None,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
fn list_projects(extra: State<'_, ExtraRoots>) -> CmdResult<Vec<ProjectRow>> {
    let reg = Registry::load();
    let cached: HashMap<PathBuf, Option<String>> = reg
        .projects
        .iter()
        .map(|e| (e.path.clone(), e.name.clone()))
        .collect();
    let mut rows: Vec<ProjectRow> = all_roots(&extra.0)
        .iter()
        .map(|root| row_for(root, cached.get(root).cloned().flatten()))
        .collect();
    // Most recently active first, unavailable rows last — the order a sidebar wants.
    rows.sort_by(|a, b| {
        b.available.cmp(&a.available).then_with(|| {
            let la = a.project.as_ref().and_then(|p| p.counts.last_activity.clone());
            let lb = b.project.as_ref().and_then(|p| p.counts.last_activity.clone());
            lb.cmp(&la)
        })
    });
    Ok(rows)
}

#[tauri::command]
fn get_project(id: String, extra: State<'_, ExtraRoots>) -> CmdResult<Project> {
    store_for(&extra, &id)?.project().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_worklogs(id: String, extra: State<'_, ExtraRoots>) -> CmdResult<Vec<WorklogSummary>> {
    store_for(&extra, &id)?.worklogs().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_worklog(
    id: String,
    record: String,
    extra: State<'_, ExtraRoots>,
) -> CmdResult<WorklogDetail> {
    store_for(&extra, &id)?.worklog(&record).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_bugs(
    id: String,
    extra: State<'_, ExtraRoots>,
) -> CmdResult<Vec<agentmon_core::BugSummary>> {
    store_for(&extra, &id)?.bugs().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_bug(id: String, record: String, extra: State<'_, ExtraRoots>) -> CmdResult<BugDetail> {
    store_for(&extra, &id)?.bug(&record).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_notes(id: String, extra: State<'_, ExtraRoots>) -> CmdResult<Vec<NoteSummary>> {
    store_for(&extra, &id)?.notes().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_note(id: String, record: String, extra: State<'_, ExtraRoots>) -> CmdResult<NoteDetail> {
    store_for(&extra, &id)?.note(&record).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_events(
    id: String,
    limit: Option<usize>,
    extra: State<'_, ExtraRoots>,
) -> CmdResult<Vec<Event>> {
    store_for(&extra, &id)?.events(limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_status(id: String, extra: State<'_, ExtraRoots>) -> CmdResult<ProjectStatusSnapshot> {
    store_for(&extra, &id)?.status().map_err(|e| e.to_string())
}

/// An image a record body references (`![alt](assets/diagram.svg)`), as raw bytes — the
/// window turns them into a blob URL for `<img>`. Path safety is agentmon-core's
/// (`Store::asset`): relative, inside the project folder after symlinks, image extensions
/// only. Raw `ipc::Response` rather than JSON so a PNG is not base64'd through serde.
#[tauri::command]
fn get_record_asset(
    id: String,
    path: String,
    extra: State<'_, ExtraRoots>,
) -> CmdResult<tauri::ipc::Response> {
    let bytes = store_for(&extra, &id)?.asset(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------------------------------------------------------------------------
// creating, opening, removing, deleting
// ---------------------------------------------------------------------------

/// After anything that changes *which* projects exist: watch the new set, tell every
/// screen. One helper so no path forgets a step.
fn roster_changed(app: &AppHandle) {
    let extra: State<'_, ExtraRoots> = app.state();
    let watchers: State<'_, WatcherState> = app.state();
    rearm_watchers(app, &watchers, &all_roots(&extra.0));
    let _ = app.emit("projects-changed", ());
}

/// The machine-level App feedback board: bugs and wishes agents filed about this app
/// itself (`~/.AgentMonitoring/feedback`), belonging to no project.
#[tauri::command]
fn list_app_feedback() -> CmdResult<Vec<agentmon_core::FeedbackItem>> {
    agentmon_core::list_feedback().map_err(|e| e.to_string())
}

/// The human working the board: mark an item handled, or put it back.
#[tauri::command]
fn set_app_feedback_status(id: String, status: String) -> CmdResult<agentmon_core::FeedbackItem> {
    let status = agentmon_core::parse_feedback_status(&status).map_err(|e| e.to_string())?;
    agentmon_core::set_feedback_status(&id, status).map_err(|e| e.to_string())
}

/// Delete a done item for good — clearing a worked board. Core refuses while the item
/// is still open (done-first, so a complaint can never vanish unread).
#[tauri::command]
fn delete_app_feedback(id: String) -> CmdResult<agentmon_core::FeedbackItem> {
    agentmon_core::delete_feedback(&id).map_err(|e| e.to_string())
}

/// The location picker for the **New project** dialog. Returns the folder the human chose
/// (typically a code repo root) — creation happens in [`create_project`] once the form is
/// submitted, so the dialog can show the path before anything is written.
#[tauri::command]
async fn pick_project_location(app: AppHandle) -> CmdResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Choose the folder this project's records live in")
        .blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked
        .simplified()
        .into_path()
        .map_err(|e| format!("that folder cannot be used: {e}"))?;
    Ok(Some(dir.display().to_string()))
}

/// Create a project: an `AgentMonitoring` folder inside `location`, through the same
/// `agentmon-core` write path the CLI uses — including the `project_created` event, which
/// is what the activity feed is built from.
#[tauri::command]
fn create_project(
    location: String,
    name: String,
    description: String,
    tags: Vec<String>,
    agent: String,
    claude_md: Option<String>,
    mcp_json: Option<bool>,
    mcp_agent: Option<String>,
    app: AppHandle,
) -> CmdResult<Project> {
    // Parsed before anything is written: a bad language must not leave behind a project
    // that a corrected retry then refuses to create.
    let claude_md = claude_md
        .as_deref()
        .map(agentmon_core::parse_claude_md_lang)
        .transpose()
        .map_err(|e| e.to_string())?;
    let location = PathBuf::from(location);
    let store = Store::init(
        &location,
        &NewProject {
            name,
            description,
            tags,
            actor: agent,
            at: None,
        },
    )
    .map_err(|e| e.to_string())?;
    let project = store.project().map_err(|e| e.to_string())?;
    let mut reg = Registry::load();
    reg.add(store.root(), Some(&project.name));
    let _ = reg.save(); // best effort — the project exists either way
    roster_changed(&app);
    if let Some(lang) = claude_md {
        agentmon_core::write_claude_md(store.location(), lang)
            .map_err(|e| format!("the project was created, but CLAUDE.md was not: {e}"))?;
    }
    if mcp_json.unwrap_or(false) {
        // This process knows where its bundled mcp/server.mjs is — the whole reason the
        // registration is written by the app instead of being homework in CLAUDE.md.
        let server = agentmon_core::find_mcp_server().ok_or_else(|| {
            "the project was created, but .mcp.json was not: this build has no \
             mcp/server.mjs beside it"
                .to_string()
        })?;
        agentmon_core::write_mcp_json(store.location(), &server, mcp_agent.as_deref())
            .map_err(|e| format!("the project was created, but .mcp.json was not: {e}"))?;
    }
    Ok(project)
}

/// Open an existing project: pick a folder that is (or contains) an `AgentMonitoring`
/// project, register it, and show it. `Ok(None)` means the dialog was dismissed.
#[tauri::command]
async fn open_project(app: AppHandle) -> CmdResult<Option<Project>> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open a project folder")
        .blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked
        .simplified()
        .into_path()
        .map_err(|e| format!("that folder cannot be read: {e}"))?;

    let store = Store::open(&dir).map_err(|e| {
        format!(
            "{e}\n\nPick the folder that holds the {DATA_DIR} folder (or that folder itself). \
             To start a new project here instead, use New project."
        )
    })?;
    let project = store.project().map_err(|e| e.to_string())?;
    let mut reg = Registry::load();
    reg.add(store.root(), Some(&project.name));
    let _ = reg.save();
    roster_changed(&app);
    Ok(Some(project))
}

/// Take a project off this machine's list. **Touches no files** — the folder stays where
/// it is, and opening it again brings it back. The undoable half of "get this out of my
/// sidebar"; [`delete_project`] is the other half.
///
/// Keyed by path, not id: the row most in need of removing is the unavailable one, whose
/// folder — and therefore whose id — cannot be read any more.
#[tauri::command]
fn remove_project(path: String, app: AppHandle) -> CmdResult<bool> {
    let mut reg = Registry::load();
    let removed = reg.remove(Path::new(&path));
    if removed {
        reg.save().map_err(|e| e.to_string())?;
    }
    roster_changed(&app);
    Ok(removed)
}

/// Delete a project: its `AgentMonitoring` folder, its records and its event log, off the
/// disk.
///
/// **The only destructive command in this app, and it is the app's alone.** There is no
/// `agentmon project delete` and no MCP tool for it — agents write records and never take
/// one away — so this is reachable from exactly one place: the dialog on the Projects
/// screen, which will not enable its button until the human has typed the project's name
/// (src/components/DeleteProject.tsx). Browser mode has the same route for the same dialog
/// (`DELETE /project-api/projects/:id`, scripts/project-fs.mjs).
///
/// The path safety is `agentmon-core`'s: only a canonicalised folder actually named
/// `AgentMonitoring` with a project.json inside can be removed — never the code around it.
///
/// `agent` is who the app records as doing it. It cannot go into the project — the event
/// log that would hold the line is inside the directory being removed — so it goes to this
/// process's own stderr, which is where a human running the app from a terminal will look,
/// and comes back in the payload so the window can say it.
#[tauri::command]
fn delete_project(
    id: String,
    agent: Option<String>,
    app: AppHandle,
    extra: State<'_, ExtraRoots>,
) -> CmdResult<Deleted> {
    let store = store_for(&extra, &id)?;
    let mut gone = store.delete_project().map_err(|e| e.to_string())?;
    gone.deleted_by = agent.unwrap_or_else(|| "app".to_string());
    eprintln!(
        "agentmonitoring: {} deleted project {} — {} work logs, {} bugs, {} notes, {} events, from {}",
        gone.deleted_by,
        gone.name,
        gone.counts.work_total,
        gone.counts.bugs_total,
        gone.counts.notes_total,
        gone.counts.events,
        gone.path
    );
    let mut reg = Registry::load();
    if reg.remove(store.root()) {
        let _ = reg.save();
    }
    roster_changed(&app);
    Ok(gone)
}

// ---------------------------------------------------------------------------
// settings (locale)
// ---------------------------------------------------------------------------

/// One file holds every choice the human has made about this window. In v2 that is just
/// the language — the project list has its own home in ~/.AgentMonitoring, because the
/// CLI writes it too and this file is Tauri's.
fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> serde_json::Map<String, serde_json::Value> {
    settings_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &serde_json::Map<String, serde_json::Value>) {
    let Some(file) = settings_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::Value::Object(settings.clone());
    if let Err(e) = std::fs::write(&file, format!("{}\n", serde_json::to_string_pretty(&json).unwrap()))
    {
        eprintln!(
            "agentmonitoring: could not write {} ({e}); this window's choices will be used \
             for this session only",
            file.display()
        );
    }
}

/// The language the human last chose. `None` on a machine that has never answered — the
/// window then keeps its default, which is Korean (src/lib/i18n/index.ts).
#[tauri::command]
fn get_locale(app: AppHandle) -> Option<String> {
    read_settings(&app)
        .get("locale")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[tauri::command]
fn set_locale(app: AppHandle, locale: String) {
    let mut settings = read_settings(&app);
    settings.insert("locale".into(), serde_json::Value::String(locale.clone()));
    write_settings(&app, &settings);
    // The tray menu is the one piece of this app's text the WebView does not draw, so the
    // language toggle has to reach it by hand. Best effort: a tray that failed to build
    // at startup has nothing to relabel.
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = tray_menu(&app, &locale) {
            let _ = tray.set_menu(Some(menu));
        }
    }
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

/// `docs/AGENT_MANUAL.md`, if this machine has it.
///
/// An installed copy is two executables: the manual is a file in the source tree, not part
/// of the bundle. Looked up beside the executable, then a few levels up (which covers
/// `target/debug/agentmonitoring.exe` in development); `None` is the normal answer — the
/// screen then names `agentmon --help`, which ships.
#[tauri::command]
fn manual_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let mut dir: Option<&Path> = exe.parent();
    for _ in 0..5 {
        let d = dir?;
        let candidate = d.join("docs").join("AGENT_MANUAL.md");
        if candidate.is_file() {
            return Some(candidate.display().to_string());
        }
        dir = d.parent();
    }
    None
}

// ---------------------------------------------------------------------------
// tray — closing the window keeps the app (and every watcher) running
// ---------------------------------------------------------------------------

/// The one tray icon's stable id: `set_locale` looks it up to rebuild the menu, and the
/// close handler looks it up to decide whether hiding is safe at all.
const TRAY_ID: &str = "agentmonitoring-tray";

/// The language the tray speaks — the same settings.json the window reads, with the same
/// default (Korean, src/lib/i18n/index.ts), so the menu and the window never disagree.
fn locale_of(app: &AppHandle) -> String {
    read_settings(app)
        .get("locale")
        .and_then(|v| v.as_str())
        .unwrap_or("ko")
        .to_string()
}

/// Open / ─ / Quit. "열기" names the app because a tray is a row of anonymous 16px icons
/// from every app on the machine; "완전히 종료" says *completely* because the X button no
/// longer quits — this menu item is now the only way out, and its label carries that.
fn tray_menu(app: &AppHandle, locale: &str) -> tauri::Result<Menu<Wry>> {
    let (open, quit) = if locale == "en" {
        ("Open AgentMonitoring", "Quit completely")
    } else {
        ("AgentMonitoring 열기", "완전히 종료")
    };
    let open = MenuItem::with_id(app, "tray-open", open, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", quit, true, None::<&str>)?;
    Menu::with_items(app, &[&open, &sep, &quit])
}

/// Bring the main window back from wherever closing or minimising put it.
fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn init_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app, &locale_of(app))?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("AgentMonitoring")
        .menu(&menu)
        // Left click opens the window; only the right button opens the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-open" => show_main_window(app),
            "tray-quit" => {
                // Windows keeps a ghost icon in the tray until the next hover unless the
                // icon is taken down before the process goes.
                let _ = app.remove_tray_by_id(TRAY_ID);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// live updates — one watcher per registered project
// ---------------------------------------------------------------------------

/// Coalescing window for a burst of filesystem events. One `agentmon work update` writes
/// a temp file, renames it over the record and appends to `events.jsonl`; an editor save
/// is similar. Without a window the UI would reload three or four times per write.
const DEBOUNCE: Duration = Duration::from_millis(250);
/// Upper bound on coalescing, so a long stream of writes still refreshes the UI while it
/// is happening instead of only when it stops.
const MAX_COALESCE: Duration = Duration::from_millis(1500);

/// Payload of the `project-changed` event: which folder changed, and (when its
/// project.json is readable) which project id that is, so a screen can decide whether the
/// change concerns it.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectChanged {
    path: String,
    id: Option<String>,
}

/// The live watchers, one per project root. Dropping a watcher stops watching, so they are
/// held here for the lifetime of the app and the map is rewritten (not appended to) when
/// the roster changes — a project removed from the list must stop reporting.
#[derive(Default)]
struct WatcherState {
    watchers: Mutex<HashMap<PathBuf, RecommendedWatcher>>,
    /// Roots that were unreachable on the last watchdog tick — the diff is what turns
    /// into a `projects-changed` emit when a drive comes back or goes away.
    unavailable: Mutex<HashSet<PathBuf>>,
}

/// Watch exactly `roots`: arm what is missing, drop what is no longer wanted. OS-event
/// driven (no polling) — per the SPEC v2 performance rules, idle cost is zero however
/// many projects are registered.
fn rearm_watchers(app: &AppHandle, state: &WatcherState, roots: &[PathBuf]) {
    let Ok(mut map) = state.watchers.lock() else { return };
    let wanted: HashSet<PathBuf> = roots.iter().cloned().collect();
    map.retain(|root, _| wanted.contains(root));
    for root in roots {
        if map.contains_key(root) {
            continue;
        }
        if !root.join("project.json").is_file() {
            continue; // unavailable; the watchdog arms it when it comes back
        }
        match watch_store(app, root) {
            Ok(w) => {
                map.insert(root.clone(), w);
            }
            Err(e) => eprintln!(
                "agentmonitoring: not watching {} for changes ({e}); the app will still read \
                 it, but its screens will not refresh on their own",
                root.display()
            ),
        }
    }
}

fn watch_store(app: &AppHandle, root: &Path) -> notify::Result<RecommendedWatcher> {
    let app = app.clone();
    spawn_store_watcher(root, move |change| {
        let _ = app.emit("project-changed", change);
    })
}

/// The watcher itself, independent of Tauri: watch one project folder and call `on_change`
/// once per burst of filesystem activity. Split out from [`watch_store`] so the debounce
/// can be tested against a real directory without a window.
fn spawn_store_watcher(
    root: &Path,
    on_change: impl Fn(ProjectChanged) + Send + 'static,
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
    watcher.watch(root, RecursiveMode::Recursive)?;

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
            on_change(ProjectChanged {
                path: root.display().to_string(),
                id: id_at(&root),
            });
        }
    });
    Ok(watcher)
}

/// Does this filesystem event touch a file a reader would render?
///
/// Only three things in a project are readable data: `*.md` records, `events.jsonl` and
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

// ---------------------------------------------------------------------------
// watcher health (a project that goes away dims; it does not freeze the app)
// ---------------------------------------------------------------------------

/// How often the app checks that every registered project is still reachable.
///
/// A `notify` handle on a directory that has been renamed, unmounted or unplugged does not
/// fail — it simply never fires again. One `project.json` probe per project every five
/// seconds is a rounding error next to the file watches themselves, and it is what turns
/// an unplugged drive into an "unavailable" row instead of a silently frozen one.
const HEALTH_INTERVAL: Duration = Duration::from_secs(5);

/// One watchdog tick, as a pure decision: which roots changed reachability since last
/// time. `Some` means "the roster looks different — re-arm and tell the UI".
fn availability_shift(
    roots: &[PathBuf],
    previously_unavailable: &HashSet<PathBuf>,
) -> Option<HashSet<PathBuf>> {
    let now_unavailable: HashSet<PathBuf> = roots
        .iter()
        .filter(|r| !r.join("project.json").is_file())
        .cloned()
        .collect();
    if now_unavailable == *previously_unavailable {
        None
    } else {
        Some(now_unavailable)
    }
}

/// Watch the watchers: when a project folder disappears or comes back, re-arm the set and
/// emit `projects-changed` so every screen re-reads what it missed. Started once, from
/// `setup`, and it outlives every roster change.
fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(HEALTH_INTERVAL);
        let extra: State<'_, ExtraRoots> = app.state();
        let watchers: State<'_, WatcherState> = app.state();
        let roots = all_roots(&extra.0);
        let prev = watchers
            .unavailable
            .lock()
            .map(|u| u.clone())
            .unwrap_or_default();
        if let Some(now) = availability_shift(&roots, &prev) {
            if let Ok(mut slot) = watchers.unavailable.lock() {
                *slot = now.clone();
            }
            // Drop watchers whose directories are gone (they are dead handles), arm the
            // ones that came back, and let the UI re-read everything it missed.
            if let Ok(mut map) = watchers.watchers.lock() {
                map.retain(|root, _| !now.contains(root));
            }
            rearm_watchers(&app, &watchers, &roots);
            let _ = app.emit("projects-changed", ());
        }
    });
}

/// Kept so the frontend's `Bug` type has a Rust-side witness in this crate's API surface.
#[allow(dead_code)]
fn _type_witness(_: Bug) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, per its own docs: a second launch — the desktop icon, double-clicked by
        // somebody who forgot the app is sitting in the tray — surfaces this window
        // instead of starting a second process watching the same folders.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ExtraRoots(discover_extra_roots()))
        .manage(WatcherState::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing hides; quitting is the tray menu's job. A monitor that dies with
                // its window stops watching exactly when nobody is looking — which is when
                // agents write. Guarded on the tray actually existing: a hidden window
                // with no tray icon would be unrecoverable, so if the tray could not be
                // built the X closes for real.
                if window.app_handle().tray_by_id(TRAY_ID).is_some() {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let extra: State<'_, ExtraRoots> = app.state();
            let watchers: State<'_, WatcherState> = app.state();
            // Watch every registered project, so a record an agent writes shows up
            // without a navigation.
            rearm_watchers(app.handle(), &watchers, &all_roots(&extra.0));
            // …and watch the watchers, so a folder that goes away dims its row instead of
            // the window quietly freezing on the last numbers it read.
            spawn_watchdog(app.handle().clone());
            // The tray, without which closing quits (see on_window_event above).
            if let Err(e) = init_tray(app.handle()) {
                eprintln!(
                    "agentmonitoring: no tray icon ({e}); closing the window will quit the app"
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            get_project,
            create_project,
            open_project,
            remove_project,
            delete_project,
            list_app_feedback,
            set_app_feedback_status,
            delete_app_feedback,
            pick_project_location,
            cli_path,
            manual_path,
            get_locale,
            set_locale,
            list_worklogs,
            get_worklog,
            list_bugs,
            get_bug,
            list_notes,
            get_note,
            list_events,
            get_status,
            get_record_asset,
            update::check_app_update,
            update::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentMonitoring");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc::channel;

    /// A minimal v2 project folder: <base>/AgentMonitoring with a project.json.
    fn tmp_store(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "agentmonitoring-watch-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let root = base.join(DATA_DIR);
        fs::create_dir_all(root.join("worklogs")).unwrap();
        fs::write(
            root.join("project.json"),
            format!("{{\"version\":2,\"id\":\"prj-{tag}\",\"name\":\"t\"}}"),
        )
        .unwrap();
        root
    }

    /// The whole point of live updates: a write to the project produces exactly one
    /// refresh, naming the folder (and id) that changed.
    #[test]
    fn a_record_write_produces_one_debounced_change_event() {
        let root = tmp_store("burst");
        let (tx, rx) = channel::<ProjectChanged>();
        let _watcher = spawn_store_watcher(&root, move |c| {
            let _ = tx.send(c);
        })
        .expect("watcher starts");
        // Give the platform backend a moment to arm before touching the directory.
        std::thread::sleep(Duration::from_millis(300));

        // What `agentmon work update` does: temp file, rename over the record, append to
        // the event log — three filesystem operations, one logical change.
        let tmp = root.join("worklogs").join(".WORK-0001.md.123.456.tmp");
        fs::write(&tmp, "---\nid: WORK-0001\n---\n\n## What\n\nx\n").unwrap();
        fs::rename(&tmp, root.join("worklogs").join("WORK-0001.md")).unwrap();
        fs::write(root.join("events.jsonl"), "{\"ts\":\"t\"}\n").unwrap();

        let change = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("a project-changed event arrives");
        assert_eq!(change.path, root.display().to_string());
        assert_eq!(change.id.as_deref(), Some("prj-burst"));
        // The burst coalesced: nothing else arrives right behind it.
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "one write must not produce a second refresh"
        );
        fs::remove_dir_all(root.parent().unwrap()).ok();
    }

    /**
     * Two projects, two watchers, no crosstalk: each burst names its own folder, and
     * dropping one watcher (a project removed from the list) silences that folder alone.
     */
    #[test]
    fn watchers_are_per_project_and_dropping_one_silences_only_it() {
        let a = tmp_store("multi-a");
        let b = tmp_store("multi-b");
        let (tx, rx) = channel::<ProjectChanged>();
        let tx_b = tx.clone();

        let watcher_a = spawn_store_watcher(&a, move |c| {
            let _ = tx.send(c);
        })
        .expect("watcher a starts");
        let _watcher_b = spawn_store_watcher(&b, move |c| {
            let _ = tx_b.send(c);
        })
        .expect("watcher b starts");
        std::thread::sleep(Duration::from_millis(300));

        fs::write(
            a.join("worklogs").join("WORK-0001.md"),
            "---\nid: WORK-0001\n---\n\n## What\n\nin a\n",
        )
        .unwrap();
        let change = rx.recv_timeout(Duration::from_secs(10)).expect("a reports");
        assert_eq!(change.id.as_deref(), Some("prj-multi-a"));

        // Removing a project from the list drops its watcher; the other keeps reporting.
        drop(watcher_a);
        std::thread::sleep(Duration::from_millis(300));
        fs::write(
            a.join("worklogs").join("WORK-0002.md"),
            "---\nid: WORK-0002\n---\n\n## What\n\nunwatched\n",
        )
        .unwrap();
        fs::write(
            b.join("worklogs").join("WORK-0001.md"),
            "---\nid: WORK-0001\n---\n\n## What\n\nin b\n",
        )
        .unwrap();
        let change = rx.recv_timeout(Duration::from_secs(10)).expect("b reports");
        assert_eq!(change.id.as_deref(), Some("prj-multi-b"), "only b is still watched");
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "the dropped folder must not report"
        );
        fs::remove_dir_all(a.parent().unwrap()).ok();
        fs::remove_dir_all(b.parent().unwrap()).ok();
    }

    /**
     * A project being deleted has to reach an open window the same way a record being
     * written does. `remove_dir_all` produces a burst of Remove events on files that no
     * longer exist, so `is_record_change` cannot probe them with `is_dir()`; it reads the
     * extension, which is why that burst still surfaces instead of being filtered as
     * directory noise.
     */
    #[test]
    fn deleting_a_project_directory_is_reported_as_a_change() {
        let root = tmp_store("delete");
        fs::write(
            root.join("worklogs").join("WORK-0001.md"),
            "---\nid: WORK-0001\n---\n\n## What\n\nx\n",
        )
        .unwrap();
        fs::write(root.join("events.jsonl"), "{\"ts\":\"t\"}\n").unwrap();

        let (tx, rx) = channel::<ProjectChanged>();
        let _watcher = spawn_store_watcher(&root, move |c| {
            let _ = tx.send(c);
        })
        .expect("watcher starts");
        std::thread::sleep(Duration::from_millis(300));

        fs::remove_dir_all(&root).unwrap();

        let change = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("deleting a project reaches the window");
        assert_eq!(change.path, root.display().to_string());
        assert_eq!(change.id, None, "the folder is gone, so there is no id to read");
        fs::remove_dir_all(root.parent().unwrap()).ok();
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
        // A note write is a record change like any other .md; its directory is not.
        assert!(is_record_change(&ev("registry-gate-gotcha.md")));
        // Windows reports a Modify on the containing directory too, sometimes hundreds of
        // milliseconds after the burst it belongs to. Those must not become refreshes.
        assert!(!is_record_change(&ev("worklogs")));
        assert!(!is_record_change(&ev("notes")));
        assert!(!is_record_change(&ev("AgentMonitoring")));

        let mut read = ev("WORK-0001.md");
        read.kind = EventKind::Access(notify::event::AccessKind::Read);
        assert!(!is_record_change(&read), "reading a record is not a change");
    }

    /**
     * The watchdog's rule, without a window: nothing changed → say nothing; a folder went
     * away or came back → the new unavailable set comes out, which is what triggers the
     * re-arm and the `projects-changed` emit. This is the per-row version of the v1
     * freeze fix: one unplugged drive dims one row.
     */
    #[test]
    fn the_watchdog_reports_only_availability_shifts() {
        let alive = tmp_store("dog-alive");
        let dead = std::env::temp_dir().join("agentmonitoring-not-there").join(DATA_DIR);
        let roots = vec![alive.clone(), dead.clone()];

        // First tick: `dead` is newly unavailable.
        let shift = availability_shift(&roots, &HashSet::new()).expect("a shift is reported");
        assert!(shift.contains(&dead));
        assert!(!shift.contains(&alive));

        // Same state again: silence.
        assert!(availability_shift(&roots, &shift).is_none());

        // The folder disappears mid-session: another shift.
        fs::remove_dir_all(alive.parent().unwrap()).unwrap();
        let shift2 = availability_shift(&roots, &shift).expect("losing a folder is a shift");
        assert!(shift2.contains(&alive));
    }

    #[test]
    fn all_roots_deduplicates_registry_and_extras() {
        // Point the registry at a scratch home so this test never touches the real one.
        let home = std::env::temp_dir().join(format!(
            "agentmonitoring-roots-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&home).unwrap();
        std::env::set_var("AGENTMON_REGISTRY_DIR", &home);

        let store = tmp_store("roots");
        let mut reg = Registry::load();
        reg.add(&store, Some("t"));
        reg.save().unwrap();

        // The same folder arriving again as an extra root (e.g. AGENTMON_DIR) is one row.
        let roots = all_roots(&[store.clone()]);
        assert_eq!(roots.len(), 1, "{roots:?}");

        std::env::remove_var("AGENTMON_REGISTRY_DIR");
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(store.parent().unwrap()).ok();
    }
}
