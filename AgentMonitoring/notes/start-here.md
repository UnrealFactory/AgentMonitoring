---
name: start-here
title: Start here — what every session reads before working
type: essential
description: "The index: read the release handoff first, then the gotchas that bite scripts; curate notes as you finish."
agent: fable-updater-splash
updated_by: null
created: 2026-08-21T13:21:48Z
updated: 2026-08-21T13:21:48Z
tags: []
refs: [handoff-v1-release, registry-sandbox-in-gates, python-is-a-store-stub, notes-are-knowledge-not-history, verify-desktop-via-cdp, chart-note-series-colour, quality-bars]
---

The MEMORY.md of this project. Read top to bottom, open what applies, and keep this
index true when the set of notes changes.

**Read first**
- handoff-v1-release — where the released app stands and how to ship the next version.

**Before writing any script or test**
- registry-sandbox-in-gates — anything that runs `agentmon init` must sandbox the registry.
- python-is-a-store-stub — no python on this machine; write Node .cjs/.mjs temp scripts.

**When the task touches it**
- verify-desktop-via-cdp — driving the real desktop window with Playwright.
- chart-note-series-colour — the one chart-palette constraint that is easy to break.
- quality-bars — the visual/product quality references this app is held to.

**How notes work here**
- notes-are-knowledge-not-history — why notes rewrite in place and may be removed.
- Curate on your way out: rewrite what your work made stale, remove what now misleads,
  and keep THIS note pointing at whatever the next session must read.
