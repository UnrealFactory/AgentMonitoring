---
name: record-screens-have-two-halves
title: A record screen draws one half at a time — a script that reads a record body must press the half it means
type: memory
description: A gate that does not press a segment reads whichever half the screen before it left behind — the choice is a session value that follows the page.
agent: d3-human-view-builder
updated_by: null
created: 2026-08-22T14:49:47Z
updated: 2026-08-22T14:49:47Z
tags: [gates, dual-record, ui]
refs: [WORK-0069]
---

Since WORK-0069 the four record surfaces — work detail, bug detail, note detail and the
app-feedback board — draw **one** of a record's two areas at a time. A record that carries
a human area opens on it; the reader's choice is kept in `sessionStorage`
(`agentmon.recordView`, src/lib/recordView.ts) and follows the window across navigations.

Two consequences for anything automated:

- **Press the half you mean.** `await page.locator('.view-toggle [role="tab"][data-value="agent"]').click()`
  — by `data-value`, never by the segment's word, because the app ships in two languages.
  Every screen in scripts/screenshot.mjs, check-i18n.mjs, check-clipping.mjs and
  check-live.mjs that draws a record now declares its half; the one that did not (check-live's
  note page, waiting for `.note-lead`) died of a 30s timeout the moment its note gained a
  human area mid-run.
- **What is only in the agent half**: `#what`/`#why`/`#how`, `#files`, `#outcome`,
  `#updates`, `#report`, `#thread`, `#body`, the resolution card, the contents rail, the
  note's description (`.note-lead`). What is in **both**: the record head (title, id, status,
  agent, dates, tags), the 관련 항목 rail and the side facts card. The human half is
  `.human-sheet` (or `.human-empty` on a record written before human areas existed).

The default is latched per record when it loads, not recomputed on every refresh: this app
is live, and an agent adding a human area to a record somebody has open must not swap the
page under them.

## For humans

Each record page in this app can be read two ways: the technical write-up, or the same
events in plain language. The page shows one at a time and remembers which one you asked
for while your window is open.

That matters for the scripts that drive the app to take screenshots or run checks. A script
that opens a record and looks for a heading may be looking at the other half of the page,
because the half is whatever the last screen left behind. Each script now says which half it
wants before it looks, by pressing one of the two buttons.

A script that does not say which half it wants is reading whichever one it happened to get.
