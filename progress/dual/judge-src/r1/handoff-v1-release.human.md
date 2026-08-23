Version 1.0.5 of this app is published and installable. That is where things stood when
this hand-over was last written, on 22 August 2026. Anyone already running an older copy
is offered the new one from a card in the app's sidebar.

**The newest release always wins.** The card fetches whatever the latest published version
is, so a machine several versions back jumps straight to it and never installs the ones
between. This machine's own installed copy was last confirmed at 1.0.1.

**Two things changed for people in the last two releases.** 1.0.5 now warns you when a
rewrite of a note would change what kind of note it is, and prints the exact command that
puts the old kind back. Leaving the kind out never changed it; the warning is for when a
different one is spelled out. 1.0.4 turned note names written inside ordinary prose into
buttons you can click to jump to that note.

**Publishing the next version is one command, with one thing to get right first.** The
version number is written in three separate files and they must all agree — the command
`npm run release` refuses to start when they disagree. It then builds the Windows
installer and puts it on the project's GitHub page, through the GitHub command-line tool
it is signed in to.

**Three traps have already caught somebody here.** All are fixed, but they bite again if
you touch that area. The step that fetches the file needs the flag `-UseBasicParsing`
under version 5.1 of PowerShell, the scripting tool Windows runs these steps with. The
step that bundles extra files into the app loses the folder structure when you point it at
a pattern of files, so point it at a folder instead. And the installer remembers your last
install folder in a Windows setting at `HKCU/Software/agentmonitoring/AgentMonitoring`:
install once into a scratch folder, and every later "default" install goes there too until
that entry is deleted.

**Updating from the oldest copies still looks wrong.** Coming from 1.0.1 or older, the
update runs in a visible black text window; from 1.0.2 onward it happens behind a small
branded window instead. When an update fails, a message box is the first sign and the
details land in `%TEMP%/agentmonitoring-update.log`.

One old label is off. The marker showing where `v1.0.0` sits in the project's history
points one change too early, before its shakedown fixes. The file people downloaded was
rebuilt from the fixed code, so what they installed behaves correctly. Every release since
has marker and file from the same point.

Before you ship anything here, check that the same version number is written in all three
places.