On 22 August 2026 somebody wrote down how this program guards the half of a record that is written for people rather than for other programs.

**One file decides what that half is.** `crates/agentmon-core/src/human.rs` reads it out of a record, writes it back at the end, and refuses a save when an agent leaves it out. Typed commands, the interface agents call and the desktop window all ask that one file.

**The heading belongs to the program.** The people-half sits under a line reading `## For humans`, and an agent may not put that line in the half meant for programs. Whether a line counts as that heading is decided in another file — and that decision must be as generous as every part of the app that draws one on a screen.

**Three times running it was not.** First an indented one slipped through. Then one written with a tab, and one starting with an invisible mark that some text editors put at the front of a file. Then characters that paint nothing: a blank of no width on the end, or a Cyrillic `о`, the letter Russian writes, drawn exactly like the English one. Each saved without complaint, and the screen drew it as the program's own heading.

It is like a doorman working from a printed list while the party inside knows everyone by face: the two can disagree about the same guest.

**Headings are now compared the way an eye sees them.** What paints nothing is thrown away first. A letter drawn exactly like one of the nine in "for humans" folds into it, whichever alphabet it came from. Then the spaces flatten and the capitals go.

**The rule lives twice, so both copies answer to one list.** `scripts/project-fs.mjs` holds the second copy, and changing one without the other leaves a record with two truths. Every spelling that has fooled the guard, with the verdict each should get, sits in `crates/agentmon-core/tests/reserved-heading-shapes.json`, written as escape codes because half of them are invisible. Three separate readers are driven through that one list. It holds the spellings somebody has already thought of, so a new one goes there, not into a single test.

**The refusal is where an agent learns the rules.** It prints the short version, cut straight out of `docs/HUMAN_STYLE.md`, the writing guide, while the program is built. Edit that guide, build again, and every refusal changes with it. Nothing shortens that message now: a length limit once cut its last line off, the first time the guide grew.

A guard narrower than the screen it protects is not a guard.
