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
#
#   powershell -File scripts/win-window.ps1 -Action scroll -X 700 -Y 500 -Delta -600
#
# `scroll` turns the real wheel over the point given, which is how a row below the fold —
# the vault-wide feed at the foot of /projects, say — is reached without a keyboard shortcut
# the app may not have.
#
#   powershell -File scripts/win-window.ps1 -Action hover -X 120 -Y 300 [-Rest 900]
#
# `hover` is `click` without the click: the real cursor is put over the point and left
# there. It exists for the one thing a headless browser cannot answer — whether the
# *WebView's own* tooltip appears over a `title` — because that tooltip is an OS popup
# window, not an element, and only the screen grab below contains it. Two moves, a few
# pixels apart, because Chromium starts its tooltip timer on a mouse *move* and a cursor
# teleported into place from another window may never send one.
#
#   powershell -File scripts/win-window.ps1 -Action resize -Width 960 -Height 700
#
# `resize` sets the *client* area, so -Width 960 is the 960 a container query sees. This is
# the narrowest the app is allowed to be (tauri.conf.json minWidth), and it is where a whole
# layout lives that no gate and no screenshot ever reached: for a round the severity column
# there read 낮 — Korean for "daytime" — where the board meant lowest severity, and it was
# found by a reader dragging the window, because nothing in this repo could make it narrow
# (P9 round 3 critic).
param(
  [ValidateSet("shot", "click", "hover", "key", "menukey", "scroll", "resize")] [string]$Action = "shot",
  [string]$Out = "",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  # How long `hover` leaves the cursor there. Longer than both tooltip delays — this app's
  # 400ms and the WebView's ~500 — so a failure to suppress the native one is visible.
  [int]$Rest = 1200,
  # Wheel notches * 120; negative scrolls down.
  [int]$Delta = -360,
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
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool repaint);
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

if ($Action -eq "resize") {
  if ($Width -le 0 -and $Height -le 0) { Write-Error "resize needs -Width and/or -Height"; exit 1 }
  # MoveWindow takes the *outer* size, and a container query reads the client area, so the
  # frame (border + title bar) is measured on this window and added back. Asking for 960
  # any other way lands a few pixels short and quietly misses the threshold under test.
  $frameW = ($rect.Right - $rect.Left) - ($client.Right - $client.Left)
  $frameH = ($rect.Bottom - $rect.Top) - ($client.Bottom - $client.Top)
  $wantW = if ($Width -gt 0) { $Width + $frameW } else { $rect.Right - $rect.Left }
  $wantH = if ($Height -gt 0) { $Height + $frameH } else { $rect.Bottom - $rect.Top }
  [void][Win]::MoveWindow($h, $rect.Left, $rect.Top, $wantW, $wantH, $true)
  Start-Sleep -Milliseconds 500
  [void][Win]::GetClientRect($h, [ref]$client)
  $gotW = $client.Right - $client.Left
  $gotH = $client.Bottom - $client.Top
  Write-Output "client is now $gotW x $gotH (frame $frameW x $frameH)"
  # The window manager may refuse to go below tauri.conf.json's minWidth/minHeight — say so
  # rather than photographing a width nobody asked for.
  if ($Width -gt 0 -and $gotW -ne $Width) { Write-Output "NOTE: asked for $Width, the window stopped at $gotW" }
  exit 0
}

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

if ($Action -eq "hover") {
  # Land a little short, then move onto the point: the second move is the one Chromium's
  # (and this app's) hover timer starts from.
  [void][Win]::SetCursorPos($origin.X + $X - 12, $origin.Y + $Y - 8)
  Start-Sleep -Milliseconds 180
  [void][Win]::SetCursorPos($origin.X + $X, $origin.Y + $Y)
  Start-Sleep -Milliseconds $Rest
  Write-Output "hovering client $X,$Y (screen $($origin.X + $X),$($origin.Y + $Y)) for ${Rest}ms"
  # With -Out it falls through to the screen grab below rather than exiting, so the picture
  # is taken while the cursor is still on the point. A second invocation would work too, but
  # only if nothing in between moved the mouse or the window.
  if (-not $Out) { exit 0 }
}

if ($Action -eq "scroll") {
  [void][Win]::SetCursorPos($origin.X + $X, $origin.Y + $Y)
  Start-Sleep -Milliseconds 120
  # MOUSEEVENTF_WHEEL = 0x0800; the delta rides in the `data` argument, which is declared
  # unsigned — so a downward scroll is reinterpreted bit for bit rather than cast, which
  # PowerShell refuses to do for a negative number.
  $data = [System.BitConverter]::ToUInt32([System.BitConverter]::GetBytes($Delta), 0)
  [Win]::mouse_event(0x0800, 0, 0, $data, 0)
  Write-Output "scrolled $Delta at client $X,$Y"
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
