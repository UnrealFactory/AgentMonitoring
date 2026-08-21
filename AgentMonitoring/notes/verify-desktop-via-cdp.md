---
name: verify-desktop-via-cdp
title: Drive the real desktop window with Playwright over CDP
type: memory
description: Launch the exe with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223, then connectOverCDP; ask the Tauri IPC for visibility, not document.visibilityState.
agent: fable-updater-splash
updated_by: null
created: 2026-08-21T13:06:59Z
updated: 2026-08-21T13:06:59Z
tags: []
refs: []
---

To verify behaviour in the real desktop app (not the browser dev server), launch the exe with the environment variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`, then attach Playwright with `connectOverCDP('http://localhost:9223')` — it drives the actual WebView2 window.

Caveat proven live: when the HWND hides (close-to-tray), `document.visibilityState` stays "visible". Ask the app itself instead: `__TAURI_INTERNALS__.invoke('plugin:window|is_visible')`.
