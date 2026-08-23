# D6 critic (v2): find the app's REAL window, raise it, photograph it, wheel over it.
#
# Why not Get-Process().MainWindowHandle, which d6crit-win.ps1 uses: the Tauri process owns
# more than one top-level window, and mid-run that call started answering with a 16x16 stub at
# 0,0 (checked live). A grab of it throws "Bitmap: parameter is not valid" and a wheel aimed
# through it lands on whatever is at screen 0,0 — a silent miss, which is exactly the failure
# mode this whole pass exists to avoid.
#
# So: enumerate the process's own top-level windows and take the one that is visible, titled,
# and big enough to be the app (>= 800x600 client). Refuse to do anything if there is no such
# window, and say so.
#
#   powershell -File d6crit-v2-win.ps1 -Action find
#   powershell -File d6crit-v2-win.ps1 -Action raise
#   powershell -File d6crit-v2-win.ps1 -Action shot   -Out C:\x.png
#   powershell -File d6crit-v2-win.ps1 -Action scroll -X 700 -Y 500 -Delta -1200
param(
  [ValidateSet("find", "raise", "shot", "scroll")] [string]$Action = "find",
  [string]$Out = "",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Delta = -360,
  [string]$ProcessName = "agentmonitoring"
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class V6 {
  public delegate bool Cb(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Cb cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int t, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  public static List<IntPtr> Candidates(uint wantPid) {
    var found = new List<IntPtr>();
    EnumWindows(new Cb((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != wantPid) return true;
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      RECT c; GetClientRect(h, out c);
      if (c.Right < 800 || c.Bottom < 600) return true;
      var sb = new StringBuilder(300); GetWindowText(h, sb, 300);
      if (sb.Length == 0) return true;
      found.Add(h);
      return true;
    }), IntPtr.Zero);
    return found;
  }
}
"@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Error "no $ProcessName process"; exit 1 }
$cands = [V6]::Candidates([uint32]$proc.Id)
if ($cands.Count -eq 0) { Write-Error "no visible $ProcessName window >= 800x600 (minimised? hidden to tray?)"; exit 2 }
$h = $cands[0]

$c = New-Object V6+RECT
[void][V6]::GetClientRect($h, [ref]$c)
$origin = New-Object V6+POINT
[void][V6]::ClientToScreen($h, [ref]$origin)

if ($Action -eq "find") {
  Write-Output ("hwnd={0} client={1}x{2} at {3},{4} candidates={5}" -f $h, $c.Right, $c.Bottom, $origin.X, $origin.Y, $cands.Count)
  exit 0
}

function Raise-App {
  [void][V6]::ShowWindow($h, 9)                 # SW_RESTORE
  [void][V6]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040)  # TOPMOST
  [void][V6]::BringWindowToTop($h)
  $fg = [V6]::GetForegroundWindow()
  $fgThread = [V6]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
  $me = [V6]::GetCurrentThreadId()
  if ($fgThread -ne $me) { [void][V6]::AttachThreadInput($fgThread, $me, $true) }
  [void][V6]::SetForegroundWindow($h)
  if ($fgThread -ne $me) { [void][V6]::AttachThreadInput($fgThread, $me, $false) }
  Start-Sleep -Milliseconds 300
  return ([V6]::GetForegroundWindow() -eq $h)
}

$won = Raise-App
if (-not $won) { $won = Raise-App }

if ($Action -eq "raise") { Write-Output "raised (foreground=$won hwnd=$h)"; exit 0 }

if ($Action -eq "scroll") {
  if (-not $won) { Write-Output "WARN: the app is not the foreground window; a wheel may go elsewhere" }
  [void][V6]::SetCursorPos($origin.X + $X, $origin.Y + $Y)
  Start-Sleep -Milliseconds 200
  $notches = [Math]::Max(1, [Math]::Abs([int]($Delta / 120)))
  $step = if ($Delta -lt 0) { -120 } else { 120 }
  for ($i = 0; $i -lt $notches; $i++) {
    $data = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes($step), 0)
    [V6]::mouse_event(0x0800, 0, 0, $data, 0)
    Start-Sleep -Milliseconds 45
  }
  Write-Output ("wheeled {0} notch(es) of {1} at client {2},{3} (foreground={4})" -f $notches, $step, $X, $Y, $won)
  exit 0
}

# shot
[void][V6]::GetClientRect($h, [ref]$c)
$origin = New-Object V6+POINT
[void][V6]::ClientToScreen($h, [ref]$origin)
$w = $c.Right; $hh = $c.Bottom
if ($w -le 0 -or $hh -le 0) { Write-Error "client rect is ${w}x${hh}; refusing to grab"; exit 3 }
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($origin.X, $origin.Y, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
$g.Dispose()
if (-not $Out) { $Out = Join-Path $env:TEMP "d6-v2.png" }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("{0} ({1}x{2}) at {3},{4} foreground={5}" -f $Out, $w, $hh, $origin.X, $origin.Y, $won)
