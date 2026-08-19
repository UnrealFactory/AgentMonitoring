# Drive and photograph the real desktop window (WebView2), for the checks a headless
# browser cannot make: whether the *webview's own* context menu appears.
#
#   powershell -File scripts/win-window.ps1 -Action shot  -Out C:\tmp\a.png
#   powershell -File scripts/win-window.ps1 -Action click -X 120 -Y 300 -Button right
#
# X/Y are client-area coordinates of the app window; the script adds the window origin.
#   powershell -File scripts/win-window.ps1 -Action menukey
#
# `menukey` presses VK_APPS — the Menu key beside the right Ctrl — which SendKeys has no
# token for and which is the one key WebView2 answers with a synthesized contextmenu event
# of its own. That echo used to close the menu the same keypress had just opened.
param(
  [ValidateSet("shot", "click", "key", "menukey")] [string]$Action = "shot",
  [string]$Out = "",
  [int]$X = 0,
  [int]$Y = 0,
  [ValidateSet("left", "right")] [string]$Button = "left",
  [string]$Key = "",
  [string]$ProcessName = "agentmonitoring"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, int extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Error "no $ProcessName window"; exit 1 }
$h = $proc.MainWindowHandle
[void][Win]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 400

$rect = New-Object Win+RECT
[void][Win]::GetWindowRect($h, [ref]$rect)
$origin = New-Object Win+POINT
[void][Win]::ClientToScreen($h, [ref]$origin)
$client = New-Object Win+RECT
[void][Win]::GetClientRect($h, [ref]$client)

if ($Action -eq "click") {
  [void][Win]::SetCursorPos($origin.X + $X, $origin.Y + $Y)
  Start-Sleep -Milliseconds 150
  if ($Button -eq "right") {
    [Win]::mouse_event(0x0008, 0, 0, 0, 0)  # RIGHTDOWN
    Start-Sleep -Milliseconds 60
    [Win]::mouse_event(0x0010, 0, 0, 0, 0)  # RIGHTUP
  } else {
    [Win]::mouse_event(0x0002, 0, 0, 0, 0)  # LEFTDOWN
    Start-Sleep -Milliseconds 60
    [Win]::mouse_event(0x0004, 0, 0, 0, 0)  # LEFTUP
  }
  Write-Output "clicked $Button at client $X,$Y (screen $($origin.X + $X),$($origin.Y + $Y))"
  exit 0
}

if ($Action -eq "key") {
  [System.Windows.Forms.SendKeys]::SendWait($Key)
  Write-Output "sent $Key"
  exit 0
}

if ($Action -eq "menukey") {
  # VK_APPS = 0x5D, KEYEVENTF_KEYUP = 0x0002.
  [Win]::keybd_event(0x5D, 0, 0, 0)
  Start-Sleep -Milliseconds 60
  [Win]::keybd_event(0x5D, 0, 0x0002, 0)
  Write-Output "sent VK_APPS (the Menu key)"
  exit 0
}

$w = $client.Right - $client.Left
$hh = $client.Bottom - $client.Top
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
# CopyFromScreen, not PrintWindow: a menu drawn by the webview is a separate popup window
# and only a screen grab of that rectangle contains it.
$g.CopyFromScreen($origin.X, $origin.Y, 0, 0, (New-Object System.Drawing.Size($w, $hh)))
$g.Dispose()
if (-not $Out) { $Out = Join-Path $env:TEMP "agentmon-window.png" }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "$Out ($w x $hh) client origin $($origin.X),$($origin.Y)"
