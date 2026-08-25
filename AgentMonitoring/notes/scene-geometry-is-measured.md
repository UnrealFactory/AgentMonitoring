---
name: scene-geometry-is-measured
title: A scene's geometry is measured in a browser, never eyeballed
type: reference
description: "How a record's pictures are proved: the citation's spelling (blank lines, sized root), doctor's three scene warnings, and npm run check:scenes measuring every cited SVG in two faces."
agent: d9-scene-builder
updated_by: fable-scene-size
created: 2026-08-24T03:14:54Z
updated: 2026-08-25T06:16:48Z
tags: [human-area, pictures, gates]
refs: [WORK-0078, BUG-0025, WORK-0089, WORK-0093, WORK-0040]
---

The human area's pictures are **per-beat scenes**, and since WORK-0089 (owner decision,
2026-08-25) the default is **a scene on every beat** (`docs/HUMAN_STYLE.md`, "Every beat
opens on its scene"): drawn inside the beat above its words, skipped only where that beat's
facts draw nothing — and the skip is a claim about the beat. The citation has one correct
spelling (WORK-0093, owner feedback 2026-08-25): the `![…](assets/…)` line is a paragraph
of its own, a blank line above and below, and the SVG root carries `width`/`height` beside
the `viewBox` — welded to its neighbours the picture is folded into the paragraph and drawn
at text height, and a viewBox-only root gives an `<img>` no size. `agentmon doctor` warns
on all three scene shapes: a page of beats with not one figure (whole-page on purpose: the
per-beat valve is the writer's claim, not the checker's), a citation welded into a
paragraph (any record kind), and a cited SVG whose root lacks width/height. The contract
names `npm run check:scenes` as what settles the bands and the type floor; this note is
the operating detail it does not carry — how to run it, and what else it knows.

**Nothing else in this repo can see inside a picture.** `scripts/check-clipping.mjs` reads
the *page*, and a scene's labels sit inside an `<img>`, which is a document of its own. Two
labels that clear each other by a hair are a silent defect, and so is type that falls under
the 11px floor once the page scales the drawing down. The round before per-beat scenes
shipped exactly that.

**So `npm run check:scenes` measures them** (`scripts/check-scenes.mjs`, `--dir` for another
project, `--verbose` to print each file's numbers). It opens **every SVG any record cites,
plus every `<record>-<beat>-<what>.svg`**, in Chromium — the name pattern alone skipped the
drawings notes cite, and its first widened run caught WORK-0040's pre-scene-era pipeline
diagram (11–13 type on a 660 grid), redrawn since — takes `getBBox()` for each `<text>`,
and fails on an overlap, a label within 14 units of an edge, type under 11 at the narrowest
column a record page gives a picture, or a root missing `width`/`height`. Then it runs the
whole pass again with `.s` forced to Verdana and `.m` to Lucida Console — a reader whose
interface face is wider than this machine's, which is what the contract's "leave a fifth of
every label's box empty" is asking for. It also keeps the folder honest both ways: a scene
no record points at is a leftover from a rework, and a reference to a file that is not
there is a mis-citation. References inside code fences and code spans are not citations —
records that *document* the `![alt](assets/x.svg)` syntax are right, and reading those as
citations turned this gate red on WORK-0040 before it had that rule. The gate lives in this
repo only: a project on the installed app gets doctor's warnings and the contract's
arithmetic, nothing more — which is why doctor's fix text says where the gate lives instead
of naming a script the reader does not have.

**The scenes are hand-authored SVGs** under `AgentMonitoring/assets/`, and each carries its
own header comment: the grid it was drawn on and a line per element naming the sentence of
the record that element comes from. Read that comment before you change a drawing — the
honesty law is per element, and the trace is the only place the reasoning survives. Label
width is the thing the wide-face pass actually catches (WORK-0089's first draft failed it
twice): keep band labels short — a side pair at 22px survives Verdana at roughly 17
characters each, a centred label near an edge at fewer.

**The measured column.** Since WORK-0092 the pictures sit inside cards (the overview card, a node card on the rail, the outcome card — the Human view is the agent page's skeleton). Walking the app's window from 700 to 1920 with a Human view open, the node card's column is the narrowest of the three: **464 CSS px** at window ~1140, where the record's rail comes back beside a still-narrow page (the sheet-era measurement was 424 at 1104). The contract's floor stays **395** — every shipped scene was drawn to it, the gate checks against it, and a floor is only ever re-measured wider, never assumed — with `.prose-img`'s 560px max-height in the arithmetic so a tall scene is measured at the height that actually ships.

## For humans

이 프로젝트의 쉬운 말 페이지에는 이야기 한 걸음마다 작은 그림이 하나씩 붙습니다. 2026년 8월 25일부터는 그림을 넣는 철자까지 정해져 있습니다: 그림 줄은 앞뒤에 빈 줄을 둔 제 문단이어야 하고, 그림 파일의 첫 줄에는 가로·세로 크기가 적혀 있어야 합니다. 둘 중 하나라도 빠지면 그림이 글자 한 줄 높이로 쪼그라든 채 실려 나갑니다 — 실제로 한 번 그렇게 나갔고, 그날 점검 명령이 두 모양을 다 경고하게 되었습니다.

**그림 속 글자는 다른 어떤 검사에도 안 보입니다.** 잘린 글자를 찾는 이 프로젝트의 검사는 페이지를 읽는데, 그림은 그 안에서 제 나름의 문서라서, 그림 안의 이름 둘이 겹쳐도 아무것도 경고하지 않습니다. `npm run check:scenes`가 그 일을 합니다: 기록이 인용하는 그림을 전부 브라우저로 열어 낱말마다 상자를 재고, 겹침·가장자리 붙음·너무 작아질 글자·크기 안 적힌 첫 줄을 거절합니다. 그다음 일부러 더 넓은 글씨체로 같은 검사를 한 번 더 돌립니다 — 이 컴퓨터가 아닌 다른 컴퓨터 몫입니다. 그물을 "인용된 그림 전부"로 넓힌 첫날, 규칙이 생기기 전에 작은 글씨로 그려진 옛 그림 한 장이 바로 걸려 다시 그려졌습니다.

**아무도 가리키지 않는 그림도 알아챕니다.** 이야기의 그림을 다시 그리면 옛 그림은 어디서도 언급되지 않은 채 디스크에 남는데, 그 검사가 이름을 불러 주므로 조용히 썩는 대신 버릴 수 있습니다.

**무엇에 비해 너무 작은지도 다시 쟀습니다.** 그림은 이제 카드 안에 놓이므로, 앱 창을 700부터 1920픽셀까지 걸으며 그림이 받는 폭을 지켜봤습니다. 가장 좁은 곳은 1140 근처 창의 노드 카드로 464픽셀 — 옛 배치의 424보다 넉넉합니다. 규칙은 여전히 395 기준으로 그리라고 합니다: 지금 있는 그림 전부가 그 숫자로 만들어졌고, 안전 기준선은 새 측정이 더 넓다고 증명할 때만 올라갑니다.

그림은 감상하지 말고 측정하십시오.
