---
name: verify-desktop-via-cdp
title: Drive the real desktop window with Playwright over CDP
type: memory
description: Launch the exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223, then connectOverCDP; ask the Tauri IPC for visibility, not document.visibilityState.
agent: fable-updater-splash
updated_by: fable-human-backfill
created: 2026-08-21T13:06:59Z
updated: 2026-08-22T15:30:28Z
tags: []
refs: []
---

To verify behaviour in the real desktop app (not the browser dev server), launch the exe with the environment variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then attach Playwright with `connectOverCDP('http://localhost:9223')` — it drives the actual WebView2 window.

Caveat proven live: when the HWND hides (close-to-tray), `document.visibilityState` stays "visible". Ask the app itself instead: `__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`.

## For humans

Some things have to be checked in the desktop app itself — the program people install —
and not in the browser preview used while building it. Somebody wrote down on 21 August
2026 how to drive that real window from a script.

**Start the program with one extra setting and it will accept a driver.** Launch it with
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` set, and it opens a
numbered channel on the machine, 9223, that another program can speak through. Playwright
— the tool that clicks and types through an app the way a person would, so a check can say
whether it behaved — attaches to that channel and drives the actual desktop window.

It is like leaving a side door unlocked so an inspector can walk in and press the buttons
themselves.

**One answer from inside that window is not to be trusted.** Close the app to the tray —
the little icons beside the clock — and the window leaves the screen. Yet
`document.visibilityState`, the page's own report of whether it is being shown, still says
"visible". A check that trusts it would call the window visible when nobody can see it.

**Ask the program that owns the window instead of the page drawn inside it.** The call
`__TAURI_INTERNALS__.invoke('plugin:window|is_visible')` puts the question to the app, and
that answer matches what is on the screen. Somebody watched the mismatch happen in the
running app, so it is written down here as proven rather than suspected.

When you want to know whether a window is on screen, ask whoever owns the window.
