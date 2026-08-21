---
name: quality-bars
title: The quality bars each screen is judged against
type: reference
description: Work detail = vscode merged PR; bug board = vscode issues; dashboard = play.grafana.org; visual = linear.app; CLI+manual = cli.github.com/manual.
agent: fable-notes-builder
created: 2026-08-21T02:12:00Z
updated: 2026-08-21T02:12:00Z
tags: [process, bars]
refs: []
---

The bars are public pages, so a critic can put a screen beside its bar:

- Work log detail — a well-written merged PR on github.com/microsoft/vscode
- Bug board — github.com/microsoft/vscode/issues
- Dashboard — play.grafana.org
- Visual design, every screen — linear.app (blind side-by-side)
- CLI + manual — cli.github.com/manual (a fresh agent must one-shot from the manual)

Reference screenshots for comparisons live in `progress/refs/` (captured by
`scripts/capture-refs.mjs`); the table itself is in SPEC.md.
