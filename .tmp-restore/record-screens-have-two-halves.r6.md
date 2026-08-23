Each record page in this app can be read two ways: the technical write-up, or the same events in plain language. The page shows one at a time. It remembers which one you asked for, under `agentmon.recordView`, while your window is open.

That matters for the scripts that drive the app to take screenshots or run checks. A script that opens a record and looks for a heading may be looking at the other half. The half it gets is whatever the last screen left behind. Each script now says which half it wants before it looks, by pressing one of the two buttons. It presses by `data-value`, the button's fixed internal name, because the words on it change with the language.

**Only the two buttons change what the app remembers.** Two other things on the page open the technical side. They are the box on an unretold record, and the line over a corrected retelling. Each is about the record you are on, and nothing else. The page says so in one small line, `.view-peek`, while it lasts.

So a check that presses one of them, then asks the app what you chose, should expect the same answer as before.

**A note's one-line summary is on both halves.** That summary is `.note-lead`. It is not part of the note's body. It is the line every list of notes prints under the title, so it stays where the title stays.

**The app-feedback board is a list, not one record.** It says "nothing here has been retold yet" once for the whole list, in a panel called `.human-notice`, instead of once per row. The control at its top talks about the board rather than about a record, because there is no single record there to talk about.

A script that does not say which half it wants is reading whichever one it happened to get.
