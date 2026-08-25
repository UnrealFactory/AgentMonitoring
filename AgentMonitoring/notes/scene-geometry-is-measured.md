---
name: scene-geometry-is-measured
title: A scene's geometry is measured in a browser, never eyeballed
type: reference
description: "How a record's pictures are proved: npm run check:scenes measures every label in two faces, and each scene's header comment traces its elements to the record's sentences."
agent: d9-scene-builder
updated_by: fable-doc-sync
created: 2026-08-24T03:14:54Z
updated: 2026-08-25T04:48:52Z
tags: [human-area, pictures, gates]
refs: [WORK-0078, BUG-0025, WORK-0089]
---

The human area's pictures are **per-beat scenes**, and since WORK-0089 (owner decision,
2026-08-25) the default is **a scene on every beat** (`docs/HUMAN_STYLE.md`, "Every beat
opens on its scene"): drawn inside the beat above its words, skipped only where that beat's
facts draw nothing — and the skip is a claim about the beat. `agentmon doctor` warns on a
work log or bug whose page has beats and not one figure (whole-page on purpose: the per-beat
valve is the writer's claim, not the checker's). The contract names `npm run check:scenes`
as what settles the bands and the type floor; this note is the operating detail it does not
carry — how to run it, and what else it knows.

**Nothing else in this repo can see inside a picture.** `scripts/check-clipping.mjs` reads
the *page*, and a scene's labels sit inside an `<img>`, which is a document of its own. Two
labels that clear each other by a hair are a silent defect, and so is type that falls under
the 11px floor once the page scales the drawing down. The round before per-beat scenes
shipped exactly that.

**So `npm run check:scenes` measures them** (`scripts/check-scenes.mjs`, `--dir` for another
project, `--verbose` to print each file's numbers). It opens every
`<record>-<beat>-<what>.svg` in the project's `assets/` in Chromium, takes `getBBox()` for
each `<text>`, and fails on an overlap, a label within 14 units of an edge, or type under 11
at the narrowest column a record page gives a picture. Then it runs the whole pass again
with `.s` forced to Verdana and `.m` to Lucida Console — a reader whose interface face is
wider than this machine's, which is what the contract's "leave a fifth of every label's box
empty" is asking for. It also keeps the folder honest both ways: a scene no record points at
is a leftover from a rework, and a reference to a file that is not there is a mis-citation.
References inside code fences and code spans are not citations — records that *document* the
`![alt](assets/x.svg)` syntax are right, and reading those as citations turned this gate red
on WORK-0040 before it had that rule.

**The scenes are hand-authored SVGs** under `AgentMonitoring/assets/`, and each carries its
own header comment: the grid it was drawn on and a line per element naming the sentence of
the record that element comes from. Read that comment before you change a drawing — the
honesty law is per element, and the trace is the only place the reasoning survives. Label
width is the thing the wide-face pass actually catches (WORK-0089's first draft failed it
twice): keep band labels short — a side pair at 22px survives Verdana at roughly 17
characters each, a centred label near an edge at fewer.

**The measured column.** Since WORK-0092 the pictures sit inside cards (the overview card, a node card on the rail, the outcome card — the Human view is the agent page's skeleton). Walking the app's window from 700 to 1920 with a Human view open, the node card's column is the narrowest of the three: **464 CSS px** at window ~1140, where the record's rail comes back beside a still-narrow page (the sheet-era measurement was 424 at 1104). The contract's floor stays **395** — every shipped scene was drawn to it, the gate checks against it, and a floor is only ever re-measured wider, never assumed — with `.prose-img`'s 560px max-height in the arithmetic so a tall scene is measured at the height that actually ships.

## For humans

On 24 August 2026 the drawings in these plain-language pages changed shape: one small
picture per step of a story, sitting above that step's words. Since 25 August the picture
is no longer optional: every step gets one by default, a step goes without only when there
is honestly nothing to draw — a check that ran and passed, a number that moved — and the
project checker flags any story told in steps with no picture anywhere on it. This note
says how such a drawing is checked before it ships.

**The words inside a picture are invisible to everything else here.** The check this project
runs for text that has been cut off reads the page, and a picture is a document of its own,
so nothing warns you when two names inside one land on top of each other. `npm run
check:scenes` does that job: it opens each drawing in a browser, measures the box around
every word, and refuses an overlap, a word sitting too near the edge, or lettering that
would come back too small to read. Then it does the whole thing again in a deliberately
wider lettering, standing in for the machines this one is not. The wider pass is the one
that actually catches things: the first drafts of the newest record's two drawings both
failed it — labels that cleared each other on this machine collided in the wide face — and
shorter labels fixed both.

**It also notices a drawing nobody points at.** When a story's pictures are redone, the old
ones stop being mentioned anywhere and stay on disk; that check names them, so they can be
thrown away instead of quietly rotting.

**Too small for what, exactly, was re-measured.** The drawings live inside cards now, so somebody walked the app's window from 700 to 1920 pixels again and watched the column a drawing is given. The tightest spot is a node card at a window around 1140, where the drawing gets 464 pixels — roomier than the old layout's 424. The rules still tell you to draw for 395: every existing drawing was made for that number, and a safety floor is only ever moved when a new measurement proves it can rise, never because the layout changed.

Measure the drawing; do not admire it.
