//! In-app updates, the plain way.
//!
//! The app asks GitHub Releases for the newest published version; when there is one, the
//! sidebar shows a card, and the button hands the rest to a **visible PowerShell window**:
//! download the installer, wait for this process to exit, run the installer silently
//! (`/S` — the NSIS bundle installs per-user, so no UAC), relaunch the app. The window is
//! deliberately not hidden — the human asked for an update and gets to watch it happen,
//! and if anything fails the message stays on screen until they press Enter.
//!
//! Why not tauri-plugin-updater: it wants a signing keypair and a hosted manifest, and
//! everything this app needs — one exe, one repo, one OS — is a GET to the Releases API
//! and one script. The check runs from Rust, not the WebView, so the CSP keeps its
//! "no network from the window" shape.

use serde::Deserialize;
use tauri::{AppHandle, Manager};

/// Where releases live. The repo is public; the unauthenticated API allows 60 requests an
/// hour per address, and this app makes two an hour (launch + the half-hour recheck).
const REPO: &str = "UnrealFactory/AgentMonitoring";

/// What the frontend needs to draw the card and press the button.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub has_update: bool,
    /// Release notes (the release body), for the card's tooltip.
    pub notes: String,
    /// The `*-setup.exe` asset. `None` when a release has no Windows installer — the
    /// card then opens `page_url` instead of scripting anything.
    pub installer_url: Option<String>,
    pub installer_size: Option<u64>,
    pub page_url: String,
}

// The three fields of the Releases API answer this module reads. Everything else in that
// payload is somebody else's contract.
#[derive(Deserialize)]
struct ReleaseJson {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<AssetJson>,
}

#[derive(Deserialize)]
struct AssetJson {
    name: String,
    size: u64,
    browser_download_url: String,
}

/// `"v1.2.10"` → `[1, 2, 10]`, so versions compare as numbers, not words — `"1.10"` is
/// newer than `"1.9"`. A part that is not a number counts as 0 (a tag like `1.0.0-rc`
/// never outranks its release).
fn version_key(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split('.')
        .map(|part| {
            let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    version_key(latest) > version_key(current)
}

/// The one asset the updater knows how to run: the NSIS installer the release script
/// uploads (`AgentMonitoring_<version>_x64-setup.exe`).
fn pick_installer(assets: &[AssetJson]) -> Option<&AssetJson> {
    assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe"))
}

fn fetch_latest(current: &str) -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let release: ReleaseJson = ureq::get(&url)
        .set("User-Agent", "AgentMonitoring-updater")
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => {
                format!("no release has been published at github.com/{REPO} yet")
            }
            other => format!("could not reach github.com to check for updates: {other}"),
        })?
        .into_json()
        .map_err(|e| format!("the releases answer from github.com could not be read: {e}"))?;

    let latest = release.tag_name.trim_start_matches(['v', 'V']).to_string();
    let installer = pick_installer(&release.assets);
    Ok(UpdateInfo {
        has_update: is_newer(&release.tag_name, current),
        current: current.to_string(),
        latest,
        notes: release.body.unwrap_or_default(),
        installer_url: installer.map(|a| a.browser_download_url.clone()),
        installer_size: installer.map(|a| a.size),
        page_url: release.html_url,
    })
}

/// Ask GitHub whether a newer version exists. Called on launch and every half hour by the
/// sidebar card; an `Err` means "could not check" (offline, no release yet) and the card
/// simply does not appear.
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || fetch_latest(&current))
        .await
        .map_err(|e| format!("the update check did not finish: {e}"))?
}

