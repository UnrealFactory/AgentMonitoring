//! Tauri shell. Every command is a thin wrapper over agentmon-core — the desktop app
//! knows nothing about the on-disk format.
//!
//! The command names and payloads here are the same contract the Vite dev middleware
//! (`/vault-api/*`) serves in browser mode; `src/lib/api.ts` picks a transport at runtime.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use agentmon_core::{
    Bug, BugDetail, Event, Project, ProjectStatusSnapshot, Vault, VaultInfo, WorklogDetail,
    WorklogSummary,
};
use tauri::{Manager, State};

/// Where the vault lives for this session. Mutable so a human can point the app at a
/// vault they copied to another machine (SPEC: portability).
struct VaultState(Mutex<Option<PathBuf>>);

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
fn set_vault_path(path: String, state: State<'_, VaultState>) -> CmdResult<VaultInfo> {
    let vault = Vault::open(&path).map_err(|e| e.to_string())?;
    let info = vault.info().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|_| "vault state poisoned")? = Some(PathBuf::from(&path));
    Ok(info)
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
        .setup(|app| {
            // Surface the resolved vault in the window title so a human always knows
            // which data they are looking at.
            let state: State<'_, VaultState> = app.state();
            if let Ok(vault) = open(&state) {
                if let Ok(info) = vault.info() {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title(&format!("AgentMonitoring — {}", info.name));
                    }
                }
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
