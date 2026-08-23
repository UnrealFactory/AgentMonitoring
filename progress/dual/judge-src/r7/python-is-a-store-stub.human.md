Typing `python` on this machine does nothing at all. The command is there, but it is a
stand-in that Windows ships pointing at its own app store, and it quits without running
your program. `python3` behaves the same way. Somebody wrote this down on 21 August 2026.

It is like a doorbell wired to nothing. You press it, and the house stays quiet.

**Node is the one that is really installed, at version 24.** Node is the other program
here that runs written-out scripts. So the way to get a small helper to run is to save it
into a temporary file whose name ends `.cjs` or `.mjs`, and then run that file.

**Saving it to a file is not just tidiness.** Pasting a long multi-line script straight
into the command line can mangle the backslashes in Windows paths, which is what separates
one folder from the next here. The script arrives with its paths quietly broken. A file
avoids that.

**One trap is left, and it announces itself by name.** When a helper sitting in a
temporary folder loads code out of the project, that location has to be written in the
web-address form `file:///C:/...`. Hand it a bare `C:/...` instead and it refuses with
`ERR_UNSUPPORTED_ESM_URL_SCHEME` — its way of saying the address does not start with a
prefix it recognises.

All of this is about this one machine, and nobody wrote down whether another would behave
the same way.

Reach for Node here, and put it in a file before you run it.