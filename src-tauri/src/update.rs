//! In-app updates, the plain way.
//!
//! The app asks GitHub for the newest published version; when there is one, the
//! sidebar shows a card, and the button hands the rest to two **hidden** PowerShell
//! processes: a worker that downloads the installer, waits for this process to exit, runs
//! the installer silently (`/S` — the NSIS bundle installs per-user, so no UAC) and
//! relaunches the app; and a WPF **splash window** ("updating to the new version…", an
//! indeterminate bar) that fills the seconds where no app is on screen. The splash closes
//! itself when it sees the freshly installed app start; if the worker fails, it kills the
//! splash and puts the error in a message box instead. No raw console is ever shown.
//!
//! The check itself never touches the Releases **API** (BUG-0029): the unauthenticated
//! API shares 60 requests an hour across a whole address, a busy network spends them,
//! and a starved check used to hide the card with no hint. The newest tag comes from the
//! un-metered `/releases/latest` redirect instead, and the installer from an equally
//! un-metered HEAD; only the release notes still ride the API, best-effort — a spent
//! quota now costs a blank tooltip, never the card.
//!
//! Why not tauri-plugin-updater: it wants a signing keypair and a hosted manifest, and
//! everything this app needs — one exe, one repo, one OS — is two cheap requests
//! and one script. The check runs from Rust, not the WebView, so the CSP keeps its
//! "no network from the window" shape.

use serde::Deserialize;
use tauri::AppHandle;

/// Where releases live. The repo is public.
const REPO: &str = "UnrealFactory/AgentMonitoring";

/// One identity and one patience for every request this module makes.
const USER_AGENT: &str = "AgentMonitoring-updater";
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

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
    /// card then stays folded (components/AppUpdate.tsx has nothing it can run).
    pub installer_url: Option<String>,
    pub installer_size: Option<u64>,
    pub page_url: String,
}

// The one field of the Releases API answer this module still reads — the notes for the
// card's tooltip. Everything else in that payload is somebody else's contract.
#[derive(Deserialize)]
struct ReleaseJson {
    #[serde(default)]
    body: Option<String>,
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

/// The tag a `/releases/latest` redirect points at: `…/releases/tag/v1.2.0` → `v1.2.0`.
/// A repo with no releases redirects to the `/releases` list instead — that is `None`.
fn tag_from_location(location: &str) -> Option<String> {
    let (_, tail) = location.split_once("/releases/tag/")?;
    let tag = tail.split(['?', '#']).next().unwrap_or(tail).trim_end_matches('/');
    (!tag.is_empty()).then(|| tag.to_string())
}

/// The newest published tag, through the door GitHub does not meter: for any caller,
/// `github.com/<repo>/releases/latest` answers 302 with the tag page in `Location`.
/// The API's shared 60-an-hour quota never touches this, so the card cannot be starved
/// by a busy network's other checks (BUG-0029).
fn latest_tag() -> Result<String, String> {
    let url = format!("https://github.com/{REPO}/releases/latest");
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let resp = agent
        .head(&url)
        .set("User-Agent", USER_AGENT)
        .timeout(TIMEOUT)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => {
                format!("github.com/{REPO} has no releases page")
            }
            other => format!("could not reach github.com to check for updates: {other}"),
        })?;
    tag_from_location(resp.header("location").unwrap_or_default())
        .ok_or_else(|| format!("no release has been published at github.com/{REPO} yet"))
}

/// The installer at the name the release script always gives it
/// (`AgentMonitoring_<version>_x64-setup.exe`, scripts/release.mjs — a test below pins
/// the two to each other). One un-metered HEAD proves it exists and carries its size;
/// a release published without it yields `None`, same as before.
fn find_installer(tag: &str, version: &str) -> Option<(String, Option<u64>)> {
    let url = format!(
        "https://github.com/{REPO}/releases/download/{tag}/AgentMonitoring_{version}_x64-setup.exe"
    );
    let resp = ureq::head(&url)
        .set("User-Agent", USER_AGENT)
        .timeout(TIMEOUT)
        .call()
        .ok()?;
    let size = resp.header("content-length").and_then(|v| v.parse().ok());
    Some((url, size))
}

