---
name: verify-desktop-via-cdp
title: Drive the real desktop window with Playwright over CDP
type: memory
description: Set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 on the exe itself (not npm run tauri:dev), then connectOverCDP; ask the Tauri IPC for visibility, not document.visibilityState.
agent: fable-updater-splash
updated_by: d11-critic
created: 2026-08-21T13:06:59Z
updated: 2026-08-24T08:49:16Z
tags: []
refs: []
---

To verify behaviour in the real desktop app (not the browser dev server), launch the exe with the environment variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then attach Playwright with `connectOverCDP('http://localhost:9223')` — it drives the actual WebView2 window.

Set the variable on the exe itself, not on `npm run tauri:dev`. The route proven from a non-interactive shell is two commands: `npm run dev` for the dev server on 5173, then `target/debug/agentmonitoring.exe` (any earlier `tauri dev` leaves one built) with the variable set. Through `npm run tauri:dev` port 9223 stayed closed, and when the npm parent exited it took vite with it and left an orphan window. The driving script must live inside the repo, or `import "playwright"` does not resolve.

Timing a boot race in this window needs the webview cache off — `Network.setCacheDisabled` on a session from `context.newCDPSession(page)` — with the press placed by the clock after `page.reload({ waitUntil: "commit" })`. Warm, the modules are already in memory and `loadDesktopLocale()`'s read of settings.json finishes inside ~100ms, so every press lands after the race and the run passes without testing anything; cold, which is what a just-started app has, the same read lands at 0.9-1.1s and BUG-0026 reproduces at presses of 100/300/600ms. Run the same script against the defect (revert the guard in a scratch copy) before believing a green one. Attaching to a *fresh process* catches its first second only if the driver is already polling `connectOverCDP` when the exe starts: started afterwards it attached at a document age of 4s, with the boot long over.

Caveat proven live: when the HWND hides (close-to-tray), `document.visibilityState` stays "visible". Ask the app itself instead: `__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`.

## For humans

Some things have to be checked in the desktop app itself — the program people install — and
not in the browser preview used while building it. Somebody wrote down on 21 August 2026 how
to drive that real window from a script.

**Start the program with one extra setting and it will accept a driver.** Launch it with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` set, and it opens a
numbered channel on the machine, 9223, that another program can speak through. Playwright —
the tool that clicks and types through an app the way a person would, so a check can say
whether it behaved — attaches to that channel and drives the actual desktop window.

It is like leaving a side door unlocked so an inspector can walk in and press the buttons
themselves.

**The setting goes on the program, not on the command that usually starts it.**
`npm run tauri:dev` is the everyday way to start the app while working on it: it starts the
preview server and the program together. Set the extra setting on that and the channel never
opened, and when the starting command finished it took the preview server down with it,
leaving a window with nothing behind it. Two steps work instead: start the preview server with
`npm run dev`, then start the program's own file, `target/debug/agentmonitoring.exe`, with the
setting on it. An earlier `npm run tauri:dev` leaves that file ready.

**A driving script has to sit inside the project folder.** It asks for Playwright by name, and
that name is only found from inside.

**A window that has opened once starts too fast to test.** To check the first half-second of a
window opening, tell the driver to fetch every file fresh; otherwise start-up finishes in a tenth
of a second and the press lands after the moment you meant to test. Run the same script against
the fault you say you fixed: green there means it measures nothing.

**One answer from inside that window is not to be trusted.** Close the app to the tray — the
little icons beside the clock — and the window leaves the screen. Yet
`document.visibilityState`, the page's own report of whether it is being shown, still says
"visible". A check that trusts it would call the window visible when nobody can see it.

**Ask the program that owns the window instead of the page drawn inside it.** The call
`__TAURI_INTERNALS__.invoke('plugin:window|is_visible')` puts the question to the app, and
that answer matches what is on the screen. Somebody watched the mismatch happen in the running
app, so it is written down here as proven rather than suspected.

When you want to know whether a window is on screen, ask whoever owns the window.
