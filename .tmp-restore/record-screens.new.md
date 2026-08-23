`npm run check:live`, the check that proves a record written to the project reaches every open screen without a reload, opened a note page and waited for that note's one-line summary. It waited thirty seconds and gave up. Mid-run, the note it was reading had gained a plain-language retelling, and a record that has one opens on it.

Each record page here can be read two ways: the technical write-up, or the same events in plain language. It shows one at a time, and remembers which you asked for, under `agentmon.recordView`, while your window is open. It is like a shop sign with two faces: whoever walks up next reads whichever face the last person left showing.

**Every script that drives the app presses the half it wants now.** It presses by `data-value`, the button's fixed internal name, because the words on the button change with the language. The two buttons also answer the left and right arrow keys, as do the five other button-rows like them; one press moves and chooses.

**The two halves do not hold the same things.** The report, the questions and answers, the outcome and the list of updates are on the technical side only. On both: the title block, a note's one-line summary, the line over a corrected retelling, and the list of related records.

**That summary belongs to the note, not to its body.** It is `.note-lead`, the line every list of notes prints under the title, so it stays where the title does. On the plain half it is set at the size of the retelling below it, and runs the same width.

**Only the two buttons change what the app remembers.** Two other things open the technical side: the box on an unretold record, and the line over a corrected retelling. Each is about the record you are on and nothing else, and the page says so in one small line, `.view-peek`, while it lasts. A check that presses either and then asks what you chose gets the same answer as before.

**For one round those two changed it for the whole window.** A reader who chose the plain half lost that choice at the first record written before retellings existed, was told nothing, and stayed switched for as long as the window was open.

**The app-feedback board is a list, not one record.** It says "nothing here has been retold yet" once for the whole list, in a panel called `.human-notice`, not per row. So a script waiting only for a retelling, `.human-view`, hangs on a board where nothing has been retold; wait for either. The board opens on whichever half most of its rows have, so one retold row in five does not open four blanks. The control at its top talks about the board, because there is no record there to name.

**The plain half is one size larger than the technical half, and both sizes move.** This app grows its own text at two window widths, so the reading size is 15 points on a small window, 16 on a wider one, 17 on the widest. A check asserting a size has to say at which width.

**Only the first paragraph of a retelling is set large.** Everything under it is at reading size. Three of the 107 retellings here are written with no bold headings at all, as the writing guide allows, and those three used to be drawn large top to bottom. So a check measuring the big size must measure that first paragraph, not the block around it.

**A retelling with no bold headings still ends on its own line now.** That closing line gets its own tinted block, and it is drawn on 102 of the 107 pages rather than 99. Two things still withhold it: a closing paragraph over 200 characters, and a last section that is only one paragraph long.

**The choice is settled once, when the page loads.** This app is live, so an agent adding a retelling to a record you have open must not swap the page under you.

A script that does not say which half it wants reads whichever one it happened to get.
