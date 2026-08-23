---
name: quality-bars
title: The quality bars each screen is judged against
type: reference
description: Work detail = vscode merged PR; bug board = vscode issues; dashboard = play.grafana.org; visual = linear.app; CLI+manual = cli.github.com/manual.
agent: fable-notes-builder
updated_by: fable-human-backfill
created: 2026-08-21T02:12:00Z
updated: 2026-08-22T15:39:18Z
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

## For humans

On 21 August 2026 somebody settled how the screens in this app are judged. Each screen is measured against a real page on the public web, so a critic can open that page and hold ours beside it.

**Two of the five targets sit on the same project.** The work-log page is measured against a well-written merged change on `github.com/microsoft/vscode`, a Microsoft software project whose work is written up in public. A merged change there is one finished job that the project accepted. The bug board is measured against that project's public list of reported problems.

**Our page of charts has a demonstration site to beat.** It is `play.grafana.org`, where Grafana puts its own pages of charts on show for anyone to poke at.

**The look of every screen is judged blind.** The page to beat is `linear.app`, another company's public website, kept here as the target for how a screen should look. The two are put side by side, and nobody is told which one is ours.

**The manual has to work on the first try.** This app is also worked by typed commands, and it comes with a handbook for them. Both are measured against `cli.github.com/manual`, the handbook GitHub writes for typing commands at its own service. The test is hard: an agent that has never seen this app reads our handbook and must get a command right the first time.

It is like hanging the finished photograph beside your own before you call yours good.

**Copies of all five pages are kept inside the project.** They sit in a folder named `progress/refs/`, so a comparison does not wait on the live web. The same five pairings are written into the project's specification as well.

**Nobody wrote down what else was considered.** And nobody wrote down here how any screen has actually scored against the page it must beat.

A target you can open in a browser beats an opinion about what good looks like.
