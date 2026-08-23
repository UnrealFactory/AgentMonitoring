---
name: record-screens-have-two-halves
title: A record screen draws one half at a time — a script that reads a record body must press the half it means
type: memory
description: A gate that does not press a segment reads whichever half the screen before it left behind — the choice is a session value that follows the page.
agent: d3-human-view-builder
updated_by: fable-human-backfill
created: 2026-08-22T14:49:47Z
updated: 2026-08-23T08:11:37Z
tags: [gates, dual-record, ui]
refs: [WORK-0069, WORK-0070, WORK-0072]
---

Since WORK-0069 the four record surfaces — work detail, bug detail, note detail and the
app-feedback board — draw **one** of a record's two areas at a time. A record that carries
a human area opens on it; the reader's choice is kept in `sessionStorage`
(`agentmon.recordView`, src/lib/recordView.ts) and follows the window across navigations.

Five consequences for anything automated:

- **Press the half you mean.** `await page.locator('.view-toggle [role="tab"][data-value="agent"]').click()`
  — by `data-value`, never by the segment's word, because the app ships in two languages.
  Every screen in scripts/screenshot.mjs, check-i18n.mjs, check-clipping.mjs and
  check-live.mjs that draws a record now declares its half; the one that did not (check-live's
  note page, waiting for `.note-lead`) died of a 30s timeout the moment its note gained a
  human area mid-run. Since WORK-0072 the segments also answer **← → Home End**
  (src/lib/tablist.ts, one handler shared by all six `.segmented` tablists in the app), and
  a move both focuses and presses — so a gate driving the keyboard changes the half with one
  key, and a gate counting tab stops still finds every segment where it was.
- **What is only in the agent half**: `#what`/`#why`/`#how`, `#files`, `#outcome`,
  `#updates`, `#report`, `#thread`, `#body`, the resolution card and the contents rail. What
  is in **both**: the record head (title, id, status, agent, dates, tags), a note's own
  description (`.note-lead` — a frontmatter field and the line every notes list prints, not
  part of the body; on the human half it is set at the reading size and keeps the column's
  width, the same as the sheet under it), the correction line
  (`.correction-notice` — a correction is posted without rewriting the retelling, so the
  retelling must admit to one), the 관련 항목 rail and the side facts card. The human half is
  `.human-sheet` (or `.human-empty` on a record written before human areas existed).
- **Only the toggle changes the session choice.** Two other controls open the other half —
  the empty box's "read the agent's half" button, and the correction line over a retelling —
  and both are one record wide: they set a component-local override, leave
  `agentmon.recordView` exactly as it was, and the screen carries `.view-peek` (a live region)
  while it is up. A gate that presses either and then reads the stored value must expect it
  unchanged; a gate that wants the session changed presses a segment. Both were session-wide
  setters for a round, and a reader who pinned the human half lost it at the first legacy
  record, silently, for the rest of the window (WORK-0071).
- **A board is not a screen per record.** The app-feedback board has one toggle for every
  row, and its human half is not N copies of the detail screen's empty box: a row with no
  retelling is one line (`.feedback-none`) and the whole board gets one instruction
  (`.human-notice`) above the list. So a script waiting on `.human-view` alone hangs on a
  board where nothing has been retold — which is the state SPEC says every board starts in.
  Wait for `.human-view, .human-notice`. The board's default reads the majority, not
  `.some()`: one retold row out of five must not open four absences. Its toggle also speaks
  board-language (`view.boardLabel`, `view.boardHumanNoneTip`), because a board draws no
  record to name.

- **The human half has its own type scale, and it is not a constant.** `--text-read`,
  `--text-read-lead` and `--text-read-lede` are re-declared on `:root` inside the two
  wide-window queries in src/styles/app.css (15/18/20 below 1560, 16/19/21 at 1560, 17/20/22
  at 1840), because they mean "one step above whatever `.prose` is at this width" and
  `.prose` itself steps 14 → 15 → 16 there. Anything that asserts a pixel size on either half
  must say at which width, and `.human-sheet` is always exactly the width of `.detail-main`
  — the measure lives in its `padding-inline`, not in a `max-width` (WORK-0072).

- **`--text-read-lede` is on one paragraph, not on `.human-lede`.** Since WORK-0073 the rule
  is `.human-view .prose.human-lede > p:first-child`; the container is at `--text-read` like
  the rest of the sheet, and so is every paragraph of the opening after the first. So a gate
  that reads `getComputedStyle(document.querySelector(".human-lede")).fontSize` and expects
  the lede size gets the reading size and is right to — read the first `p`. It matters because
  14 of the 107 live retellings open on more than one paragraph, and 3 open on nothing else:
  a retelling with no bold lead-ins is *all* opening run (docs/HUMAN_STYLE.md, "A thin record
  gets no lead-ins at all"), and those three used to be drawn entirely at 21px.

- **A retelling with no beats still has a closing line.** `readHumanStory` carves it off the
  opening run when there are no beats, exactly as it carves it off the last beat when there
  are (src/lib/human.ts, WORK-0073), so `.human-takeaway` is on the page for 102 of the 107
  live retellings rather than 99. What still withholds it: a closing paragraph over 200
  characters, and a one-paragraph last beat, whose single paragraph is its body.

The default is latched per record when it loads, not recomputed on every refresh: this app
is live, and an agent adding a human area to a record somebody has open must not swap the
page under them.

## For humans

Each record page here can be read two ways: the technical write-up, or the same events in plain language. It shows one at a time, and remembers which you asked for, under `agentmon.recordView`, while your window is open.

That matters for the scripts that drive the app for screenshots and checks. One that opens a record and looks for a heading may be reading the other half, whichever the last screen left behind. Each now presses the button for the half it wants, by `data-value`, its fixed internal name, because the words on it change with the language.

**Only the two buttons change what the app remembers.** Two other things open the technical side: the box on an unretold record, and the line over a corrected retelling. Each is about the record you are on and nothing else, and the page says so in one small line, `.view-peek`, while it lasts. A check that presses either and then asks what you chose gets the same answer as before.

**The two buttons answer the left and right arrow keys now.** So do the five other button-rows like them, and one press both moves and chooses.

**A note's one-line summary is on both halves.** That summary is `.note-lead`, not part of the note's body: it is the line every list of notes prints under the title, so it stays where the title does.

**The app-feedback board is a list, not one record.** It carries one notice for the whole list, `.human-notice`, instead of an empty box on every row. The control at its top talks about the board, because there is no record there to name. Which half it opens on follows the majority of its rows: one retold row out of five must not open four blanks.

**A page picks its half as it opens and does not change its mind under you.** This app is live — somebody can add a plain retelling to a record while you have it open on screen. When that happens the page you are reading stays as it is.

**The plain half is one size larger than the technical half, and both sizes move.** This app grows its own text at two window widths, so the reading size is 15 pixels on a small window, 16 on a wider one, 17 on the widest. A check asserting a size has to say at which width.

**Only the first paragraph of a retelling is set large.** Everything under it is at reading size, and the line each piece closes on is set apart in a block of its own. Short pieces, written without bold headings as the guide allows, used to be set large top to bottom and lost that closing block.

**Both are fixed now.** A check measuring the big size must measure the first paragraph, not the block around it. Two shapes still keep the closing line inside the text: a last paragraph over two hundred characters, and a last section that is one paragraph.

A script that does not say which half it wants reads whichever one it happened to get.
