Version 1.0.5 is published and anyone can install it. That was true on 22 August 2026. Someone on an older copy is offered it by a card in the app's sidebar. That card always installs the newest published version, so a machine several releases back jumps straight to it. This machine's own copy was last confirmed at 1.0.1.

**1.0.5 stops a note quietly losing its rank.** A note can be marked `essential`, the kind whose name says it must not be skipped. Rewriting that note and naming a different kind used to take the mark off in silence. Leaving the kind out never changed it.

**Both ways of writing a note now warn instead.** One is the command line. The other is the go-between server that agents call. Each prints the exact command that puts the mark back.

**The same release stopped a rewrite being mistaken for a first draft.** Before rewriting a note by name, that server asks whether the note exists. Any failure of that asking used to read as "there is no such note". So a rewrite met a demand for a brand-new note's details. Only the answer that really means "there is none" counts now.

1.0.4, the release before it, turned note names written inside a record's text into buttons you can click.

**Joining a project to that server is a file now, not an instruction.** A file named `.mcp.json` inside the project does it. The app writes that file for you from its New project option, and either of two commands writes it too. Anything already in that file is kept. The starter instructions for a new project no longer tell you to register the server by hand.

**Publishing the next version is one command, with one thing to get right first.** The version number sits in three separate files, and all three must agree. `npm run release` refuses to start when they do not. It builds the Windows installer, then puts it on the project's GitHub page, through the GitHub command-line tool it is already signed in to.

**Three traps have already caught somebody here.** All three are fixed, and all three bite again if you touch that area. The download step needs the flag `-UseBasicParsing` under PowerShell 5.1, the scripting tool Windows runs these steps with. The step that bundles extra files into the app flattens folders when you point it at a pattern, so point it at a folder.

**The installer remembers where you last installed it.** It keeps that folder at `HKCU/Software/agentmonitoring/AgentMonitoring`. So one scratch install sends every later "default" one to the same place, until you delete that entry.

It is like a shop that keeps your last delivery address and quietly starts calling it home.

**Updating from the oldest copies still looks wrong.** From 1.0.1 or older you get a visible black text window. From 1.0.2 on, the update runs behind a small branded window. A failure shows a message box, and the trail is written to `%TEMP%/agentmonitoring-update.log`.

One old label is off: the marker for `v1.0.0` sits one change too early. What people downloaded was built from the fixed code, so the app itself is right.

Before you ship anything here, check the version number in all three files.