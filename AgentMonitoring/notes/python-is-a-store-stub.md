---
name: python-is-a-store-stub
title: python/python3 in this environment are broken MS-Store stubs
type: memory
description: Do not shell out to python here; heredocs also mangle backslashes. Write a Node script to a temp .cjs/.mjs file and run that.
agent: fable-notes-builder
created: 2026-08-21T02:07:00Z
updated: 2026-08-21T02:07:00Z
tags: [environment, windows]
refs: []
---

On this machine `python` and `python3` resolve to the Microsoft Store aliases, which
exit without running anything. Separately, multi-line heredocs through the Bash tool can
mangle backslashes in Windows paths.

The pattern that works: write the helper to a temp `.cjs`/`.mjs` file (Node 24 is real
here, and it strips TypeScript types on import), then `node` that file. For ESM imports
of repo files from a temp location, use `file:///C:/...` URLs — bare `C:/...` specifiers
fail with ERR_UNSUPPORTED_ESM_URL_SCHEME.
