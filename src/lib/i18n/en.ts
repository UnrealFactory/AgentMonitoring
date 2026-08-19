/**
 * Every word the app itself prints, in English.
 *
 * This file is the **key set**: `ko.ts` is typed against it, so a key added here without a
 * Korean twin is a compile error rather than an English word that survives into the Korean
 * build. Values are strings, or functions when a count or a name has to go inside one.
 *
 * What belongs here: nav, tabs, filters, headings, chart titles and legends, empty states,
 * errors, tooltips, aria-labels, feed verbs, relative times. What never belongs here:
 * anything an agent wrote — record titles, What/Why/How bodies, agent handles, tags, ids.
 * The renderer keeps the author's sentence (P6); this file only translates the frame
 * around it.
 *
 * The vocabulary rules of lib/words.ts still hold, in both languages: one word per state,
 * one noun per object, and a subset carries its denominator. words.ts now reads its words
 * from here, so the two files cannot drift apart.
 */

export const en = {
  /* -- the app, the shell ---------------------------------------------------- */

  "app.name": "AgentMonitoring",
  "app.mainNav": "Main",
  "app.loading": "Loading",
  "app.loadingShort": "loading…",
  "app.retry": "Try again",
  "app.dismiss": "Dismiss",
  "app.cancel": "Cancel",
  "app.undo": "Undo",
  "app.copy": "Copy",
  "app.copied": "Copied",
  "app.selectIt": "Select it",
  "app.copyToClipboard": "Copy to clipboard",
  "app.notFound.title": "Nothing here",
  "app.notFound.sub": "That address does not match a screen in this app.",

  "shell.trouble.headline": "Not reading the vault right now.",
  "shell.trouble.body": (path: string | null, when: string) =>
    `Everything below is the last good data${path ? ` from ${path}` : ""}, as of ${when}.`,

  /* -- language ------------------------------------------------------------- */

  "locale.label": "Language",
  "locale.ko": "한국어",
  "locale.en": "English",
  "locale.switchTo": (language: string) => `Show this app in ${language}`,

  /* -- sidebar -------------------------------------------------------------- */

  "nav.project": "Project",
  "nav.vault": "Vault",
  "nav.dashboard": "Dashboard",
  "nav.work": "Work",
  "nav.bugs": "Bugs",
  "nav.projects": "Projects",
  "nav.search": "Search",
  "nav.searchTip": "Search (Ctrl+K)",
  "nav.allProjects": "All projects",
  "nav.noWorkYet": "no work logs yet",
  "nav.manageProjects": "Manage projects…",
  "nav.activeProjects": (n: number) => `${n} active projects`,
  "nav.moreOnProjects": (n: number) => `${n} more on Projects…`,
  "nav.moreTip": (n: number) =>
    `This vault has ${n} projects. See them all on the Projects screen.`,
  "nav.archivedFlag": " archived",

  "vault.none": "no vault open",
  "vault.unreadable": "could not be read — open one",
  "vault.resolving": "resolving…",
  "vault.readerDesktop": "desktop app",
  "vault.readerBrowser": "dev server",

  /* -- the two menus (right button) ----------------------------------------- */

  "menu.open": "Open",
  "menu.copyId": "Copy id",
  "menu.copyTitle": "Copy title",
  "menu.copyLink": "Copy link",
  "menu.copySlug": "Copy slug",
  "menu.archive": "Archive",
  "menu.unarchive": "Unarchive",
  "menu.archiveHint": "records are kept",
  "menu.unarchiveHint": "back in the switcher",
  "menu.openHint": "Dashboard",
  "menu.selection": "Selection",
  "menu.theTitle": "the title",
  "menu.copiedSelection": "Copied the selection",
  "menu.copyFailed": "Could not reach the clipboard — select the text and copy it.",
  "menu.copiedWhat": (what: string) => `Copied ${what}`,
  "menu.archivedToast": (name: string) => `${name} is archived. Nothing was deleted.`,
  "menu.restoredToast": (name: string) => `${name} is back in the switcher.`,

  /* -- command palette ------------------------------------------------------ */

  "palette.title": "Command palette",
  "palette.placeholder": "Work log or bug id, a title, a project, a screen…",
  "palette.inputLabel": "Search work logs, bugs, projects and screens",
  "palette.results": "Results",
  "palette.groupRecords": "Work logs & bugs",
  "palette.groupProjects": "Projects",
  "palette.groupGoTo": "Go to",
  "palette.noMatch": (query: string) => `Nothing matches “${query}”.`,
  "palette.searching": (records: number, projects: number) =>
    `Searching ${records} work logs and bugs across ${projects === 1 ? "1 project" : `${projects} projects`} by id (WORK-12) and by title.`,
  "palette.nothingLoaded":
    "Nothing is loaded yet — this vault has no work logs or bugs, or they could not be read.",
  "palette.move": "move",
  "palette.open": "open",
  "palette.close": "close",
  "palette.kindWork": "work",
  "palette.kindBug": "bug",
  "palette.metaProject": "project",
  "palette.metaAgent": "agent",
  "palette.metaSeverity": "severity",
  "palette.metaState": "status",

  /* -- list keyboard legend -------------------------------------------------- */

  "keys.move": "move",
  "keys.open": "open",
  "keys.search": "search",

  /* -- filters -------------------------------------------------------------- */

  "filter.byStatus": "Filter by status",
  "filter.byAgent": "Filter by agent",
  "filter.byTag": "Filter by tag",
  "filter.bySeverity": "Filter by severity",
  "filter.byLabel": "Filter by label",
  "filter.byAssignee": "Filter by assignee",
  "filter.byReporter": "Filter by reporter",
  "filter.allAgents": "All agents",
  "filter.allTags": "All tags",
  "filter.allSeverities": "All severities",
  "filter.allLabels": "All labels",
  "filter.allAssignees": "All assignees",
  "filter.allReporters": "All reporters",
  "filter.all": "All",
  "filter.clearAll": "Clear all",
  "filter.clear": "Clear filters",
  "filter.matches": (n: number) => (n === 1 ? "1 match" : `${n} matches`),
  "filter.chipStatus": (value: string) => `Status: ${value}`,
  "filter.chipAgent": (value: string) => `Agent: ${value}`,
  "filter.chipTag": (value: string) => `Tag: ${value}`,
  "filter.chipSeverity": (value: string) => `Severity: ${value}`,
  "filter.chipLabel": (value: string) => `Label: ${value}`,
  "filter.chipAssignee": (value: string) => `Assignee: ${value}`,
  "filter.chipReporter": (value: string) => `Reporter: ${value}`,
  "filter.chipQuery": (value: string) => `“${value}”`,

  /* -- work list ------------------------------------------------------------ */

  "work.title": "Work",
  "work.sub":
    "What every agent did, why they did it, and how it went — one work log per unit of work.",
  "work.searchPlaceholder": "Search work",
  "work.searchLabel": "Search work logs",
  "work.sortNote": "Sorted by most recent activity within each group.",
  "work.empty.title": "No work recorded yet",
  "work.empty.hint": "Agents start a work log before they touch code, so the reasoning is written down while it is still true:",
  "work.emptyFiltered.title": "No work matches these filters",
  "work.emptyFiltered.hint": (total: number) =>
    `${total === 1 ? "1 work log" : `${total} work logs`} in this project, none of them matching all of the filters above.`,

  /* -- bug board ------------------------------------------------------------ */

  "bugs.title": "Bugs",
  "bugs.sub": "Every defect an agent found, who owns it now, and how each one was resolved.",
  "bugs.searchPlaceholder": "Search bugs",
  "bugs.searchLabel": "Search bugs",
  "bugs.unresolvedMeansTip": (label: string, means: string) => `${label} means ${means}`,
  "bugs.noneUnresolved": (unresolved: string) => `none ${unresolved}`,
  "bugs.tabUnresolvedTip": (means: string) => `Bugs that are ${means}`,
  "bugs.tabResolvedTip": "Bugs that are resolved or closed",
  "bugs.tabAllTip": "Every bug ever filed in this project",
  "bugs.severityBreakdown": "Severity breakdown",
  "bugs.severityChipTip": (count: number, severity: string) =>
    `${count} ${severity.toLowerCase()}-severity ${count === 1 ? "bug" : "bugs"} in this tab`,
  "bugs.rowTimeUnresolved": (filed: string, last: string) =>
    `Filed ${filed} · last activity ${last}`,
  "bugs.rowTimeSettled": (resolved: string, filed: string) =>
    `Resolved ${resolved} · filed ${filed}`,
  "bugs.groupNoteUnresolved": "severity, then newest",
  "bugs.groupNoteSettled": "newest first",
  "bugs.sortMixed":
    "Unresolved bugs sort by severity, then by when they were filed; the rest by when they were resolved.",
  "bugs.sortUnresolved": "Sorted by severity, then by how recently they were filed.",
  "bugs.sortSettled": "Sorted by when they were resolved, newest first.",
  "bugs.empty.title": "No bugs filed",
  "bugs.empty.hint":
    "Agents file a bug the moment they find one, with the repro in the body so the next agent can reproduce it without asking:",
  "bugs.emptyUnresolved.title": "Nothing unresolved",
  "bugs.emptyUnresolved.hint": (resolved: number) =>
    `Every one of the ${resolved === 1 ? "1 bug" : `${resolved} bugs`} filed in this project has been resolved, and each one carries the written fix.`,
  "bugs.emptyUnresolved.action": "Read the resolved ones",
  "bugs.emptyResolved.title": "Nothing resolved yet",
  "bugs.emptyResolved.hint": (unresolved: number) =>
    `${unresolved === 1 ? "1 bug" : `${unresolved} bugs`} unresolved in this project. A bug leaves this tab when an agent writes the fix into it with \`agentmon bug resolve\`.`,
  "bugs.emptyResolved.action": "Show the unresolved ones",
  "bugs.emptyFiltered.title": "No bugs match these filters",
  "bugs.emptyFiltered.hint": (total: number) =>
    `${total === 1 ? "1 bug" : `${total} bugs`} in this project, none of them matching all of the filters above.`,

  /* -- record detail, shared -------------------------------------------------- */

  "rec.onThisPage": "On this page",
  "rec.related": "Related",
  "rec.references": "References",
  "rec.referencedBy": "Referenced by",
  "rec.referencesHint": (noun: string) => `written into this ${noun}’s refs`,
  "rec.referencedByHint": (id: string) => `work logs and bugs that point back at ${id}`,
  "rec.missingRef": "no work log or bug with this id in this project",
  /* The same fact on the chip inside a sentence, where the id has to be named because the
     tooltip is all the reader can see. Assembled here, not at the call site: the id leads in
     English and can lead in Korean too, but only the dictionary gets to decide that. */
  "rec.missingRefTip": (id: string) => `${id} — no work log or bug with this id in this project`,
  "rec.corrections": (n: number, where: string) =>
    `**${n === 1 ? "1 correction" : `${n} corrections`}** to this record — see ${where}`,
  "ui.severityOf": (label: string) => `${label} severity`,
  "ui.handoff": (from: string, to: string) => `filed by ${from} · assigned to ${to}`,
  "ui.handoffNone": (from: string, unassigned: string) => `filed by ${from} · ${unassigned}`,
  "rec.correction": "Correction",
  "rec.inUpdates": "Updates",
  "rec.inThread": "the thread",
  "rec.staleGone": (id: string) => `${id} is no longer in this vault.`,
  "rec.staleUnread": (id: string) => `${id} could not be read again.`,
  "rec.staleBody": "Everything below is the copy that was on screen when it was last read.",
  "rec.checks": (n: number) => (n === 1 ? "1 check" : `${n} checks`),

  /* -- work detail ------------------------------------------------------------ */

  "wd.what": "What",
  "wd.why": "Why",
  "wd.how": "How",
  "wd.files": "Files",
  "wd.filesTouched": "Files touched",
  "wd.updates": "Updates",
  "wd.outcome": "Outcome",
  "wd.workLog": "Work log",
  "wd.status": "Status",
  "wd.agent": "Agent",
  "wd.started": "Started",
  "wd.finished": "Finished",
  "wd.duration": "Duration",
  "wd.lastActivity": "Last activity",
  "wd.andCounting": "and counting",
  "wd.backToList": "Back to the work list",
  "wd.workList": "Work list",
  "wd.noSection": (title: string) => `This record has no \`## ${title}\` section.`,
  "wd.bylineDone": "finished this work on",
  "wd.bylineAbandoned": "stopped this work on",
  "wd.bylineRunning": "has been working on this since",
  "wd.filesAcross": (files: number, dirs: number) =>
    `${files === 1 ? "1 file" : `${files} files`} across ${dirs === 1 ? "1 directory" : `${dirs} directories`}`,
  "wd.startedThisWork": (agent: string) => `${agent} started this work`,
  "wd.noNotes": "No progress notes yet. Agents add them with",
  "wd.postedUpdate": (n: number) => `posted update ${n}`,
  "wd.endDone": "Marked done",
  "wd.endAbandoned": "Abandoned",
  "wd.endRunning": "Still in progress",
  "wd.inTotal": (duration: string) => `${duration} in total`,
  "wd.soFar": (duration: string) => `${duration} so far`,
  "wd.shipped": "shipped",
  "wd.recorded": "recorded",
  "wd.insideOutcome": "Inside this outcome",
  "wd.doneCount": "Work logs this agent marked done",

  /* -- bug detail ------------------------------------------------------------- */

  "bd.report": "Report",
  "bd.thread": "Thread",
  "bd.resolution": "Resolution",
  "bd.bug": "Bug",
  "bd.severity": "Severity",
  "bd.status": "Status",
  "bd.reporter": "Reporter",
  "bd.assignee": "Assignee",
  "bd.participants": "Participants",
  "bd.lastWord": "Last word",
  "bd.filed": "Filed",
  "bd.age": "Age",
  "bd.lastActivity": "Last activity",
  "bd.andCounting": "and counting",
  "bd.noReplies": "no replies yet",
  "bd.backToBoard": "Back to the bug board",
  "bd.bugBoard": "Bug board",
  "bd.noReportSection": "This bug has no `## Report` section.",
  "bd.reportBy": (agent: string, when: string) => `by ${agent}, ${when}`,
  "bd.bylineFiled": "filed this bug on",
  "bd.bylineResolvedInPre": "resolved in ",
  "bd.bylineOpenForPre": "open for ",
  "bd.statusHistory": "Status history",
  "bd.stepFiled": "Filed",
  "bd.stepClaimed": "Claimed",
  "bd.stepResolved": "Resolved",
  "bd.stepClosed": "Closed",
  "bd.stepUnresolved": "Unresolved",
  "bd.waiting": (duration: string) => `${duration} waiting`,
  "bd.soFar": (duration: string) => `${duration} so far`,
  "bd.notYet": "not yet",
  "bd.anAgent": "an agent",
  "bd.someAgent": "An agent",
  "bd.filedThisBug": (agent: string) => `${agent} filed this bug`,
  "bd.noAnswers": "Nobody has answered yet. Agents reply with",
  "bd.claimedThisBug": "claimed this bug",
  "bd.afterFiled": (duration: string) => `${duration} after it was filed`,
  "bd.endResolved": (agent: string) => `${agent} resolved this bug`,
  "bd.endClosed": "Closed",
  "bd.endWorking": (agent: string) => `${agent} is working on it`,
  "bd.endWaiting": "Waiting for someone to claim it",
  "bd.fixBelow": "the fix is recorded below",
  "bd.openFor": (duration: string) => `open for ${duration}`,
  "bd.addedToReport": "added to the report",
  "bd.repliedAsAssignee": "replied as assignee",
  "bd.commented": "commented",
  "bd.comments": (n: number) => (n === 1 ? "1 comment" : `${n} comments`),
  "bd.closedNoFix.title": "Closed without a resolution",
  "bd.closedNoFix.text":
    "This bug was closed but no fix was written into it, so the record does not say what happened. That is a gap in the record, not in the reader.",
  "bd.resolvedOn": "resolved",
  "bd.afterItWasFiled": (duration: string) => `${duration} after it was filed`,
  "bd.insideResolution": "Inside this resolution",
  "bd.unknownAgent": "unknown",

  /* -- projects --------------------------------------------------------------- */

  "proj.title": "Projects",
  "proj.sub":
    "Everything in one vault directory of plain files — copy it to another machine and the history comes with it.",
  "proj.new": "New project",
  "proj.newTitle": "New project",
  "proj.create": "Create project",
  "proj.creating": "Creating…",
  "proj.active": "Active",
  "proj.archived": "Archived",
  "proj.archivedPill": "archived",
  "proj.show": "Show",
  "proj.hide": "Hide",
  "proj.count": (n: number) => (n === 1 ? "1 project" : `${n} projects`),
  "proj.allArchived": "Every project in this vault is archived. Bring one back below, or start a new one.",
  "proj.archive": "Archive",
  "proj.archiving": "Archiving…",
  "proj.unarchive": "Unarchive",
  "proj.restoring": "Restoring…",
  "proj.archiveTip":
    "Hide this project from the switcher and the default list. Nothing is deleted, and the next line offers Undo.",
  "proj.undoBar": (name: string) =>
    `${name} is archived. Nothing was deleted — its work logs, bugs and events are still in the vault, and the project is still readable.`,
  "proj.noDescription": "No description yet.",
  "proj.workLogs": "Work logs",
  "proj.unresolvedBugs": "Unresolved bugs",
  "proj.events": "Events",
  "proj.eventsNote": "recorded",
  "proj.noneYet": "none yet",
  "proj.noneFiled": "none filed",
  "proj.ofFiled": (total: number) => `of ${total} filed`,
  "proj.workNote": (done: number, inProgress: number, doneWord: string, inProgressWord: string) =>
    `${done} ${doneWord} · ${inProgress} ${inProgressWord}`,
  "proj.lastActivity": "Last activity ",
  "proj.startedOn": (date: string) => `started ${date}`,
  "proj.noActivity": "No activity yet",
  "proj.createdOn": (date: string) => `created ${date}`,
  "proj.dotArchived": "archived project",
  "proj.dotLive": "something recorded in the last two hours",
  "proj.dotQuiet": "quiet project",
  "proj.dotStale": "stale project",
  "proj.nothingRecordedYet": "Nothing recorded yet",
  "proj.acrossVault": "Across the vault",
  "proj.newest": (n: number) => `newest ${n}`,
  "proj.recent": "recent",
  "proj.vaultEmptyFeed": "Nothing has been recorded in this vault yet. The first",
  "proj.vaultEmptyFeedTail": "shows up here.",

  "proj.form.name": "Name",
  "proj.form.namePlaceholder": "Checkout rewrite",
  "proj.form.slug": "Slug",
  "proj.form.slugPlaceholder": "checkout-rewrite",
  "proj.form.slugTaken": "A project with this slug already exists in the vault.",
  "proj.form.slugBad": "Lowercase letters, digits, - or _ only.",
  "proj.form.slugHint": "The directory name under projects/. Immutable once created.",
  "proj.form.description": "Description",
  "proj.form.descriptionPlaceholder":
    "One or two sentences a reader who has never seen this project can start from.",
  "proj.form.tags": "Tags",
  "proj.form.tagsPlaceholder": "frontend, payments",
  "proj.form.writes": (slug: string) => `Writes projects/${slug}/project.json and its first event, exactly as`,
  "proj.form.writesTail": "would.",

  /* -- the vault bar and onboarding -------------------------------------------- */

  "vault.bar": "Vault",
  "vault.label": "Vault",
  "vault.activeProjects": "Active projects",
  "vault.archivedAside": (n: number) => ` · ${n} archived`,
  "vault.schema": "Schema",
  "vault.created": "Created",
  "vault.readBy": "Read by",
  "vault.openedFrom": (source: string) => `Opened from ${source}`,
  "vault.openFolder": "Open vault folder…",
  "vault.opening": "Opening…",
  "vault.createVault": "Create a vault…",
  "vault.creating": "Creating…",
  "vault.createTip":
    "Pick a folder; the app writes vault.json and projects/ into it, exactly as `agentmon init` would.",
  "vault.noneOpenTitle": "No vault open",
  "vault.noneOpenSub": "The app reads one directory of plain files. This one could not be read.",
  "vault.readFailed": "Could not read the vault",
  "vault.notInThisVault": "Not in this vault",
  "vault.noProject": (slug: string) => `This vault has no project called “${slug}”`,
  "vault.noRecord": (id: string) => `This project has no ${id}`,
  /** An address that could not name a record whatever the vault held: `/work/NOTANID`. */
  "vault.badAddress": "That address is not a record",
  "vault.source.query": "?vault= in this window's address",
  "vault.source.env": "the AGENTMON_VAULT environment variable",
  "vault.source.flag": "the folder opened in this app",
  "vault.source.cwdVault": "./vault in the working directory",
  "vault.source.cwd": "the working directory",
  "vault.source.exeVault": "the vault folder beside the app",

  /* -- what a failure says ------------------------------------------------------
     The headline of a failed read is one of the four `vault.*` lines above; these are
     the sentence under it — the backend's own diagnosis, which is written in whichever
     language the backend was written in and has to arrive in the reader's.
     src/lib/api.ts matches the message it was handed and calls one of these, keeping the
     paths, ids and command lines exactly as the backend wrote them. An unrecognised
     message is passed through: a true sentence in the wrong language beats a guess. */

  "err.noVaultForQuery": (dir: string, cmd: string) =>
    `The folder given as \`?vault=\` has no \`vault.json\` — \`${dir}\`. Point it at a vault folder, or make one there with \`${cmd}\``,
  "err.noVaultForEnv": (dir: string, fallback: string, cmd: string) =>
    `The folder \`AGENTMON_VAULT\` names has no \`vault.json\` — \`${dir}\`. A configured vault is the only vault this server serves, so it is not falling back to \`${fallback}\`. Restore that folder, fix the variable, or make a vault there with \`${cmd}\``,
  "err.noVaultAnywhere": (dirs: string, cmd: string) =>
    `No \`vault.json\` in ${dirs}. Set \`AGENTMON_VAULT\`, open the window with \`?vault=<dir>\`, or make a vault with \`${cmd}\``,
  /** How a list of candidate folders is joined inside the sentence above. */
  "err.orJoin": " or ",
  "err.noVaultAt": (path: string, hint: string) => `No vault here — \`${path}\`. ${hint}`,
  "err.noVaultJsonHint": (cmd: string) =>
    `That folder has no \`vault.json\`. Make one with \`${cmd}\``,
  "err.notAVault": (dir: string, cmd: string) =>
    `Not a vault folder — \`${dir}\` has no \`vault.json\`. Pick the folder that holds \`vault.json\` and \`projects/\`, or make one there with \`${cmd}\``,
  "err.folderUnreadable": (detail: string) => `That folder cannot be read: \`${detail}\``,
  /* These two carry a hint clause that only the Rust backend adds, so the join lives here,
     where both halves are on one line and a missing full stop is visible. Assembled in
     api.ts, the two clauses ran together into one sentence — on the desktop only, which is
     the half no browser gate can read. */
  "err.projectNotFound": (slug: string, vault: string, hint: string) =>
    `This vault has no project \`${slug}\` — vault: \`${vault}\`.${hint}`,
  "err.projectListHint": (cmd: string) => ` The projects it does have: \`${cmd}\``,
  "err.recordNotFound": (id: string, slug: string, hint: string) =>
    `Project \`${slug}\` has no \`${id}\`.${hint}`,
  "err.expectedFile": (path: string) => ` Expected the file \`${path}\``,
  "err.badSlug": (slug: string) =>
    `Not a usable project slug — \`${slug}\`. Lower-case letters, digits, \`-\` and \`_\` only.`,
  "err.badId": (id: string, expected: string, example: string) =>
    `Not a usable id — \`${id}\`. Expected \`${expected}\` (for example \`${example}\`).`,
  "err.noRoute": (path: string) => `The vault API has no route for \`${path}\``,
  "err.unreachable": (path: string, detail: string) =>
    `Could not reach the vault API at \`${path}\`. Is the dev server running? (\`${detail}\`)`,
  "err.httpStatus": (status: number) => `The vault API answered \`${status}\``,
  "err.stoppedAnswering": "The vault stopped answering",
  "err.desktopOnlySwitch":
    "Switching vaults is a desktop-app feature. In browser mode, open the window with `?vault=<dir>` or set `AGENTMON_VAULT` before `npm run dev`.",
  "err.desktopOnlyPicker": "The folder picker is a desktop-app feature.",
  "err.desktopOnlyCreate":
    'Making a vault from the window is a desktop-app feature. In browser mode, run: `agentmon init --vault <dir> --name "<vault name>"`',

  "onboard.titleEmpty": "This vault has no projects yet",
  "onboard.titleNone": "There is no vault here yet",
  "onboard.sub":
    "A vault is a directory of plain files: `vault.json`, then one folder per project holding its work logs, its bugs and its event log. Agents write it with the `agentmon` CLI; this app reads it.",
  "onboard.stepVault": "Make the vault",
  "onboard.stepProject": "Create a project",
  "onboard.stepWork": "Record the first piece of work",
  "onboard.noteCreateVault":
    "Or press **Create a vault…** above and pick a folder — it writes the same two things, and opens it here.",
  "onboard.noteNewProject": "Or press **New project** above — it writes the same files.",
  "onboard.noteBody":
    "The body needs `## What`, `## Why` and `## How`; the CLI prints a template if it is missing.",
  "onboard.footCli": (path: string) =>
    `The \`agentmon\` binary ships with this app, at \`${path}\` — the commands above already point at it.`,
  "onboard.footDesktop": "Already have a vault on this machine? Use **Open vault folder…** above.",
  "onboard.footBrowser":
    "Already have a vault? Point the dev server at it with `AGENTMON_VAULT`, or this window at it with `?vault=<dir>`.",
  "onboard.footHelp": (cli: string) =>
    ` The full command set is in \`${cli} --help\`, and every subcommand takes \`--help\` too.`,
  "onboard.footManual": (path: string) => ` The manual is on this machine at \`${path}\`.`,
  "vault.browserHint": "Open another vault with `?vault=<dir>`, or start the dev server with `AGENTMON_VAULT`.",

  /* -- dashboard --------------------------------------------------------------- */

  "dash.currentState": "Current state",
  "dash.timeRange": "Time range",
  "dash.range7": "7 days",
  "dash.range30": "30 days",
  "dash.rangeAll": "All time",
  "dash.live": "live",
  "dash.liveTip": "Something was recorded in the last two hours",
  "dash.archivedPill": "archived",
  "dash.archivedTip":
    "This project is archived. Nothing was deleted — restore it on the Projects screen.",
  "dash.lastActivity": (when: string) => `Last activity ${when}`,
  "dash.scope": (range: string) =>
    `The charts, the agents and the feed below cover ${range}. The strip above is always now, and every date and time on this page is UTC.`,
  "dash.rangeDays": (days: number) => `the last ${days} days`,
  "dash.rangeOneEvent": (date: string) => `the one recorded event, from ${date}`,
  "dash.rangeAllEvents": (n: number, date: string) =>
    `all ${n === 1 ? "1 recorded event" : `${n} recorded events`}, back to ${date}`,

  "dash.workingNow": "Working right now",
  "dash.workLogsHere": "work logs in this project",
  "dash.heroUnit": (total: number) =>
    `of ${total === 1 ? "1 work log" : `${total} work logs`} in progress`,
  "dash.agents": (n: number) => (n === 1 ? "1 agent" : `${n} agents`),
  "dash.took": "took",
  "dash.finishedWhen": (when: string) => `finished ${when}`,
  "dash.nothingInProgress": "Nothing is in progress — the most recent work log is above.",
  "dash.noWorkYet":
    "No work has been recorded here yet. Agents start a work log with `agentmon work start` before they touch code.",
  "dash.moreInProgress": (n: number) => `${n} more in progress`,
  "dash.noUpdates": "no updates yet",
  "dash.updatedWhen": (when: string) => `updated ${when}`,
  "dash.noUpdateIn": (duration: string) => `no update in ${duration}`,
  "dash.rowInProgress": "in progress",
  "dash.rowStartedTip": (when: string) => `Started ${when}`,
  "dash.rowStateTip": (state: string, since: string) => `${state} · ${since}`,
  "dash.latestNote": "Latest note",
  "dash.latestNoteTip": (when: string) =>
    `The opening sentence of each paragraph of the note posted ${when}`,
  "dash.waitingOn": (agent: string) => `waiting on ${agent}`,
  "dash.waitingOnTip": (agent: string, sentence: string) =>
    `${agent}'s newest note says: “${sentence}”`,

  "dash.unresolvedBugs": "Unresolved bugs",
  "dash.bugsFiledHere": "bugs filed here",
  "dash.unresolvedOfFiled": (unresolved: string, total: number) => `${unresolved} of ${total} filed`,
  "dash.sevChipTip": (count: number, unresolved: string, severity: string) =>
    `${count} ${unresolved} ${severity.toLowerCase()}-severity ${count === 1 ? "bug" : "bugs"}`,
  "dash.openFor": "open for",
  "dash.filedTip": (when: string) => `Filed ${when}`,
  "dash.lastActivityTip": (when: string) => `Last activity ${when}`,
  "dash.untouched": "untouched",
  "dash.untouchedTip":
    "Nothing has happened on this bug since it was filed: no claim, no comment",
  "dash.moreUnresolved": (n: number, unresolved: string) => `${n} more ${unresolved}`,
  "dash.triageNote": (unassigned: string) =>
    `Worst first; inside a severity, the ${unassigned} ones come first.`,
  "dash.noBugsFiled": "No bugs have been filed in this project.",
  "dash.allResolved": "Every bug ever filed here has been resolved.",
  "dash.noOwnerTip": (severity: string, duration: string) =>
    `No agent has taken this ${severity.toLowerCase()}-severity bug in ${duration}. This screen flags critical and high bugs left unassigned for more than four hours.`,
  "dash.hasOwnerTip": "No agent is assigned to this bug",

  "dash.last24h": "Last 24 hours",
  /* Annotated `: string` rather than left to inference: a conditional over two literals
     infers a union of those two literals, and Korean's one answer then does not fit the
     type. Every value in this file is a string; none of them is a constant. */
  "dash.eventsRecorded": (n: number): string => (n === 1 ? "event recorded" : "events recorded"),
  "dash.quiet": "Quiet.",
  "dash.lastThing": (when: string) => `The last thing recorded here was ${when}.`,
  "dash.neverAnything": "Nothing has ever been recorded here.",
  "dash.quietFor": (duration: string) => `quiet for ${duration}`,
  "dash.countPart": (count: number, label: string) => `${count} ${label}`,
  "dash.hoursLabel": (counts: string) =>
    `Events per hour over the last 24 hours, oldest first: ${counts}`,

  "dash.chartWork": "Work",
  "dash.chartBugs": "Bugs",
  "dash.chartWorkSub": (change: string) => `Started against done, running total${change}`,
  "dash.chartBugsSub": (change: string) => `Filed against resolved, running total${change}`,
  "dash.changeOver": (range: string) => `, with the change over ${range}`,
  "dash.allWork": "All work",
  "dash.bugBoard": "Bug board",
  "dash.chartWorkEmpty": "No work logs yet",
  "dash.chartWorkEmptyHint": (slug: string) =>
    `This chart draws itself the moment an agent runs \`agentmon work start -p ${slug}\`.`,
  "dash.chartBugsEmpty": "No bugs filed yet",
  "dash.chartBugsEmptyHint": "Nothing to plot, which on this chart is the good state.",
  "dash.seriesStarted": "started",
  "dash.seriesFiled": "filed",
  "dash.nounWorkLogs": "work logs",
  "dash.nounBugs": "bugs",

  "dash.agentsCard": "Agents",
  "dash.agentsEmpty": "No agent has recorded anything in this range",
  "dash.agentsEmptyHint":
    "Widen the range above, or check the vault: every CLI mutation appends one line to events.jsonl.",
  "dash.colAgent": "Agent",
  "dash.colActivity": "Activity",
  "dash.colDone": "Done",
  "dash.colFiled": "Filed",
  "dash.colResolved": "Resolved",
  "dash.colLastSeen": "Last seen",
  "dash.colFiledTip": "Bugs this agent filed",
  "dash.colResolvedTip": "Bugs this agent resolved",
  "dash.legendWork": "work",
  "dash.legendBugs": "bugs",
  "dash.legendProject": "project",
  "dash.agentBarTip": (total: number, work: number, bugs: number, project: number) =>
    `${total === 1 ? "1 event" : `${total} events`} — ${work} on work, ${bugs} on bugs${project ? `, ${project} on the project` : ""}`,
  "dash.agentDotTip": (count: string, inProgress: string, seen: string) =>
    `${count} ${inProgress} · last seen ${seen}`,
  "dash.agentIdleTip": (inProgress: string, seen: string) =>
    `No work log ${inProgress} · last seen ${seen}`,
  "dash.agentIdleLabel": "No work log in progress",
  "dash.agentTableNote": (events: number) =>
    `Every one of ${events === 1 ? "1 event" : `${events} events`} in this range, counted against the agent who recorded it — project changes included.`,

  "dash.activity": "Activity",
  "dash.activityNote": (events: number, days: number) =>
    `${events === 1 ? "1 event" : `${events} events`} · ${days === 1 ? "1 day" : `${days} days`} · UTC`,
  "dash.expandAll": "Expand all",
  "dash.collapseAll": "Collapse all",
  "dash.activityEmpty": "Nothing recorded in this range",
  "dash.activityEmptyHint":
    "Every CLI mutation appends one line to events.jsonl; widen the range above to see older ones.",
  "dash.dayMix": (events: number, parts: string) =>
    `${events === 1 ? "1 event" : `${events} events`} — ${parts}`,
  "dash.showOther": (n: number, day: string) => `Show the other ${n} from ${day.toLowerCase()}`,
  "dash.today": "Today",
  "dash.yesterday": "Yesterday",

  /* -- charts ------------------------------------------------------------------ */

  "chart.now": "now",
  /* The busiest hour's count is a figure in its own type, so the sentence is split around
     it — which is also what lets the number sit where each language wants it. */
  "chart.busiestHourPre": "",
  "chart.busiestHour": (max: number) =>
    ` ${max === 1 ? "event" : "events"} in the busiest hour · times UTC`,
  "chart.hourTip": (hour: string, count: number) =>
    `${hour} UTC — ${count} event${count === 1 ? "" : "s"}`,
  "chart.bucketHours": (day: string, from: string, to: string) => `${day}, ${from} – ${to}`,
  "chart.summary": (
    upperLabel: string,
    upper: number,
    lowerLabel: string,
    lower: number,
    noun: string,
    periods: number,
    from: string,
    to: string
  ) =>
    `${upperLabel} ${upper}, ${lowerLabel} ${lower} ${noun} over ${periods} periods from ${from} to ${to}, UTC. `,
  "chart.summaryDelta": (range: string, upper: string, upperLabel: string, lower: string, lowerLabel: string) =>
    `Over ${range}: ${upper} ${upperLabel}, ${lower} ${lowerLabel}. `,
  "chart.summaryKeys": "Use the left and right arrow keys to read each period.",
  "chart.reading": (when: string, upper: number, upperLabel: string, lower: number, lowerLabel: string, gap: number, gapLabel: string) =>
    `${when}: ${upper} ${upperLabel}, ${lower} ${lowerLabel}, ${gap} ${gapLabel}.`,
  "chart.deltaTip": (delta: string, label: string, range: string) =>
    `${delta} ${label} over ${range}`,

  /* -- the vocabulary (lib/words.ts) -------------------------------------------- */

  "word.workNoun": "work log",
  "word.bugNoun": "bug",
  "word.workLogs": (n: number) => (n === 1 ? "1 work log" : `${n} work logs`),
  "word.bugs": (n: number) => (n === 1 ? "1 bug" : `${n} bugs`),
  "word.events": (n: number) => (n === 1 ? "1 event" : `${n} events`),

  "word.work.in_progress": "In progress",
  "word.work.done": "Done",
  "word.work.abandoned": "Abandoned",
  "word.bug.open": "Open",
  "word.bug.in_progress": "In progress",
  "word.bug.resolved": "Resolved",
  "word.bug.closed": "Closed",
  "word.sev.critical": "Critical",
  "word.sev.high": "High",
  "word.sev.medium": "Medium",
  "word.sev.low": "Low",

  /* The short form the bug board falls back to when a row runs out of width — a dictionary
     entry per language, never the first character of the word above.
     C/H/M/L is a real initialism: four letters an English reader expands without being
     told, in a column that must never be colour alone. A language with no such form leaves
     these empty and keeps its word; ko.ts does, and says why. */
  "word.sevAbbr.critical": "C",
  "word.sevAbbr.high": "H",
  "word.sevAbbr.medium": "M",
  "word.sevAbbr.low": "L",

  "word.inProgress": "in progress",
  "word.done": "done",
  "word.abandoned": "abandoned",
  "word.open": "open",
  "word.resolved": "resolved",
  "word.closed": "closed",
  "word.unresolved": "unresolved",
  "word.unresolvedLabel": "Unresolved",
  "word.unresolvedMeans": "open or in progress",
  "word.unassigned": "unassigned",
  "word.unassignedLabel": "Unassigned",
  "word.unassignedFor": (duration: string) => `unassigned for ${duration}`,
  "word.timeToResolve": "Time to resolve",

  "word.inProgressOf": (n: number, total: number) => `${n} of ${total} in progress`,
  "word.workLogsInProgressOf": (n: number, total: number) =>
    `${n} of ${total === 1 ? "1 work log" : `${total} work logs`} in progress`,
  "word.unresolvedOf": (n: number, total: number) => `${n} of ${total} unresolved`,
  "word.unresolvedCount": (n: number) => `${n} unresolved`,
  /** The work twin of it: "2 in progress", for a header whose total is beside it. */
  "word.inProgressCount": (n: number) => `${n} in progress`,
  "word.workTip": (total: number, inProgress: number, where: string | null) =>
    `${total === 1 ? "1 work log" : `${total} work logs`} ${where ? `in ${where}` : "in this project"}, ${inProgress} in progress`,
  "word.workTipHere": (total: number, inProgress: number) =>
    `${total === 1 ? "1 work log" : `${total} work logs`} here, ${inProgress} in progress`,
  "word.bugTip": (unresolved: number, total: number, where: string | null) =>
    `${unresolved} of ${total === 1 ? "1 bug" : `${total} bugs`}${where ? ` filed in ${where}` : ""} unresolved — open or in progress`,
  "word.bugTipHere": (unresolved: number, total: number) =>
    `${unresolved} of ${total === 1 ? "1 bug" : `${total} bugs`} filed here unresolved — open or in progress`,
  "word.doneOrAbandoned": "done or abandoned",
  "word.resolvedOrClosed": "resolved or closed",

  /* -- feed verbs ---------------------------------------------------------------- */

  "verb.work_started": "started",
  "verb.work_updated": "posted an update on",
  "verb.work_done": "finished",
  "verb.work_abandoned": "abandoned",
  "verb.bug_created": "filed",
  "verb.bug_claimed": "claimed",
  "verb.bug_commented": "commented on",
  "verb.bug_resolved": "resolved",
  "verb.bug_closed": "closed",
  "verb.project_created": "created this project",
  "verb.project_updated": "updated the project",

  /* What a day's traffic is called when it is summarised in one line. */
  "recent.started": "started",
  "recent.notes": "notes",
  "recent.done": "done",
  "recent.abandoned": "abandoned",
  "recent.filed": "filed",
  "recent.claimed": "claimed",
  "recent.resolved": "resolved",
  "recent.closed": "closed",
  "recent.project": "project",
  "recent.other": "other",

  /* Tones: the key to the day strip in the activity feed. */
  "tone.work": "work",
  "tone.done": "done",
  "tone.bug": "bugs",
  "tone.resolved": "resolved",
  "tone.neutral": "project",

  /* -- time ------------------------------------------------------------------------ */

  "time.justNow": "just now",
  "time.ago": (value: string) => `${value} ago`,
  "time.in": (value: string) => `in ${value}`,
  "time.minutes": (n: number) => `${n}m`,
  "time.hours": (n: number) => `${n}h`,
  "time.days": (n: number) => `${n}d`,
  "time.weeks": (n: number) => `${n}w`,
  "time.months": (n: number) => `${n}mo`,
  "time.years": (n: number) => `${n}y`,
  "time.durMinutes": (n: number) => `${n}m`,
  "time.durHours": (n: number) => `${n}h`,
  "time.durHoursMinutes": (h: number, m: number) => `${h}h ${m}m`,
  "time.durDays": (n: number) => `${n}d`,
  "time.durDaysHours": (d: number, h: number) => `${d}d ${h}h`,
  "time.empty": "—",
};

export type Dict = typeof en;
export type Key = keyof Dict;
