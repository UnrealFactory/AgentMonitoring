Version 1.0.5 is published and installable; that was true on 22 August 2026. Anyone on an older copy is offered it from a card in the app's sidebar, which always fetches the newest published version, so a machine several releases back jumps straight to it. This machine's own copy was last confirmed at 1.0.1.

**1.0.5 stops a note quietly losing its rank.** A note can be marked `essential`, the kind whose name says it must not be skipped. Rewriting it and spelling out a different kind used to take that mark off in silence. Both ways in — the command line and the tool server agents call — now warn, and print the exact command that puts the mark back. Leaving the kind out never changed it.

**The same release stopped a rewrite being mistaken for a first draft.** Before rewriting a note by name, that tool server asks whether it exists; any failure of the asking read as "there is no such note", so a rewrite met a demand for a brand-new note's details. Only the answer that really means "there is none" counts now. 1.0.4 before it turned note names typed into prose into buttons you can click.

**Joining a project to the tool server is a file now, not an instruction.** A file named `.mcp.json` in the project does it, written for you by the app's New project option or by either of two commands, and merged into whatever that file held. The project templates no longer tell you to register the server by hand.

**Publishing the next version is one command, with one thing to get right first.** The version number sits in three separate files and all three must agree; `npm run release` refuses to start when they do not. It builds the Windows installer and puts it on the project's GitHub page, through the GitHub command-line tool it is signed in to.

**Three traps have already caught somebody here.** All are fixed; all bite again if you touch that area. The download step needs the flag `-UseBasicParsing` under PowerShell 5.1, the scripting tool Windows runs these steps with. The step that bundles extra files into the app flattens folders when pointed at a pattern, so point it at a folder. And the installer remembers your last install folder at `HKCU/Software/agentmonitoring/AgentMonitoring`, so a scratch install sends every later "default" one there until that entry is deleted.

It is like a shop that keeps your last delivery address and quietly starts calling it home.

**Updating from the oldest copies still looks wrong.** From 1.0.1 or older you get a visible black text window; from 1.0.2 on it runs behind a small branded one. A failure shows a message box, with the trail in `%TEMP%/agentmonitoring-update.log`.

One old label is off: the marker for `v1.0.0` sits one change too early, though what people downloaded was built from the fixed code.

Before you ship anything here, check the version number in all three files.