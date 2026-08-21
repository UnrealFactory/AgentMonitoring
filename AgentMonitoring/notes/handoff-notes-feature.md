---
name: handoff-notes-feature
title: "Handoff after WORK-0036: what the next session should know"
type: handoff
description: Notes shipped (WORK-0036) and now show their last rewriter (WORK-0037); tree still uncommitted, critic round still open.
agent: fable-notes-builder
updated_by: fable-notes-builder
created: 2026-08-21T03:17:57Z
updated: 2026-08-21T04:18:49Z
tags: [handoff, notes]
refs: [WORK-0036]
---

## State

WORK-0036 (notes end to end) and WORK-0037 (`updated_by` — the agent beside a note's
words is its last rewriter) are both closed, every gate green. The desktop window has
been opened and eyeballed this session via `npm run tauri:dev`. The working tree still
holds TWO uncommitted features — the v2 rearchitecture (WORK-0035) and notes
(WORK-0036/0037) — because the owner has not asked for commits; they are two commits.

## Do first

If a critic round is wanted, that is the open step: no rounds.jsonl line exists for the
notes piece (builders do not self-grade — PLAN.md). Shots are fresh in progress/shots/
except notes-list/note-detail, which predate WORK-0037's byline change by a few minutes
— re-run `npm run screenshot -- --only notes-list,note-detail` if pixel-fresh shots
matter.

## Worth knowing

The Korean i18n gate caught two real defects in this feature's first cut (keep-all on
.note-foot/.note-lead, and a particle glued to a code span in nd.updateHint) — both
fixed. If you add app-owned sentences near code spans in Korean, end the clause before
the span; the ko.ts header says why. The launch preference is desktop app, not browser
(`npm run dev` only for gates/shots).
