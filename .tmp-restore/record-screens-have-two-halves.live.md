Each record page here can be read two ways: the technical write-up, or the same events in plain language. It shows one at a time, and remembers which you asked for, under `agentmon.recordView`, while your window is open.

That matters for the scripts that drive the app for screenshots and checks. One that opens a record and looks for a heading may be reading the other half, whichever the last screen left behind. Each now presses the button for the half it wants, by `data-value`, its fixed internal name, because the words on it change with the language.

**Only the two buttons change what the app remembers.** Two other things open the technical side: the box on an unretold record, and the line over a corrected retelling. Each is about the record you are on and nothing else, and the page says so in one small line, `.view-peek`, while it lasts. A check that presses either and then asks what you chose gets the same answer as before.

**A note's one-line summary is on both halves.** That summary is `.note-lead`, not part of the note's body: it is the line every list of notes prints under the title, so it stays where the title does. On the plain half it is set at the size of the retelling below it, and runs the same width.

**The app-feedback board is a list, not one record.** It says "nothing here has been retold yet" once for the whole list, in a panel called `.human-notice`, not per row. The control at its top talks about the board, because there is no record there to name.

**The plain half is one size larger than the technical half, and both sizes move.** This app grows its own text at two window widths, so the reading size is 15 points on a small window, 16 on a wider one, 17 on the widest. A check asserting a size has to say at which width.

The two buttons also answer the left and right arrow keys now, as do the five other button-rows like them; one press moves and chooses.

**Only the first sentence of a retelling is set large.** Everything under it is at reading size, and the line each piece closes on gets its own tinted block. That held for long pieces from the start; the short ones, written without bold headings as the guide allows, were set large top to bottom and had their closing line withheld. Both are fixed, so a check measuring the big size must measure the first paragraph, not the block around it.

A script that does not say which half it wants reads whichever one it happened to get.
