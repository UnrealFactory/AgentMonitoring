---
name: human-area-enforcement
title: The human area is enforced in agentmon-core, and its rules are cut from the doc at build time
type: memory
description: The human area is enforced in agentmon-core; the guard is only as wide as body.rs says a heading is, and its Node twin must match
agent: d2-human-area-builder
updated_by: d2-human-area-builder
created: 2026-08-22T08:20:45Z
updated: 2026-08-22T13:02:29Z
tags: [human-area, core, cli, parsing]
refs: [WORK-0066, WORK-0067]
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
`bug resolve`, `note add`, `note update --body`, `app-feedback add`. Closing verbs
*replace* it. Required on the first touch of a record that has none (that is why
`bug claim` has an optional `--human` the SPEC's CLI block does not list — the alternative
was a dead end on legacy bugs). Alone on `work update` / `bug comment` / `note update` /
`app-feedback update` it is a refresh: nothing lands in `## Updates`/`## Comments` and one
`human_updated` event is logged. App feedback is machine-level and has no `events.jsonl`, so
it logs none and keeps `--at` in its own `updated:` frontmatter key instead; over MCP that
verb is `app_feedback` with an `id`.

**The rejection is the teaching.** `CoreError::MissingHuman` prints the flag, then the
compact rules, then `agentmon human-style`. Those rules are cut out of
docs/HUMAN_STYLE.md between the `<!-- compact-rules -->` markers **at build time**
(crates/agentmon-core/build.rs). Edit the doc, rebuild, the errors change with it — and a
missing marker fails the build on purpose. `mcp/lib/cli.mjs` does not shorten that one
message at all: any ceiling there is a guess about how long that doc is, and the 2500-
character one took the contract line off the end of every refusal the first time the doc grew.

**On disk vs on the wire.** The file is the one place both areas cohabit. Every parsed
payload (`--json`, both app transports) has `body` = the agent area only and `human` =
`string | null`. If you add a reader, split before you parse sections, or the section
lands in `extra_sections` as well.

## For humans

This is a note for whoever works on this program next, about the half of a record that is
written for people rather than for other programs.

The rule is simple. When an agent saves a piece of work, a bug or a note, it must also write
a plain-language version of the same thing, and the program refuses to save without one. All
of the deciding lives in one file, so the three ways of using the app — the command line, the
tool interface agents call, and the desktop window — behave the same. If you add a fourth, do
not rewrite the rules; call the same file.

**The trap that has now caught three rounds.** The plain half sits under a heading that reads
"For humans", and the program keeps that heading for itself. Whether a line counts as that
heading is decided somewhere else, and that decision has to be at least as generous as every
part of the app that draws one. Three times it was not.

First a tab instead of a space. Then an invisible mark some text editors put at the start of
a file, which counts as blank space in one of the two programming languages this app is
written in and not in the other — so the same record read one way in the desktop window and
another way in the browser. Then characters that take up no room on the screen at all. A
zero-width space is a real character to a computer and nothing to an eye, so "For humans"
with one on the end was a different heading to the check and the same ten letters to the
reader. A Russian о in place of the English one does it with a letter you can see.

It is like a guest list checked by spelling alone. One invisible extra letter, and the same
person walks in.

**What to do about it.** Compare two headings the way a reader sees them: drop what paints
nothing, treat letters drawn alike as the same letter, then flatten the spaces and the
capitals. When you change that rule, change it in both copies in the same commit — one copy
serves the desktop window, the other the browser — and add your example to the shared list of
spellings that all three readers are tested against. One list is the point.

One more thing if you edit the writing guide: the short rules an agent is shown when it
forgets are cut out of that guide when the program is built, so editing the guide and
rebuilding changes what agents are told. The piece that carries that message to agents no
longer shortens it, because guessing how long the guide was is how its last line went missing.

A character nobody can see is still a character the computer counts.
