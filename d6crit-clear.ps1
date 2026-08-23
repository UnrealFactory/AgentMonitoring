# D6: clear the app window's rectangle so a screen grab is of the app and the real mouse
# wheel lands in it.
#
# Neither of the polite routes works on this machine: a cross-process z-order change is
# refused (SetWindowPos returns true and WS_EX_TOPMOST never appears) because this process
# does not own the foreground window, and the app cannot raise itself either — its Tauri
# capabilities do not grant core:window:allow-set-always-on-top or allow-set-focus. What is
# left is to fold the windows sitting over it out of the way, and to put every one of them
# back afterwards.
#
#   powershell -File d6crit-clear.ps1 -Action hide     # remembers what it minimised
#   powershell -File d6crit-clear.ps1 -Action restore
param([ValidateSet("hide", "restore", "list")] [string]$Action = "list")

$state = Join-Path $env:TEMP "d6crit-hidden.txt"

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class C6 {
  public delegate bool Cb(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Cb cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

if ($Action -eq "restore") {
  if (-not (Test-Path $state)) { Write-Output "nothing to restore"; exit 0 }
  foreach ($line in Get-Content $state) {
    if (-not $line.Trim()) { continue }
    $h = [IntPtr][int64]($line.Split("`t")[0])
    [void][C6]::ShowWindow($h, 9)   # SW_RESTORE
    Write-Output "restored $line"
  }
  Remove-Item $state -Force
  exit 0
}

# the app's own rectangle
$app = Get-Process -Name agentmonitoring -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $app) { Write-Error "no app window"; exit 1 }
$appH = $app.MainWindowHandle
$ar = New-Object C6+RECT
[void][C6]::GetWindowRect($appH, [ref]$ar)

$found = New-Object System.Collections.ArrayList
$seenApp = $false
$cb = [C6+Cb] {
  param($h, $p)
  if (-not [C6]::IsWindowVisible($h)) { return $true }
  if ([C6]::IsIconic($h)) { return $true }
  if ($h -eq $script:appH) { $script:seenApp = $true; return $true }
  # EnumWindows walks front to back, so anything reached before the app is *over* it.
  if ($script:seenApp) { return $false }
  $sb = New-Object System.Text.StringBuilder 300
  [void][C6]::GetWindowText($h, $sb, 300)
  $t = $sb.ToString()
  if (-not $t) { return $true }
  $r = New-Object C6+RECT
  [void][C6]::GetWindowRect($h, [ref]$r)
  $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
  if ($w -lt 200 -or $hh -lt 150) { return $true }
  # does it overlap the app?
  $overlap = -not ($r.Right -le $script:ar.Left -or $r.Left -ge $script:ar.Right -or
                   $r.Bottom -le $script:ar.Top -or $r.Top -ge $script:ar.Bottom)
  if ($overlap) { [void]$script:found.Add(@($h, $t)) }
  return $true
}
[void][C6]::EnumWindows($cb, [IntPtr]::Zero)

if ($Action -eq "list") {
  if ($found.Count -eq 0) { Write-Output "app rect is clear" }
  foreach ($f in $found) { Write-Output ("over the app: {0} {1}" -f $f[0], $f[1]) }
  exit 0
}

$lines = @()
foreach ($f in $found) {
  [void][C6]::ShowWindow([IntPtr]$f[0], 6)   # SW_MINIMIZE
  $lines += ("{0}`t{1}" -f $f[0], $f[1])
  Write-Output ("minimised {0} {1}" -f $f[0], $f[1])
}
if ($lines.Count) { $lines | Add-Content $state }
else { Write-Output "app rect was already clear" }