/// The release notes, for the card's tooltip — the one thing still read from the
/// rate-limited API, and so the one thing allowed to go missing: a spent quota costs
/// an empty tooltip, never the card.
fn release_notes(tag: &str) -> String {
    let url = format!("https://api.github.com/repos/{REPO}/releases/tags/{tag}");
    ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .timeout(TIMEOUT)
        .call()
        .ok()
        .and_then(|r| r.into_json::<ReleaseJson>().ok())
        .and_then(|r| r.body)
        .unwrap_or_default()
}

fn fetch_latest(current: &str) -> Result<UpdateInfo, String> {
    let tag = latest_tag()?;
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    let page_url = format!("https://github.com/{REPO}/releases/tag/{tag}");
    if !is_newer(&tag, current) {
        // The everyday answer, reached without spending anything metered.
        return Ok(UpdateInfo {
            has_update: false,
            current: current.to_string(),
            latest,
            notes: String::new(),
            installer_url: None,
            installer_size: None,
            page_url,
        });
    }
    let installer = find_installer(&tag, &latest);
    Ok(UpdateInfo {
        has_update: true,
        current: current.to_string(),
        latest,
        notes: release_notes(&tag),
        installer_url: installer.as_ref().map(|(url, _)| url.clone()),
        installer_size: installer.and_then(|(_, size)| size),
        page_url,
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

/// The worker: download, wait for this pid to exit, install silently, relaunch. It runs
/// with no window at all — progress lives in the splash; the trail goes to
/// `%TEMP%\agentmonitoring-update.log`. On failure it takes the splash down first
/// (`splash_pid`; 0 means the splash never started) and raises a message box, because a
/// hidden process that fails silently would read as "the update ate my app".
fn update_script(
    url: &str,
    version: &str,
    current: &str,
    exe: &str,
    pid: u32,
    splash_pid: u32,
    ko: bool,
) -> String {
    let (failed, retry) = if ko {
        (
            "업데이트에 실패했습니다.",
            "앱을 다시 실행한 뒤, 업데이트를 다시 시도해 주세요.",
        )
    } else {
        (
            "The update failed.",
            "Start the app again and retry the update.",
        )
    };
    let q_url = ps_quote(url);
    let q_exe = ps_quote(exe);
    let setup_name = ps_quote(&format!("AgentMonitoring_{version}_setup.exe"));
    format!(
        r#"$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'agentmonitoring-update.log'
Set-Content -Path $log -Value ('update v{current} -> v{version}') -Encoding UTF8
function Step($m) {{ Add-Content -Path $log -Value $m -Encoding UTF8 }}
try {{
  $setup = Join-Path $env:TEMP {setup_name}
  Step 'downloading the installer'
  Invoke-WebRequest -Uri {q_url} -OutFile $setup -UseBasicParsing
  Step 'waiting for the app to close'
  Wait-Process -Id {pid} -Timeout 60 -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Step 'installing'
  $p = Start-Process -FilePath $setup -ArgumentList '/S','/UPDATE' -PassThru -Wait
  if ($p.ExitCode -ne 0) {{ throw ('installer exited with code ' + $p.ExitCode) }}
  Remove-Item $setup -ErrorAction SilentlyContinue
  Step 'done, relaunching'
  Start-Process -FilePath {q_exe}
  Start-Sleep -Seconds 2
}} catch {{
  Step ('failed: ' + $_)
  Stop-Process -Id {splash_pid} -Force -ErrorAction SilentlyContinue
  Add-Type -AssemblyName PresentationFramework
  $msg = '{failed}' + [Environment]::NewLine + [Environment]::NewLine + $_ + [Environment]::NewLine + [Environment]::NewLine + '{retry}'
  [void][System.Windows.MessageBox]::Show($msg, 'AgentMonitoring', 'OK', 'Error')
}}
"#
    )
}

/// The splash: a small WPF card — app glyph, "updating to the new version…", an
/// indeterminate bar — run by its own hidden PowerShell so it survives this process
/// exiting and the installer replacing the exe. It closes itself when it sees a fresh
/// `proc_name` process start (the relaunch), and gives up after 180 s so a crashed worker
/// cannot leave it on screen forever. The window styling mirrors the app's tokens
/// (surface `#16171A`, accent `#5E6AD2`).
fn splash_script(version: &str, proc_name: &str, ko: bool) -> String {
    // The version reaches XAML text; keep it to characters that cannot close an attribute.
    let ver: String = version
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
        .collect();
    let (title, sub) = if ko {
        (
            "새 버전으로 업데이트하는 중".to_string(),
            format!("v{ver} 설치가 끝나면 자동으로 다시 열려요"),
        )
    } else {
        (
            "Updating to the new version".to_string(),
            format!("Reopens automatically once v{ver} is installed"),
        )
    };
    let q_proc = ps_quote(proc_name);
    format!(
        r##"Add-Type -AssemblyName PresentationFramework
$script:t0 = Get-Date
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        SizeToContent="Height" Width="392" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" WindowStartupLocation="CenterScreen" Topmost="True"
        ShowInTaskbar="False" ResizeMode="NoResize">
  <Border Background="#F216171A" CornerRadius="14" BorderBrush="#26FFFFFF" BorderThickness="1" Padding="22,20,22,22" Margin="14">
    <Border.Effect>
      <DropShadowEffect BlurRadius="26" ShadowDepth="6" Opacity="0.45" Color="#000000"/>
    </Border.Effect>
    <StackPanel>
      <StackPanel Orientation="Horizontal" Margin="0,0,0,15">
        <Border Width="31" Height="31" CornerRadius="9" Background="#5E6AD2">
          <Viewbox Width="16" Height="16">
            <Canvas Width="16" Height="16">
              <Path Stroke="#FFFFFF" StrokeThickness="1.5" StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round"
                    Data="M8 2.5 V10 M4.8 7 L8 10.2 L11.2 7 M3 12.5 H13"/>
            </Canvas>
          </Viewbox>
        </Border>
        <StackPanel Margin="12,0,0,0" VerticalAlignment="Center">
          <TextBlock Text="{title}" Foreground="#E8E9EB" FontSize="14" FontWeight="SemiBold" FontFamily="Segoe UI"/>
          <TextBlock Text="{sub}" Foreground="#8A8F98" FontSize="11.5" Margin="0,3,0,0" FontFamily="Segoe UI"/>
        </StackPanel>
      </StackPanel>
      <ProgressBar IsIndeterminate="True" Height="4" Foreground="#5E6AD2" Background="#2A2B31" BorderThickness="0"/>
    </StackPanel>
  </Border>
</Window>
'@
$script:w = [Windows.Markup.XamlReader]::Parse($xaml)
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({{
  $done = $false
  foreach ($p in @(Get-Process -Name {q_proc} -ErrorAction SilentlyContinue)) {{
    try {{ if ($p.StartTime -gt $script:t0) {{ $done = $true }} }} catch {{}}
  }}
  if ($done -or ((Get-Date) - $script:t0).TotalSeconds -gt 180) {{ $script:w.Close() }}
}})
$timer.Start()
$null = $script:w.ShowDialog()
"##
    )
}

/// UTF-8 **with BOM**: without it, Windows PowerShell 5.1 reads the file in the system's
/// ANSI code page and every Korean string turns to mojibake.
fn write_ps1(path: &std::path::Path, script: &str) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(script.as_bytes());
    std::fs::write(path, bytes).map_err(|e| format!("could not write the update script: {e}"))
}

/// Download-and-install behind a splash. Spawns the splash window first (so it is already
/// fading in when this window disappears), then the hidden worker, then exits this app a
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

    // The process name the splash watches for the relaunch — the exe's own stem, so dev
    // builds and renamed installs watch the right name without a hardcode.
    let proc_name = exe
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "AgentMonitoring".into());

    // The splash is decoration: if it cannot start, the update still runs — the worker
    // then gets pid 0, and its on-error `Stop-Process` quietly finds nobody.
    let splash_path = std::env::temp_dir().join("agentmonitoring-update-splash.ps1");
    let splash_pid = write_ps1(&splash_path, &splash_script(&version, &proc_name, ko))
        .and_then(|()| spawn_hidden_powershell(&splash_path))
        .map(|child| child.id())
        .unwrap_or(0);

    let script = update_script(
        &url,
        &version,
        &current,
        &exe.display().to_string(),
        std::process::id(),
        splash_pid,
        ko,
    );
    let path = std::env::temp_dir().join("agentmonitoring-update.ps1");
    write_ps1(&path, &script)?;
    spawn_hidden_powershell(&path)?;

    // Exit once the splash has had time to render (WPF takes a beat to come up), so the
    // screen is never empty. The worker waits on this pid, so the delay is UX, not
    // correctness.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        // Windows keeps a ghost tray icon until the next hover unless it is taken down first.
        let _ = app.remove_tray_by_id(crate::TRAY_ID);
        app.exit(0);
    });
    Ok(())
}

