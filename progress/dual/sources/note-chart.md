---
name: chart-note-series-colour
title: The note chart series (#c9629b) was validated only against its own neighbours
type: decision
description: The --series-note pink passed the palette validator only next to work/done/bug colours — never draw it beside fix-purple or grey.
agent: fable-updater-splash
updated_by: null
created: 2026-08-21T13:07:05Z
updated: 2026-08-21T13:07:05Z
tags: []
refs: []
---

The activity charts' note series colour `--series-note: #c9629b` went through the dataviz palette validator only against the neighbours it actually renders with: the work, done and bug series. It was NOT validated against fix-purple or the grey scale — do not introduce a chart that places them adjacent without re-running the validator.