/// Escape a value into a PowerShell single-quoted string: `'` doubles, nothing else has
/// meaning. Everything interpolated into the script goes through this.
fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// The whole update, as one PowerShell script the human can watch. `pid` is this process
/// — the script downloads first (the slow part, with the app still up), then waits for the
/// exit the app schedules right after spawning it.
fn update_script(url: &str, version: &str, current: &str, exe: &str, pid: u32, ko: bool) -> String {
    let (downloading, waiting, installing, done, failed, retry, press_enter) = if ko {
        (
            "[1/3] 설치 파일을 내려받는 중…",
            "[2/3] 앱이 닫히기를 기다리는 중…",
            "[3/3] 새 버전을 설치하는 중…",
            "업데이트 완료 — 앱을 다시 시작합니다.",
            "업데이트에 실패했습니다:",
            "이 창을 닫고 앱을 다시 실행한 뒤, 업데이트를 다시 시도해 주세요.",
            "Enter 키를 누르면 창이 닫힙니다",
        )
    } else {
        (
            "[1/3] Downloading the installer…",
            "[2/3] Waiting for the app to close…",
            "[3/3] Installing the new version…",
            "Update complete — restarting the app.",
            "The update failed:",
            "Close this window, start the app again, and retry the update.",
            "Press Enter to close",
        )
    };
    let q_url = ps_quote(url);
    let q_exe = ps_quote(exe);
    let setup_name = ps_quote(&format!("AgentMonitoring_{version}_setup.exe"));
    format!(
        r#"$ErrorActionPreference = 'Stop'
try {{ [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 }} catch {{}}
$Host.UI.RawUI.WindowTitle = 'AgentMonitoring update'
Write-Host ''
Write-Host ('  AgentMonitoring  v{current}  ->  v{version}') -ForegroundColor White
Write-Host ''
try {{
  $setup = Join-Path $env:TEMP {setup_name}
  Write-Host '{downloading}' -ForegroundColor Cyan
  Invoke-WebRequest -Uri {q_url} -OutFile $setup
  Write-Host '{waiting}' -ForegroundColor Cyan
  Wait-Process -Id {pid} -Timeout 60 -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Write-Host '{installing}' -ForegroundColor Cyan
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  if ($p.ExitCode -ne 0) {{ throw ('installer exited with code ' + $p.ExitCode) }}
  Remove-Item $setup -ErrorAction SilentlyContinue
  Write-Host ''
  Write-Host '{done}' -ForegroundColor Green
  Start-Process -FilePath {q_exe}
  Start-Sleep -Seconds 2
}} catch {{
  Write-Host ''
  Write-Host ('{failed} ' + $_) -ForegroundColor Red
  Write-Host '{retry}'
  Read-Host '{press_enter}'
}}
"#
    )
}

/// Download-and-install, visibly. Spawns the PowerShell window, then exits this app a
/// beat later so the invoke can resolve and the card can say what is happening.
#[tauri::command]
pub async fn install_app_update(app: AppHandle, url: String, version: String) -> Result<(), String> {
    // The URL came from this module's own check, but it crossed the WebView on the way
    // back — only a file from this repo's Releases may reach the script.
    let expected = format!("https://github.com/{REPO}/releases/download/");
    if !url.starts_with(&expected) {
        return Err(format!("refusing to run an installer from outside {REPO}'s releases"));
    }

    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot locate the running app to relaunch it: {e}"))?;
    let current = app.package_info().version.to_string();
    let ko = crate::locale_of(&app) != "en";
    let script = update_script(
        &url,
        &version,
        &current,
        &exe.display().to_string(),
        std::process::id(),
        ko,
    );

    // UTF-8 **with BOM**: without it, Windows PowerShell 5.1 reads the file in the
    // system's ANSI code page and every Korean line in the console turns to mojibake.
    let path = std::env::temp_dir().join("agentmonitoring-update.ps1");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(script.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| format!("could not write the update script: {e}"))?;

    spawn_update_console(&path)?;

    // Exit after the answer has had time to reach the window. The script waits on this
    // pid, so the half-second is UX, not correctness.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        // Windows keeps a ghost tray icon until the next hover unless it is taken down first.
        let _ = app.remove_tray_by_id(crate::TRAY_ID);
        app.exit(0);
    });
    Ok(())
}

#[cfg(windows)]
fn spawn_update_console(script: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // Its own console window — the visible part of the whole feature. Without this flag a
    // console app spawned from a GUI process gets no window at all.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| format!("could not start PowerShell to run the update: {e}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn spawn_update_console(_script: &std::path::Path) -> Result<(), String> {
    Err("the update script is Windows-only; download the new version from the releases page".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers_not_words() {
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("v1.0.1", "1.0.0"), "a leading v on the tag changes nothing");
        assert!(is_newer("1.10.0", "1.9.9"), "1.10 is newer than 1.9");
        assert!(is_newer("2.0", "1.9.9"), "fewer parts still compare");
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("0.9.9", "1.0.0"));
        assert!(!is_newer("1.0.0-rc", "1.0.0"), "a suffixed tag never outranks its release");
    }

    #[test]
    fn the_installer_is_the_setup_exe_asset() {
        let release: ReleaseJson = serde_json::from_str(
            r#"{
                "tag_name": "v1.0.1",
                "html_url": "https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.0.1",
                "body": "notes",
                "assets": [
                    {"name": "agentmon.exe", "size": 1, "browser_download_url": "https://x/cli"},
                    {"name": "AgentMonitoring_1.0.1_x64-setup.exe", "size": 2, "browser_download_url": "https://x/setup"}
                ]
            }"#,
        )
        .unwrap();
        let asset = pick_installer(&release.assets).expect("the setup asset is found");
        assert_eq!(asset.browser_download_url, "https://x/setup");
        // A release without a Windows installer yields None — the card then links the page.
        assert!(pick_installer(&release.assets[..1]).is_none());
    }

    #[test]
    fn the_script_quotes_what_it_interpolates_and_waits_on_the_pid() {
        let s = update_script(
            "https://github.com/UnrealFactory/AgentMonitoring/releases/download/v1.0.1/It's_x64-setup.exe",
            "1.0.1",
            "1.0.0",
            r"C:\Apps\Agent's\AgentMonitoring.exe",
            4242,
            true,
        );
        assert!(s.contains("It''s_x64-setup.exe"), "quotes in the URL are doubled");
        assert!(s.contains(r"C:\Apps\Agent''s\AgentMonitoring.exe"));
        assert!(s.contains("Wait-Process -Id 4242"));
        assert!(s.contains("-ArgumentList '/S'"), "the installer runs silently");
        assert!(s.contains("내려받는"), "ko: the console speaks the app's language");
        assert!(update_script("u", "1", "0", "e", 1, false).contains("Downloading"));
    }
}