#[cfg(windows)]
fn spawn_hidden_powershell(script: &std::path::Path) -> Result<std::process::Child, String> {
    use std::os::windows::process::CommandExt;
    // A console handle with no window at all — the visible parts of the update are the
    // WPF splash and, on failure, a message box; a flashing black console is neither.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(script)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("could not start PowerShell to run the update: {e}"))
}

#[cfg(not(windows))]
fn spawn_hidden_powershell(_script: &std::path::Path) -> Result<std::process::Child, String> {
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
    fn the_latest_tag_is_read_out_of_the_redirect() {
        assert_eq!(
            tag_from_location("https://github.com/UnrealFactory/AgentMonitoring/releases/tag/v1.1.0"),
            Some("v1.1.0".to_string())
        );
        assert_eq!(
            tag_from_location("https://github.com/x/y/releases/tag/v2.0/?something#frag"),
            Some("v2.0".to_string()),
            "a query or fragment on the location changes nothing"
        );
        // A repo with no releases redirects to the list page, which names no tag.
        assert_eq!(tag_from_location("https://github.com/x/y/releases"), None);
        assert_eq!(tag_from_location("https://github.com/x/y/releases/tag/"), None);
    }

    #[test]
    fn the_conventional_installer_url_passes_the_install_guard() {
        // find_installer builds the URL from the name scripts/release.mjs uploads; the
        // guard in install_app_update only runs files under this repo's releases. The
        // two must agree or the button downloads a name that is not there.
        let url = format!(
            "https://github.com/{REPO}/releases/download/v1.1.0/AgentMonitoring_1.1.0_x64-setup.exe"
        );
        assert!(url.starts_with(&format!("https://github.com/{REPO}/releases/download/")));
        assert!(url.ends_with("-setup.exe"));
    }

    #[test]
    fn the_script_quotes_what_it_interpolates_and_waits_on_the_pid() {
        let s = update_script(
            "https://github.com/UnrealFactory/AgentMonitoring/releases/download/v1.0.1/It's_x64-setup.exe",
            "1.0.1",
            "1.0.0",
            r"C:\Apps\Agent's\AgentMonitoring.exe",
            4242,
            7777,
            true,
        );
        assert!(s.contains("It''s_x64-setup.exe"), "quotes in the URL are doubled");
        assert!(s.contains(r"C:\Apps\Agent''s\AgentMonitoring.exe"));
        assert!(s.contains("Wait-Process -Id 4242"));
        assert!(s.contains("-ArgumentList '/S','/UPDATE'"), "the installer runs silently, in update mode — /UPDATE is what stops the NSIS template re-creating the desktop shortcut on every update");
        // Without this flag, Windows PowerShell 5.1 routes Invoke-WebRequest through the
        // Internet Explorer DOM — absent on current Windows — and the download dies with
        // WebCmdletIEDomNotSupportedException before a byte arrives (seen live).
        assert!(s.contains("-UseBasicParsing"));
        // On failure the worker takes the splash down before speaking, and speaks through
        // a message box — a hidden console has no other voice.
        assert!(s.contains("Stop-Process -Id 7777"));
        assert!(s.contains("MessageBox"));
        assert!(s.contains("실패했습니다"), "ko: the error speaks the app's language");
        assert!(update_script("u", "1", "0", "e", 1, 0, false).contains("The update failed."));
    }

    #[test]
    fn the_splash_watches_the_relaunch_and_gives_up_eventually() {
        let s = splash_script("1.0.2", "AgentMonitoring", true);
        assert!(s.contains("Get-Process -Name 'AgentMonitoring'"), "watches for the fresh process");
        assert!(s.contains("$p.StartTime -gt $script:t0"), "only a *new* process counts");
        assert!(s.contains("TotalSeconds -gt 180"), "a crashed worker cannot pin it forever");
        assert!(s.contains("v1.0.2 설치가 끝나면"), "ko text carries the version");
        // Whatever a tag brings, nothing may close the XAML attribute around the version.
        let odd = splash_script("1.0.2\"/><evil", "AgentMonitoring", false);
        assert!(odd.contains("v1.0.2evil is installed"));
        assert!(!odd.contains("\"/><evil"));
        assert!(splash_script("1", "A", false).contains("Updating to the new version"));
    }
}
