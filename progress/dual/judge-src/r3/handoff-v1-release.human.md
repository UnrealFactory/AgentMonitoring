Version 1.0.5 is published and installable; that was true on 22 August 2026. Anyone on an older copy is offered it from a card in the app's sidebar, which always installs the newest published version, so a machine several releases back jumps straight to it. This machine's own copy was last confirmed at 1.0.1.

**1.0.5 stops a note quietly losing its rank.** A note can be marked `essential`, the kind whose name says it must not be skipped. Rewriting it and naming a different kind used to take that mark off in silence; both ways in now warn, and print the exact command that puts it back. Leaving the kind out never changed it.

**Publishing the next version is one command, with one thing to get right first.** The version number sits in three separate files and all three must agree; `npm run release` refuses to start when they do not. It builds the Windows installer and puts it on the project's GitHub page, through the GitHub command-line tool it is signed in to.

**Three traps have already caught somebody here.** All are fixed; all bite again if you touch that area. The download step needs the flag `-UseBasicParsing` under PowerShell 5.1, the scripting tool Windows runs these steps with. The step that bundles extra files into the app flattens folders when pointed at a pattern, so point it at a folder. And the installer remembers your last install folder, so a scratch install sends every later "default" one there until that memory is cleared.

It is like a shop that keeps your last delivery address and quietly starts calling it home.

**When an update goes wrong, the trail is in `%TEMP%/agentmonitoring-update.log`**, and the failure itself shows as a message box. From 1.0.1 or older the update runs in a visible text console; from 1.0.2 on it runs behind a splash screen.

Before you ship anything here, check the version number in all three files.