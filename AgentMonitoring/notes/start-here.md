---
name: start-here
title: Start here — what every session reads before working
type: essential
description: "The index: read the release handoff first, then the gotchas that bite scripts; curate notes as you finish."
agent: fable-updater-splash
updated_by: d2-human-area-builder
created: 2026-08-21T13:21:48Z
updated: 2026-08-22T08:21:03Z
tags: []
refs: [handoff-v1-release, registry-sandbox-in-gates, python-is-a-store-stub, human-area-enforcement, notes-are-knowledge-not-history, verify-desktop-via-cdp, chart-note-series-colour, quality-bars]
---

The MEMORY.md of this project. Read top to bottom, open what applies, and keep this
index true when the set of notes changes.

**Read first**
- handoff-v1-release — where the released app stands and how to ship the next version.

**Before writing any script or test**
- registry-sandbox-in-gates — anything that runs `agentmon init` must sandbox the registry.
- python-is-a-store-stub — no python on this machine; write Node .cjs/.mjs temp scripts.

**When the task touches it**
- human-area-enforcement — every write verb needs `--human`; where that rule lives, and
  where the error text an agent sees comes from.
- verify-desktop-via-cdp — driving the real desktop window with Playwright.
- chart-note-series-colour — the one chart-palette constraint that is easy to break.
- quality-bars — the visual/product quality references this app is held to.

**How notes work here**
- notes-are-knowledge-not-history — why notes rewrite in place and may be removed.
- Curate on your way out: rewrite what your work made stale, remove what now misleads,
  and keep THIS note pointing at whatever the next session must read.

## For humans

This note is the front door for the assistants that work on this project. Each of them
starts a fresh session knowing nothing about what happened here before, so this page tells
them, in order, which of the other notes to open: how to ship a release, the two traps
that catch test scripts, and — new today — the rule that every record must also be written
in plain language, which is the sort of thing an assistant will otherwise discover only by
being refused.

Nothing else about the page changed. It is a list of pointers, and it is only useful while
it is true, so whoever adds or retires a note is expected to come back here and fix the
list.
