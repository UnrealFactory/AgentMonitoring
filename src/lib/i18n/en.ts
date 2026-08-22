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
  "app.copy": "Copy",
  "app.copied": "Copied",
  "app.selectIt": "Select it",
  "app.copyToClipboard": "Copy to clipboard",
  "app.notFound.title": "Nothing here",
  "app.notFound.sub": "That address does not match a screen in this app.",

  /* -- the window's own title bar (desktop only) ----------------------------
     Four words the app never printed before: the native bar drew these buttons itself, in
     whatever language Windows was in. It is our strip now, so they are our words, in the
     language the rest of the window is in (components/Titlebar.tsx). */

  "window.minimize": "Minimize",
  "window.maximize": "Maximize",
  "window.restore": "Restore down",
  "window.close": "Close",
  "window.closeToTray": "Close — keeps running in the tray",

  /* -- mouse gestures (desktop) ----------------------------------------------
     The words in the bubble while a right-drag is being drawn: each one names what
     letting go right now will do, so an unfamiliar stroke can be checked before it is
     committed (components/MouseGestures.tsx). */

  "gesture.scrollTop": "Scroll to top",
  "gesture.scrollBottom": "Scroll to bottom",
  "gesture.back": "Back",
  "gesture.forward": "Forward",
  "gesture.refresh": "Reload the records",
  "gesture.maximize": "Maximize window",
  "gesture.restore": "Restore size",
  "gesture.close": "Close window",

  "shell.trouble.headline": "Not reading the records right now.",
  "shell.trouble.body": (path: string | null, when: string) =>
    `Everything below is the last good data${path ? ` from ${path}` : ""}, as of ${when}.`,

  /* -- language ------------------------------------------------------------- */

  "locale.label": "Language",
  "locale.ko": "한국어",
  "locale.en": "English",
  "locale.switchTo": (language: string) => `Show this app in ${language}`,

  /* -- sidebar -------------------------------------------------------------- */

  "nav.project": "Project",
  "nav.vault": "On this machine",
  "nav.dashboard": "Dashboard",
  "nav.work": "Work",
  "nav.bugs": "Bugs",
  "nav.notes": "Notes",
  "nav.projects": "Projects",
  "nav.search": "Search",
  "nav.searchTip": "Search (Ctrl+K)",
  "nav.allProjects": "All projects",
  "nav.noWorkYet": "no work logs yet",
  "nav.manageProjects": "Manage projects…",
  "nav.projectCount": (n: number) => `${n} projects on this machine`,
  "nav.moreOnProjects": (n: number) => `${n} more on Projects…`,
  "nav.moreTip": (n: number) =>
    `${n} projects are registered on this machine. See them all on the Projects screen.`,
  "nav.appFeedback": "App feedback",
  "nav.appFeedbackTip": (n: number) =>
    `${n} open feedback item${n === 1 ? "" : "s"} about this app`,

  /* -- app feedback board -------------------------------------------------------- */

  "fb.title": "App feedback",
  "fb.sub":
    "Bugs and wishes agents filed about this app itself — AgentMonitoring, not the project they were working in.",
  "fb.count": (total: number, open: number) =>
    open > 0
      ? `${total} item${total === 1 ? "" : "s"} · ${open} open`
      : `${total} item${total === 1 ? "" : "s"}`,
  "fb.kindBug": "Bug",
  "fb.kindIdea": "Idea",
  "fb.markDone": "Mark done",
  "fb.reopen": "Reopen",
  "fb.doneOn": (when: string) => `handled ${when}`,
  "fb.delete": "Delete",
  "fb.deleteArmed": "Really delete?",
  "fb.deleteTip": "Only done items can be deleted — it disappears from the board for good.",
  "fb.emptyTitle": "No feedback yet",
  "fb.emptyHint":
    "Items appear when an agent files one with the `app_feedback` MCP tool (CLI: `agentmon app-feedback`).",
  "fb.noMatch": "Nothing matches this filter",

  "vault.readerDesktop": "desktop app",
  "vault.readerBrowser": "dev server",

  /* -- the app's own update card (desktop only, src/components/AppUpdate.tsx) - */

  "update.title": "New version available",
  "update.later": "Later",
  "update.go": "Update",
  "update.applying": "The install window is opening — this app closes in a moment and reopens once it's done.",
  "update.failed": "The update could not start",

  /* -- the two menus (right button) ----------------------------------------- */

  "menu.open": "Open",
  "menu.copyId": "Copy id",
  "menu.copyTitle": "Copy title",
  "menu.copyLink": "Copy link",
  "menu.copyPath": "Copy folder path",
  /* The only item in the app that destroys anything. Its hint is not a category ("danger")
     but the consequence, in the words the dialog behind it repeats. */
  "menu.delete": "Delete",
  "menu.deleteHint": "permanent — cannot be undone",
  "menu.openHint": "Dashboard",
  "menu.selection": "Selection",
  "menu.theTitle": "the title",
  "menu.copiedSelection": "Copied the selection",
  "menu.copyFailed": "Could not reach the clipboard — select the text and copy it.",
  "menu.copiedWhat": (what: string) => `Copied ${what}`,
  /* The New-project options, reachable after creation — the template and the server path
     move with the app. The writes are core's conservative ones, so pressing twice is
     safe; the toast says what actually happened. */
  "menu.claudeMd": "Write CLAUDE.md instructions",
  "menu.claudeMdHint": "creates, or appends to yours",
  "menu.mcpJson": "Register MCP in .mcp.json",
  "menu.mcpJsonHint": "touches only the agentmon entry",
  "menu.scaffoldCreated": (file: string) => `Wrote ${file}`,
  "menu.scaffoldAppended": (file: string) => `Appended the instructions to ${file}`,
  "menu.scaffoldUpdated": (file: string) => `Updated the agentmon entry in ${file}`,
  "menu.scaffoldPresent": (file: string) => `${file} is already up to date`,

  /* -- deleting a project (components/DeleteProject.tsx) ---------------------- */

  "del.title": "Delete project",
  "del.contains": "This project holds",
  "del.warn": (path: string) =>
    `This permanently removes the folder \`${path}\` and every record in it from the disk. The code around it is not touched. It does not go to the recycle bin, and there is no undo.`,
  "del.warnRefs":
    "Records in other projects are not touched. Links that pointed into this one become addresses this app no longer has, and it answers them with the screen that says so.",
  "del.confirmLabel": "Type the project name to confirm",
  "del.confirmHint": (name: string) => `Must match exactly: ${name}`,
  "del.confirm": "Delete project",
  "del.deleting": "Deleting…",
  "del.doneToast": (name: string) => `Deleted ${name}.`,

  /* -- command palette ------------------------------------------------------ */

  "palette.title": "Command palette",
  "palette.placeholder": "A record id or note name, a title, a project, a screen…",
  "palette.inputLabel": "Search work logs, bugs, notes, projects and screens",
  "palette.results": "Results",
  "palette.groupRecords": "Work logs, bugs & notes",
  "palette.groupProjects": "Projects",
  "palette.groupGoTo": "Go to",
  "palette.noMatch": (query: string) => `Nothing matches “${query}”.`,
  "palette.searching": (records: number, projects: number) =>
    `Searching ${records} work logs, bugs and notes across ${projects === 1 ? "1 project" : `${projects} projects`} by id (WORK-12), by name and by title.`,
  "palette.nothingLoaded":
    "Nothing is loaded yet — no project has work logs, bugs or notes, or they could not be read.",
  "palette.move": "move",
  "palette.open": "open",
  "palette.close": "close",
  "palette.kindWork": "work",
  "palette.kindBug": "bug",
  "palette.kindNote": "note",
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
  "filter.byType": "Filter by type",
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
  "filter.chipType": (value: string) => `Type: ${value}`,
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

  /* -- notes list ------------------------------------------------------------
     The shared agent notes: memory, handoffs, decisions, references. A note is knowledge,
     not history — agents rewrite it in place and remove it when it stops being true, and
     the event feed keeps the trail. The list is the index an arriving agent scans. */

  "notes.title": "Notes",
  "notes.sub":
    "What the agents know and want each other to know — essential, memory, handoff, decision and reference notes, rewritten in place as the truth changes.",
  "notes.searchPlaceholder": "Search notes",
  "notes.searchLabel": "Search notes",
  "notes.sortNote": "Sorted by most recently updated — the newest handoff first.",
  "notes.tabAllTip": "Every note in this project",
  "notes.tipEssential": "Required reading before starting work — the index that points at the rest",
  "notes.tipMemory": "Durable facts and gotchas about this project",
  "notes.tipHandoff": "State left for whoever works next",
  "notes.tipDecision": "Choices made here, and the reasoning behind them",
  "notes.tipReference": "Pointers to things outside the project",
  "notes.empty.title": "No notes yet",
  "notes.empty.hint":
    "Agents leave here what they wish the previous agent had told them — a gotcha, a handoff, a decision:",
  "notes.emptyFiltered.title": "No notes match these filters",
  "notes.emptyFiltered.hint": (total: number) =>
    `${total === 1 ? "1 note" : `${total} notes`} in this project, none of them matching all of the filters above.`,

  /* -- note detail ------------------------------------------------------------ */

  "nd.note": "Note",
  "nd.type": "Type",
  "nd.agent": "Agent",
  "nd.created": "Created",
  "nd.updated": "Updated",
  "nd.lastActivity": "Last activity",
  "nd.backToList": "Back to the notes list",
  "nd.notesList": "Notes",
  "nd.bylineLeft": "left this note on",
  /* Followed by the editor's own chip: "· revised by [nova] 5m ago". The name is a chip,
     not a word in this sentence, so the label stays name-free in both languages. */
  "nd.revisedBy": "revised by",
  "nd.neverRevised": "not revised since it was written",
  "nd.body": "Body",
  /* The line under the fold that teaches the contract: a note is rewritten, not appended
     to, and the CLI is where that happens. */
  "nd.updateHint": (name: string) =>
    `A note holds what is currently true. Agents rewrite it in place with \`agentmon note update ${name}\` — and remove it with \`agentmon note remove ${name}\` when keeping it would mislead. Every change lands on the activity feed.`,

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
  "rec.referencedByHint": (id: string) => `work logs, bugs and notes that point back at ${id}`,
  "rec.missingRef": "no work log, bug or note with this id in this project",
  /* The same fact on the chip inside a sentence, where the id has to be named because the
     tooltip is all the reader can see. Assembled here, not at the call site: the id leads in
     English and can lead in Korean too, but only the dictionary gets to decide that. */
  "rec.missingRefTip": (id: string) =>
    `${id} — no work log, bug or note with this id in this project`,

  /* -- the Agent / Human toggle, and the human area under it -------------------
     Every record carries two areas (SPEC.md, "The human area"), and these are the words
     around the second one: the segments that swap them, and the box a record without a
     retelling shows instead. The retelling itself is the author's and is never touched. */

  "view.label": "Which half of this record to read",
  "view.agent": "Agent",
  "view.human": "Human",
  "view.agentTip": "The record as the agent wrote it, for agents",
  "view.humanTip": "The same events retold in plain words, for a reader who was not there",
  "view.humanNoneTip": "This record has no plain-language retelling yet",
  "view.retoldBy": (agent: string) =>
    `Retold by ${agent}, who did the work, for a reader who was not there.`,
  "view.emptyTitle": "No plain-language retelling yet",
  "view.emptyText":
    "Every record written from now on carries one: the same events told for somebody who was not there and does not program. This one is older than the rule, so it has only the agent’s half.",
  "view.emptyCommand": "An agent adds it to this record with one line:",
  "view.emptyStyle": "What to write is not guesswork — `agentmon human-style` prints the whole style contract.",
  "view.emptyBack": "Read the agent’s half",

  /* -- record bodies: the renderer's own words --------------------------------
     Callout labels for `> [!note]` etc., and the one sentence an image that will not
     load gets — a missing diagram is a mis-citation the reader deserves to see, like a
     stale record chip (lib/markdown.tsx). */

  "md.calloutNote": "Note",
  "md.calloutTip": "Tip",
  "md.calloutImportant": "Important",
  "md.calloutWarning": "Warning",
  "md.calloutCaution": "Caution",
  "md.imageFailed": "Could not load the image",
  "rec.corrections": (n: number, where: string) =>
    `**${n === 1 ? "1 correction" : `${n} corrections`}** to this record — see ${where}`,
  "ui.severityOf": (label: string) => `${label} severity`,
  "ui.handoff": (from: string, to: string) => `filed by ${from} · assigned to ${to}`,
  "ui.handoffNone": (from: string, unassigned: string) => `filed by ${from} · ${unassigned}`,
  "rec.correction": "Correction",
  "rec.inUpdates": "Updates",
  "rec.inThread": "the thread",
  "rec.staleGone": (id: string) => `${id} is no longer in this project.`,
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
  "bd.fixAbove": "the fix is recorded above",
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
    "Each project is one `AgentMonitoring` folder of plain files, living inside the repo it describes — commit it and the history travels with the code.",
  "proj.new": "New project",
  "proj.newTitle": "New project",
  "proj.create": "Create project",
  "proj.creating": "Creating…",
  "proj.inVault": "On this machine",
  "proj.count": (n: number) => (n === 1 ? "1 project" : `${n} projects`),
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
  "proj.dotLive": "something recorded in the last two hours",
  "proj.dotQuiet": "quiet project",
  "proj.dotStale": "stale project",
  "proj.nothingRecordedYet": "Nothing recorded yet",
  "proj.acrossVault": "Across all projects",
  "proj.newest": (n: number) => `newest ${n}`,
  "proj.recent": "recent",
  "proj.vaultEmptyFeed": "Nothing has been recorded in any project yet. The first",
  "proj.vaultEmptyFeedTail": "shows up here.",

  "proj.form.name": "Name",
  "proj.form.namePlaceholder": "Checkout rewrite",
  "proj.form.location": "Location",
  "proj.form.locationPlaceholder": "C:\\Code\\my-app",
  "proj.form.locationHint":
    "Typically the code repo the work happens in. The records live in an `AgentMonitoring` folder inside it — commit that folder and the history travels with the code.",
  "proj.form.browse": "Browse…",
  "proj.form.locationNeeded": "Pick where the project's records should live.",
  "proj.form.description": "Description",
  "proj.form.descriptionPlaceholder":
    "One or two sentences a reader who has never seen this project can start from.",
  "proj.form.tags": "Tags",
  "proj.form.tagsPlaceholder": "frontend, payments",
  "proj.form.claudeMd": "CLAUDE.md",
  "proj.form.claudeMdNone": "Don't add",
  "proj.form.claudeMdHint":
    "Writes a CLAUDE.md at the repo root telling coding agents to record their work here. If the file already exists, only the section is appended.",
  "proj.form.mcpJson": "MCP registration (.mcp.json)",
  "proj.form.mcpJsonOn": "Create",
  "proj.form.mcpJsonOff": "Skip",
  "proj.form.mcpAgent": "Default agent handle",
  "proj.form.mcpJsonHint":
    "Writes a .mcp.json at the repo root registering the agentmon MCP server — Claude Code reads the file on its own, so agents have the recording tools from their first session. If the file already exists, only the agentmon entry is added or replaced. The input is the default agent handle written onto records.",
  "proj.form.writes": (location: string) =>
    `Creates \`${location}\\AgentMonitoring\` with its project.json and first event, exactly as`,
  "proj.form.writesTail": "would.",

  /* -- project rows, opening and removing --------------------------------------- */

  "proj.openFolder": "Open project…",
  "proj.opening": "Opening…",
  "proj.openTip":
    "Pick a folder that holds an AgentMonitoring folder — a repo cloned from another machine, a drive you plugged back in — and it joins this list.",
  "proj.remove": "Remove from list",
  "proj.removeHint": "keeps every file — open it again any time",
  "proj.unavailable": "Unavailable",
  "proj.unavailableHint":
    "The folder cannot be read right now — a moved folder, an unplugged drive. The row stays so you can see what is missing; remove it if it is gone for good.",
  "proj.noneRegisteredTitle": "No projects on this machine yet",
  "proj.noneRegisteredSub":
    "Each project is one `AgentMonitoring` folder of plain files. Create one here, or open a folder that already has one.",
  "proj.readFailed": "Could not read the project",
  "proj.notHere": "Not in this project",
  "proj.notRegistered": (id: string) => `No project “${id}” on this machine`,
  "proj.noRecord": (id: string) => `This project has no ${id}`,
  /** An address that could not name a record whatever the folders held: `/work/NOTANID`. */
  "proj.badAddress": "That address is not a record",

  /* -- what a failure says ------------------------------------------------------
     The headline of a failed read is one of the `proj.*` lines above; these are the
     sentence under it — the backend's own diagnosis, which is written in whichever
     language the backend was written in and has to arrive in the reader's.
     src/lib/api.ts matches the message it was handed and calls one of these, keeping the
     paths, ids and command lines exactly as the backend wrote them. An unrecognised
     message is passed through: a true sentence in the wrong language beats a guess. */

  "err.noProjectAt": (path: string) =>
    `No project here — \`${path}\` has no \`AgentMonitoring/project.json\`. Pick the folder that holds the \`AgentMonitoring\` folder, or create a project there.`,
  "err.noProjectAtHint": (path: string, hint: string) => `No project here — \`${path}\`. ${hint}`,
  "err.projectNotRegistered": (id: string) =>
    `No project with id \`${id}\` is registered on this machine — it was removed from the list, or its folder is gone.`,
  "err.foldersUnreachable": (id: string, n: number, paths: string) =>
    `Cannot tell whether \`${id}\` is here — ${n} registered folder(s) cannot be read right now: \`${paths}\``,
  "err.recordNotFound": (id: string, hint: string) => `This project has no \`${id}\`.${hint}`,
  "err.expectedFile": (path: string) => ` Expected the file \`${path}\``,
  "err.badId": (id: string, expected: string, example: string) =>
    `Not a usable id — \`${id}\`. Expected \`${expected}\` (for example \`${example}\`).`,
  "err.folderUnreadable": (detail: string) => `That folder cannot be read: \`${detail}\``,
  "err.noDirsToServe": (hint: string) =>
    `The dev server has no AgentMonitoring folder to read — ${hint}`,
  "err.noRoute": (path: string) => `The project API has no route for \`${path}\``,
  "err.unreachable": (path: string, detail: string) =>
    `Could not reach the project API at \`${path}\`. Is the dev server running? (\`${detail}\`)`,
  "err.httpStatus": (status: number) => `The project API answered \`${status}\``,
  "err.desktopOnlyPicker": "The folder picker is a desktop-app feature.",
  "err.desktopOnlyOpen":
    "Opening a project folder is a desktop-app feature. In browser mode, start the dev server with `AGENTMON_DIRS=<folder;folder>` or open the window with `?dirs=`.",
  "err.desktopOnlyRemove": "The project list lives with the desktop app; browser mode serves a fixed set of folders.",

  "onboard.titleEmpty": "No work recorded yet",
  "onboard.titleNone": "No projects on this machine yet",
  "onboard.sub":
    "A project is one `AgentMonitoring` folder of plain files inside the repo it describes: its work logs, its bugs and its event log. Agents write it with the `agentmon` CLI; this app reads every folder on the list above.",
  "onboard.stepProject": "Create a project in your repo",
  "onboard.stepWork": "Record the first piece of work",
  "onboard.noteNewProject": "Or press **New project** above — it writes the same files.",
  "onboard.noteBody":
    "The body needs `## What`, `## Why` and `## How`; the CLI prints a template if it is missing.",
  "onboard.footCli": (path: string) =>
    `The \`agentmon\` binary ships with this app, at \`${path}\` — the commands above already point at it.`,
  "onboard.footDesktop":
    "Already have a project on this machine — a clone from another computer? Use **Open project…** above.",
  "onboard.footBrowser":
    "Already have a project? Point the dev server at it with `AGENTMON_DIRS=<folder>`, or this window with `?dirs=<folder>`.",
  "onboard.footHelp": (cli: string) =>
    ` The full command set is in \`${cli} --help\`, and every subcommand takes \`--help\` too.`,
  "onboard.footManual": (path: string) => ` The manual is on this machine at \`${path}\`.`,

  /* -- dashboard --------------------------------------------------------------- */

  "dash.currentState": "Current state",
  "dash.timeRange": "Time range",
  "dash.range7": "7 days",
  "dash.range30": "30 days",
  "dash.rangeAll": "All time",
  "dash.live": "live",
  "dash.liveTip": "Something was recorded in the last two hours",
  "dash.lastActivity": (when: string) => `Last activity ${when}`,
  "dash.scope": (range: string) =>
    `The charts, the agents and the feed below cover ${range}. The strip above is always now, and every date and time on this page is in this computer's timezone.`,
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
  "dash.latestNote": "Latest update",
  "dash.latestNoteTip": (when: string) =>
    `The opening sentence of each paragraph of the update posted ${when}`,
  "dash.waitingOn": (agent: string) => `waiting on ${agent}`,
  "dash.waitingOnTip": (agent: string, sentence: string) =>
    `${agent}'s newest update says: “${sentence}”`,

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
  "dash.chartWorkEmptyHint":
    "This chart draws itself the moment an agent runs `agentmon work start` in this project.",
  "dash.chartBugsEmpty": "No bugs filed yet",
  "dash.chartBugsEmptyHint": "Nothing to plot, which on this chart is the good state.",
  "dash.seriesStarted": "started",
  "dash.seriesFiled": "filed",
  "dash.nounWorkLogs": "work logs",
  "dash.nounBugs": "bugs",

  "dash.agentsCard": "Agents",
  "dash.agentsEmpty": "No agent has recorded anything in this range",
  "dash.agentsEmptyHint":
    "Widen the range above, or check the project folder: every CLI mutation appends one line to events.jsonl.",
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
  "dash.legendNotes": "notes",
  "dash.legendProject": "project",
  "dash.agentBarTip": (total: number, work: number, notes: number, bugs: number, project: number) =>
    `${total === 1 ? "1 event" : `${total} events`} — ${work} on work${notes ? `, ${notes} on notes` : ""}, ${bugs} on bugs${project ? `, ${project} on the project` : ""}`,
  "dash.agentDotTip": (count: string, inProgress: string, seen: string) =>
    `${count} ${inProgress} · last seen ${seen}`,
  "dash.agentIdleTip": (inProgress: string, seen: string) =>
    `No work log ${inProgress} · last seen ${seen}`,
  "dash.agentIdleLabel": "No work log in progress",
  "dash.agentTableNote": (events: number) =>
    `Every one of ${events === 1 ? "1 event" : `${events} events`} in this range, counted against the agent who recorded it — project changes included.`,

  "dash.activity": "Activity",
  "dash.activityNote": (events: number, days: number) =>
    `${events === 1 ? "1 event" : `${events} events`} · ${days === 1 ? "1 day" : `${days} days`}`,
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
    ` ${max === 1 ? "event" : "events"} in the busiest hour`,
  "chart.hourTip": (hour: string, count: number) =>
    `${hour} — ${count} event${count === 1 ? "" : "s"}`,
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
    `${upperLabel} ${upper}, ${lowerLabel} ${lower} ${noun} over ${periods} periods from ${from} to ${to}. `,
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
  "word.noteNoun": "note",
  "word.workLogs": (n: number) => (n === 1 ? "1 work log" : `${n} work logs`),
  "word.bugs": (n: number) => (n === 1 ? "1 bug" : `${n} bugs`),
  "word.notes": (n: number) => (n === 1 ? "1 note" : `${n} notes`),
  "word.events": (n: number) => (n === 1 ? "1 event" : `${n} events`),

  "word.work.in_progress": "In progress",
  "word.work.done": "Done",
  "word.work.abandoned": "Abandoned",
  /* What each kind of note is for — the note's first filter, one word each. */
  "word.note.essential": "Essential",
  "word.note.memory": "Memory",
  "word.note.handoff": "Handoff",
  "word.note.decision": "Decision",
  "word.note.reference": "Reference",
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
  /** The notes count's tooltip: what the number is, and what a note is. */
  "word.noteTipHere": (n: number) =>
    `${n === 1 ? "1 note" : `${n} notes`} here — knowledge the agents keep for each other: essential, memory, handoff, decision, reference`,

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
  "verb.note_created": "left a note",
  "verb.note_updated": "revised the note",
  /* The one removal verb in the feed, and it belongs to notes alone: a note is knowledge,
     and knowledge that went wrong is taken down — with this line left behind saying who
     and when. Work logs and bugs never take this verb; nothing removes them. */
  "verb.note_removed": "removed the note",
  /* A mutation that changed only the human area — the record retold for whoever is not an
     agent. It writes nothing into Updates or Comments, so the feed is where it shows. */
  "verb.human_updated": "rewrote the plain-language telling of",
  "verb.project_created": "created this project",
  "verb.project_updated": "updated the project",

  /* What a day's traffic is called when it is summarised in one line. */
  "recent.started": "started",
  "recent.notes": "updates",
  "recent.done": "done",
  "recent.abandoned": "abandoned",
  "recent.filed": "filed",
  "recent.claimed": "claimed",
  "recent.resolved": "resolved",
  "recent.closed": "closed",
  "recent.sharedNotes": "notes",
  "recent.project": "project",
  "recent.other": "other",

  /* Tones: the key to the day strip in the activity feed. */
  "tone.work": "work",
  "tone.done": "done",
  "tone.bug": "bugs",
  "tone.resolved": "resolved",
  "tone.note": "notes",
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
