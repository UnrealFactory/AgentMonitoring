Version 1.0.5 is out and anyone can install it, as of 22 August 2026. An older copy is offered it by a card in the app's sidebar, which always installs the newest version. This machine's copy was last confirmed at 1.0.1.

**1.0.5 stops a note quietly losing its rank.** A note can be marked `essential`, the kind that must not be skipped. Rewriting it under a different kind used to take that mark off in silence; leaving the kind out never did. Both ways of writing a note warn instead: the command line and the go-between server agents call. Each prints the exact command that puts it back.

**The same release stopped a rewrite passing as a first draft.** Before rewriting a note by name, that server asks whether it exists. Any failure of that question used to read as "there is no such note", so a rewrite passed for a first write. Only the answer that really means "there is none" counts.

1.0.4 turned a note's name written in double square brackets into a link you can click.

**Joining a project to that server is a file now.** A file named `.mcp.json` in the project does it. The app writes it from its New project option; two commands do it too. Anything already in it is kept, and the starter instructions no longer tell you to register by hand.

**Publishing the next version is one command.** The version number sits in three files, and `npm run release` refuses to start unless all three agree. It builds the Windows installer and puts it on the project's GitHub page, through the GitHub command-line tool it is signed in to.

**Three traps have already caught somebody here.** All three are fixed, but worth knowing when you touch that area. The download step needs the flag `-UseBasicParsing` under PowerShell 5.1, the scripting tool Windows runs these steps with. The step that bundles extra files into the app flattens folders when pointed at a pattern; point it at a folder.

**The installer remembers where you last installed it,** at `HKCU/Software/agentmonitoring/AgentMonitoring`. One scratch install sends every later "default" one there until you delete that entry.

It is like a shop that keeps your last delivery address and quietly starts calling it home.

**Updating from 1.0.1 or older still shows the old updater: a visible text window.** From 1.0.2 on it runs behind a small window. A failure shows a message box, and the trail goes to `%TEMP%/agentmonitoring-update.log`.

The `v1.0.0` marker sits one change before its own fixes, but what people downloaded was built from the fixed code, so the app is right.

Before you ship anything here, check the version number in all three files.
