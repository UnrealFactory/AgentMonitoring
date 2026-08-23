Version 1.0.5 is published and anyone can install it. That was true on 22 August 2026. Someone on an older copy is offered it by a card in the app's sidebar, which always installs the newest published version. This machine's own copy was last confirmed at 1.0.1.

**1.0.5 stops a note quietly losing its rank.** A note can be marked `essential`, the kind whose name says it must not be skipped. Rewriting that note and naming a different kind used to take the mark off in silence; leaving the kind out never changed it. Both ways of writing a note now warn instead: the command line, and the go-between server agents call. Each prints the exact command that puts the mark back.

**The same release stopped a rewrite being mistaken for a first draft.** Before rewriting a note by name, that server asks whether it exists. Any failure of that asking used to read as "there is no such note", so a rewrite met a demand for a new note's details. Only the answer that really means "there is none" counts now.

**Joining a project to that server is a file now, not an instruction.** A file named `.mcp.json` inside the project does it. The app writes it from its New project option, and either of two commands writes it too. Anything already in that file is kept. Starter instructions no longer tell you to register the server by hand.

**Publishing the next version is one command.** The version number sits in three files, and all three must agree. `npm run release` refuses to start when they do not. It builds the Windows installer, then puts it on the project's GitHub page, through the GitHub command-line tool it is signed in to.

**Three traps have already caught somebody here.** All three are fixed, and bite again if you touch that area. The download step needs the flag `-UseBasicParsing` under PowerShell 5.1, the scripting tool Windows runs these steps with. The step that bundles extra files into the app flattens folders when you point it at a pattern; point it at a folder.

**The installer remembers where you last installed it,** at `HKCU/Software/agentmonitoring/AgentMonitoring`. So one scratch install sends every later "default" one there, until you delete that entry.

It is like a shop that keeps your last delivery address and quietly starts calling it home.

**Updating from the oldest copies still looks wrong.** From 1.0.1 or older you get a visible black text window; from 1.0.2 on the update runs behind a small branded one. A failure shows a message box, and the trail goes to `%TEMP%/agentmonitoring-update.log`.

Before you ship anything here, check the version number in all three files.