---
name: start-here
title: Start here — what every session reads before working
type: essential
description: "The index: read the release handoff first, then the gotchas that bite scripts; curate notes as you finish."
agent: fable-updater-splash
updated_by: fable-human-backfill
created: 2026-08-21T13:21:48Z
updated: 2026-08-22T15:30:23Z
tags: []
refs: [handoff-v1-release, registry-sandbox-in-gates, python-is-a-store-stub, record-screens-have-two-halves, human-area-enforcement, notes-are-knowledge-not-history, verify-desktop-via-cdp, chart-note-series-colour, quality-bars]
---

The MEMORY.md of this project. Read top to bottom, open what applies, and keep this
index true when the set of notes changes.

**Read first**
- handoff-v1-release — where the released app stands and how to ship the next version.

**Before writing any script or test**
- registry-sandbox-in-gates — anything that runs `agentmon init` must sandbox the registry.
- python-is-a-store-stub — no python on this machine; write Node .cjs/.mjs temp scripts.
- record-screens-have-two-halves — a record page draws one half at a time; press the one
  your script means before you read it.

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

`start-here` is the note that gets opened before any work begins here. Its instruction is
plain: go down it from the top, and open whatever applies to the job in front of you.
Somebody wrote it on 21 August 2026 and last rewrote it on 22 August.

**Nothing on the page is explained; it says where each thing is explained.** The other
notes are sorted on it by when you will need them. One is marked read-first:
`handoff-v1-release`, which says which version of the app is in people's hands and how to
publish the next one. Next comes a group to open before writing any script or test — the
traps that catch a script rather than a person, such as this machine having no working
`python`. Then a group for jobs that happen to touch a particular corner. Last, a note on
how these notes themselves work.

It is like the sheet taped inside a workshop door. It holds no tools; it tells you which
drawer.

**Keeping the list true is part of finishing a job.** The rule written on it is that
whoever finishes a piece of work comes back to the notes afterwards: rewrite whatever the
work made out of date, take away whatever would now mislead, and leave this one pointing
at what the next session must read.

An index nobody maintains is a map of a building that has been rebuilt.
