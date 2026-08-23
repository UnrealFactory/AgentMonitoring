# D6 critic's window driver.
#
# scripts/win-window.ps1 calls SetForegroundWindow and photographs the screen rectangle. On
# this machine that quietly fails: Windows' foreground lock refuses a process that is not
# already the foreground one, so a File Explorer window sitting over the app ended up in the
# grab (progress/critic-d6/4-a-long-top.png, first pass) and the real mouse wheel went to
# Explorer instead of the app. Same rectangle, wrong window, and nothing said so.
#
# So: raise the window for real (topmost + AttachThreadInput), REFUSE to act unless the app
# is genuinely the foreground window, and say which window won when it is not.
#
#   powershell -File d6crit-win.ps1 -Action raise
#   powershell -File d6crit-win.ps1 -Action shot   -Out C:\x.png
#   powershell -File d6crit-win.ps1 -Action scroll -X 700 -Y 500 -Delta -600
#   powershell -File d6crit-win.ps1 -Action drop     # give the topmost flag back
param(
  [ValidateSet("raise", "shot", "scroll", "drop")] [string]$Action = "shot",
  [string]$Out = "",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Delta = -360,
  [string]$ProcessName = "agentmonitoring"
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W6 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int t, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "no $ProcessName window"; exit 1 }
$h = $proc.MainWindowHandle

$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP = 0x0001 -bor 0x0002 -bor 0x0040   # NOSIZE | NOMOVE | SHOWWINDOW

if ($Action -eq "drop") {
  [void][W6]::SetWindowPos($h, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP)
  Write-Output "dropped topmost"
  exit 0
}

function Raise-App {
  [void][W6]::ShowWindow($h, 9)                       # SW_RESTORE
  [void][W6]::SetWindowPos($h, $HWND_TOPMOST, 0, 0, 0, 0, $SWP)
  [void][W6]::BringWindowToTop($h)
  # The foreground lock only yields to a thread whose input is attached to the current
  # foreground thread — the standard escape, and the reason the plain call fails here.
  $fg = [W6]::GetForegroundWindow()
  $fgThread = [W6]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
  $me = [W6]::GetCurrentThreadId()
  if ($fgThread -ne $me) { [void][W6]::AttachThreadInput($fgThread, $me, $true) }
  [void][W6]::SetForegroundWindow($h)
  if ($fgThread -ne $me) { [void][W6]::AttachThreadInput($fgThread, $me, $false) }
  Start-Sleep -Milliseconds 350
  return ([W6]::GetForegroundWindow() -eq $h)
}

$won = Raise-App
if (-not $won) { $won = Raise-App }
# Not fatal: HWND_TOPMOST needs no foreground rights, so the window is drawn over the one
# holding focus even when the foreground lock refuses to yield — which is what the grab and
# the wheel need. Say which window kept focus, so a grab is never silently of something else.
$fgName = ""
if (-not $won) {
  $fg = [W6]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 256
  [void][W6]::GetWindowText($fg, $sb, 256)
  $fgName = $sb.ToString()
  Write-Output "WARN: focus stayed with '$fgName'; app is topmost, so it is still the window on screen."
}

if ($Action -eq "raise") { Write-Output "app raised (foreground=$won)"; exit 0 }

$origin = New-Object W6+POINT
[void][W6]::ClientToScreen($h, [ref]$origin)
$client = New-Object W6+RECT
[void][W6]::GetClientRect($h, [ref]$client)

if ($Action -eq "scroll") {
  [void][W6]::SetCursorPos($origin.X + $X, $origin.Y + $Y)
  Start-Sleep -Milliseconds 150
  # A real wheel arrives one notch at a time; one -2400 lump is not what a hand does and is
  # not what smooth-scrolling code is written against.
  $notches = [Math]::Max(1, [Math]::Abs([int]($Delta / 120)))
  $step = if ($Delta -lt 0) { -120 } else { 120 }
  for ($i = 0; $i -lt $notches; $i++) {
    $data = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes($step), 0)
    [W6]::mouse_event(0x0800, 0, 0, $data, 0)
    Start-Sleep -Milliseconds 40
  }
  Write-Output "scrolled $notches notch(es) of $step at client $X,$Y"
  exit 0
}

$w = $client.Right - $client.Left
$hh = $client.Bottom - $client.Top
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($origin.X, $origin.Y, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
$g.Dispose()
if (-not $Out) { $Out = Join-Path $env:TEMP "d6-window.png" }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "$Out ($w x $hh) at $($origin.X),$($origin.Y)"
