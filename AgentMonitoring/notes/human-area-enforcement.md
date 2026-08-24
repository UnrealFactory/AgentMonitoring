---
name: human-area-enforcement
title: The human area is enforced in agentmon-core, and its rules are cut from the doc at build time
type: memory
description: The human area is enforced in agentmon-core; the ceiling bounds one telling, the guard is only as wide as body.rs says a heading is, and its Node twin must match
agent: d2-human-area-builder
updated_by: fable-human-gate
created: 2026-08-22T08:20:45Z
updated: 2026-08-24T13:04:50Z
tags: [human-area, core, cli, parsing]
refs: [WORK-0066, WORK-0067, WORK-0086]
---

**Where the rules live.** `crates/agentmon-core/src/human.rs` is the only place that knows
what a human area is: `split()` (read), `attach()` (write, always last), `require()`
(validate supplied text) and `reject_reserved()` (refuse `## For humans` in agent prose).
`write.rs` applies the matrix inside each verb, so the CLI, the MCP server and the desktop
app inherit it — never re-implement any of it in a wrapper.

**The guard must be at least as wide as every reader.** `human.rs` does not decide what a
heading is; `body.rs` does (`is_space`, `is_ignorable`, `heading`, `Fences`), and the
reserved-section guard is only as good as that definition. It shipped narrower than its own
readers three rounds running: an indent, then `##<TAB>For humans` and a leading U+FEFF, then
characters that draw nothing at all — `## For humans` with a zero-width space after it, or a
Cyrillic `о` inside it, was an exit-0 write that `src/lib/markdown-parse.ts` drew as the
reserved heading. The rule now, all of it inside `normalize_title`: any space closes the hash
run; what paints nothing is dropped before comparing (`body::is_ignorable` — general category
Cf, U+00AD, the variation selectors, and U+2800, the empty braille cell); the blank ones that
are still a cell wide count as a space (the Hangul fillers, U+2800); a letter drawn exactly
like one of the nine in `for humans` folds to it (`fold_confusable` — Cyrillic, Greek,
Armenian, fullwidth and the mathematical alphabets); then whitespace collapses, the ATX
closing `#` run and a trailing `:` come off, and case folds. A fence closes only on its own
marker, the way `parseBlocks` does.

**Two trims, one edge.** Rust's `str::trim` and JavaScript's do not strip the same characters
(U+FEFF: JavaScript yes, Rust no; U+0085 the other way round), so the human area's own edges
are trimmed with `body::is_space` — the union — on both sides, and "does this record have
one" is `human::is_blank` (nothing but space and invisibles) rather than `trim().is_empty()`.
Before that, `--human-file` on a file Notepad had saved stored a leading byte-order mark that
only one transport reported, and a `--human` of two dozen of those marks was a human area to
Rust and `null` to Node: one record, two answers.

**If you touch any of it, touch `scripts/project-fs.mjs` in the same commit** — `trimSpace`,
`trimSpaceEnd`, `IGNORABLE`/`visibleOnly`, `isBlank`, `BLANK_CELL`, `foldConfusable`,
`seenTitle`, `normalizeTitle`, `headingOf`, `fenceTracker` and `splitHuman` are its twins,
and a disagreement there is one record with two truths.

**One list, three parsers.** `crates/agentmon-core/tests/reserved-heading-shapes.json` is
every spelling and its verdict, written with `\u` escapes on purpose: half of them are
invisible and the rest are letters drawn like other letters, so a fixture spelled with the
characters themselves is one no reviewer can check. `tests/human_area.rs` drives each through
the real write path; `scripts/markdown-smoke.mjs` reads the same file and holds
`project-fs.mjs` and `parseBlocks` to it, plus the end-to-end property — no agent-area payload
ever renders a level-2 heading reading "For humans". Add a spelling there, not to one test.

**The matrix, in one line each.** Required: `work start/done/abandon`, `bug create`,
`bug resolve`, `note add`, `note update --body`, `app-feedback add` — and, since the
owner's 2026-08-24 directive, `work update`/`bug comment` whenever `--message` is passed,
`--replayed` included: agents were using the optional pair as a bypass, posting the real
content as notes while the retelling froze, so a message now travels with its retelling
(which *replaces* the stored one — re-pass the current text when nothing a reader sees
changed). Closing verbs *replace* it. Required on the first touch of a record that has
none (that is why `bug claim` has an optional `--human` the SPEC's CLI block does not
list — the alternative was a dead end on legacy bugs). Alone on `work update` /
`bug comment` / `note update` / `app-feedback update` it is a refresh: nothing lands in
`## Updates`/`## Comments` and one `human_updated` event is logged. Every printed hint
that names one of these verbs (`comment_hint`, doctor's `repair_command`, the `Next:`
lines) carries `--human` unconditionally now — a hint without it exits 2 on the record
it names. App feedback is machine-level and has no `events.jsonl`, so
it logs none and keeps `--at` in its own `updated:` frontmatter key instead; over MCP that
verb is `app_feedback` with an `id`.

**The rejection is the teaching.** `CoreError::MissingHuman` prints the flag, then the
compact rules, then `agentmon human-style`. Those rules are cut out of
docs/HUMAN_STYLE.md between the `<!-- compact-rules -->` markers **at build time**
(crates/agentmon-core/build.rs). Edit the doc, rebuild, the errors change with it — and a
missing marker fails the build on purpose. `mcp/lib/cli.mjs` does not shorten that one
message at all: any ceiling there is a guess about how long that doc is, and the 2500-
character one took the contract line off the end of every refusal the first time the doc grew.

**Length is a warning, never a refusal, and it bounds one telling.** `human::WORDS_MAX` (450)
is the ceiling on a single telling, never on a record's total, so what `doctor::check` reads is
`human::longest_telling()` — the longest run of words between bold lead-ins, fences tracked —
and not `human::words()`, which stays the token count (split on `body::is_space`, so the two
runtimes cannot disagree about a length either). A run never spans two tellings, because a
telling that follows another opens with a lead-in of its own, so the count is a floor and the
warning fires only when some telling really is over. Each such record lands in one
`Level::Warning` carrying that telling's count, beside the missing-human sweep. `require()`
does not look at length, because a long retelling is correct and readable and the repair is a
rewrite by the agent that wrote it; `--strict` still turns the warning into a failure. Before
WORK-0074 the ceiling lived only in docs/HUMAN_STYLE.md and nothing read it — a 703-word human
area shipped, and a hand count was the only thing that caught it. WORK-0075 made it per-telling
after the per-record version reported a work log that shipped five things and told all five,
and the agent sent to fix it deleted two: a gate whose false positive is "cut a fact you owed"
is worse than no gate.

**On disk vs on the wire.** The file is the one place both areas cohabit. Every parsed
payload (`--json`, both app transports) has `body` = the agent area only and `human` =
`string | null`. If you add a reader, split before you parse sections, or the section
lands in `extra_sections` as well.

## For humans

On 22 August 2026 somebody wrote down how this program guards the half of a record written for people rather than for other programs.

**One file decides what that half is.** `crates/agentmon-core/src/human.rs` reads it out of a record, writes it back at the end, and refuses a save when an agent leaves it out. Typed commands, the interface agents call and the desktop window all ask that one file.

**The heading belongs to the program.** The people-half sits under a line reading `## For humans`, and an agent may not put that line in the half meant for programs. Whether a line counts as that heading is decided in a second file, `body.rs`, and that decision must be as generous as every part of the app that draws one on a screen.

**Three times running it was not.** First an indented one slipped through. Then one written with a tab, and one starting with an invisible mark some text editors put at the front of a file. Then characters that paint nothing: a blank of no width on the end, or a Cyrillic `о`, the letter Russian writes, drawn exactly like the English one. Each saved without complaint, and the screen drew it as the program's own heading.

It is like a doorman working from a printed list while the party inside knows everyone by face: the two can disagree about the same guest.

**Headings are now compared the way an eye sees them.** What paints nothing is thrown away first. A letter drawn exactly like one of the nine in "for humans" folds into it, whichever alphabet it came from. Then the spaces flatten and the capitals go.

**The rule lives twice, so both copies answer to one list.** `scripts/project-fs.mjs` holds the second copy, and changing one without the other leaves a record with two truths. Every spelling that has fooled the guard, with the verdict each should get, sits in `crates/agentmon-core/tests/reserved-heading-shapes.json`, written as escape codes because half of them are invisible. Three separate readers are driven through that one list, and a new spelling goes there, not into a single test.

**The refusal is where an agent learns the rules.** It prints the short version, cut straight out of `docs/HUMAN_STYLE.md`, the writing guide, while the program is built. Edit that guide, build again, and every refusal changes with it. Nothing shortens that message now: a length limit once cut its last line off, the first time the guide grew.

**Running long is a complaint, not a refusal.** `agentmon doctor`, which reads a whole project at once, is what makes it, and it counts one run of a retelling rather than the page. A record that did several separate things tells each of them in a short run of its own, and the guide's 450 words bound one run. It counted whole pages once: it reported a work log that had told all five of the things it shipped, and the agent sent to shorten that log cut two of them out whole.

A guard narrower than the screen it protects is not a guard.

**Since 24 August, adding to a record demands the plain telling too.** Adding a progress note or a bug finding used to be allowed without touching the people-half, and some agents leaned on that: the real news piled up in the technical half while the plain telling stayed frozen on day one. Now a note refuses to save unless the plain telling comes with it, brought up to date — and if the note truly changes nothing a reader would see, sending the current telling back unchanged is the honest move.
