//! `agentmon` — the agent-facing CLI.
//!
//! Design rules, because the reader of this file is usually about to add a command:
//!
//! * **This file is a wrapper.** Every rule about the project data (what a valid body is,
//!   which state transitions are legal, how ids are allocated) lives in `agentmon-core`.
//!   Here we parse arguments, choose an exit code, and print.
//! * **Exit codes are a contract.** Agents branch on them; see [`exit`] below and the
//!   table in docs/AGENT_MANUAL.md. Never reuse one for a new meaning.
//! * **`--json` means all output is JSON**, including errors, so a scripted caller never
//!   has to parse prose.
//! * **Every error says how to fix itself.** If a message could end with "…so run X",
//!   it must.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use agentmon_core::{
    doctor, validate, AbandonWork, CoreError, FinishWork, NewBug, NewNote, NewProject, NoteType,
    Registry, Severity, StartWork, Store, UpdateNote, UpdateProject, WorkStatus,
};
use clap::{Args, CommandFactory, Parser, Subcommand};

/// Exit codes. Stable across releases; documented in docs/AGENT_MANUAL.md.
mod exit {
    /// The project has problems (`doctor`), or the command failed for a reason with no
    /// more specific code.
    pub const PROBLEMS: u8 = 1;
    /// Bad usage: unknown flag, missing argument, unparseable value. (clap uses this too.)
    pub const USAGE: u8 = 2;
    /// The project or record does not exist.
    pub const NOT_FOUND: u8 = 3;
    /// The record body is missing required sections or says nothing.
    pub const INVALID_BODY: u8 = 4;
    /// The mutation is not legal in the record's current state (already done, already
    /// claimed, already exists), or another process holds the write lock.
    pub const CONFLICT: u8 = 5;
    /// The project is there but corrupt: unparseable frontmatter, bad project.json.
    pub const INVALID_PROJECT: u8 = 6;
    /// Filesystem failure: permissions, disk, a path that vanished mid-write.
    pub const IO: u8 = 7;
}

const ROOT_AFTER_HELP: &str = "\
EXAMPLES
  agentmon work start --agent cli-builder \\
      --title \"Wire the change watcher into the desktop app\" \\
      --human \"The app only noticed new records when you clicked something. ...\" \\
      --body \"$(cat <<'EOF'
  ## What
  ...
  ## Why
  ...
  ## How
  ...
  EOF
  )\"
  agentmon work done WORK-0003 --agent cli-builder --outcome \"...\" --human \"...\"
  agentmon bug list --status open
  agentmon note list                    # what previous agents left for you — read first
  agentmon note add --agent cli-builder --type memory \\
      --title \"...\" --description \"...\" --body \"...\" --human \"...\"
  agentmon status
  agentmon doctor
  agentmon app-feedback add --agent <you> --type idea \\
      --title \"...\" --human \"...\"       # a bug/wish about this app itself, any directory

THE HUMAN AREA (--human, on every verb above)
  Every record carries two areas: the agent area (What/Why/How, Report, the note body)
  and the human area — the same work retold for a reader who was not there and does not
  program. Creating or closing a record requires one; `--human` alone on work update /
  bug comment / note update / app-feedback update rewrites it and touches nothing else.
  agentmon human-style              # the contract, printed when you need it

ALREADY FINISHED THE WORK?
  Record it after the fact — every mutation takes the time it really happened:
  agentmon work start --agent <you> --title \"...\" --body \"...\" --human \"...\" \\
      --started-at 2026-08-18T09:12:00Z
  agentmon work done WORK-0007 --agent <you> --outcome \"...\" --human \"...\" \\
      --finished-at 2026-08-18T11:30:00Z
  Also: --created-at on `bug create`, --at on work update/abandon and bug claim/comment/resolve.

PROJECT RESOLUTION (git-style)
  --dir <folder>  >  $AGENTMON_DIR  >  the nearest AgentMonitoring/ folder, searching
  upward from the current directory. Inside a repo that has one, no flags are needed.

DEFAULTS FROM THE ENVIRONMENT
  $AGENTMON_AGENT supplies --agent.

GLOBAL FLAGS
  --dir <folder> and --json work anywhere on the line, before or after the subcommand.

EXIT CODES
  0 ok   1 project has problems   2 usage   3 not found
  4 body rejected   5 conflict   6 invalid project   7 io error

Full manual: docs/AGENT_MANUAL.md";

#[derive(Parser, Debug)]
#[command(
    name = "agentmon",
    version,
    about = "Record agent work in a plain-file AgentMonitoring folder that humans read in the app.",
    long_about = "agentmon writes work logs, bug reports and events into an `AgentMonitoring` \
folder that lives inside the project it describes — the way `.git` lives inside a repo. The \
AgentMonitoring desktop app reads every such folder the human has registered.\n\n\
Work logs answer three questions — ## What, ## Why, ## How — and gain an ## Outcome when they \
finish. Bugs carry a ## Report, a comment thread and a ## Resolution. The CLI enforces that \
shape, because a record nobody can reconstruct the work from is worse than no record.\n\n\
Notes are the third kind: shared agent knowledge (essential, memory, handoff, decision, \
reference) that can be rewritten and removed as the truth changes — `agentmon note list` is \
where a session starts, and the essential notes it surfaces first are required reading.",
    after_help = ROOT_AFTER_HELP,
    propagate_version = true,
    disable_help_subcommand = false
)]
struct Cli {
    /// Project folder: the AgentMonitoring directory, or any folder containing one.
    /// Overrides $AGENTMON_DIR and the upward search from the current directory.
    #[arg(long, global = true, value_name = "FOLDER")]
    dir: Option<PathBuf>,

    /// Print the result as JSON; on failure prints {"ok":false,"error":{...}}.
    ///
    /// Global, so `agentmon --json work list` and `agentmon work list --json` are the
    /// same command — agents write it both ways.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Create a project: an AgentMonitoring folder inside the current directory (or --dir).
    #[command(after_help = "EXAMPLES\n  agentmon init --name \"Checkout rewrite\" \\\n    \
        --description \"Replace the legacy checkout flow.\" --tags frontend,payments\n  \
        agentmon init --dir /c/Code/MyApp --name \"MyApp\"\n\n  The folder created is \
        <location>/AgentMonitoring — commit it with the repo and the history travels with \
        the code. Refuses (exit 5) if that folder already holds a project.")]
    Init {
        /// Display name shown in the app.
        #[arg(long)]
        name: String,
        /// One or two sentences shown on the projects screen.
        #[arg(long)]
        description: Option<String>,
        /// Comma-separated.
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
        /// Agent recorded as the actor of the project_created event.
        #[arg(long, env = "AGENTMON_AGENT", default_value = "agentmon")]
        agent: String,
        /// When the project was created (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
        /// Also write agent instructions to <location>/CLAUDE.md, pointing coding
        /// agents at these records. Appends if the file exists; skips if the section
        /// is already there.
        #[arg(long, value_name = "ko|en")]
        claude_md: Option<String>,
        /// Also write AGENTS.md instructions for Codex and compatible tools.
        /// Can be combined with --claude-md. Preserves existing content.
        #[arg(long, value_name = "ko|en")]
        agents_md: Option<String>,
        /// Add Claude MCP in <location>/.mcp.json. Preserves other servers.
        /// May be combined with --codex-mcp.
        #[arg(long = "claude-mcp", visible_alias = "mcp-json")]
        mcp_json: bool,
        /// Default agent handle inside that registration; any call can override it
        /// per record.
        #[arg(long, value_name = "handle", default_value = "claude", requires = "mcp_json")]
        mcp_agent: String,
        /// Add Codex MCP in <location>/.codex/config.toml. Preserves other settings.
        /// Codex loads project settings only for trusted projects.
        #[arg(long)]
        codex_mcp: bool,
        /// Default record author for the Codex MCP registration.
        #[arg(long, value_name = "handle", default_value = "codex", requires = "codex_mcp")]
        codex_agent: String,
    },
    /// View or update this project's metadata; list registered projects.
    #[command(subcommand)]
    Project(ProjectCmd),
    /// Record what you are doing, progress on it, and how it ended.
    #[command(subcommand)]
    Work(WorkCmd),
    /// File, claim, discuss and resolve bugs.
    #[command(subcommand)]
    Bug(BugCmd),
    /// Shared agent notes: essential (read first), memory, handoffs, decisions, references.
    #[command(subcommand)]
    Note(NoteCmd),
    /// Bugs and wishes about the AgentMonitoring app itself. Machine-level: works from
    /// any directory, belongs to no project, and --dir does not apply.
    #[command(subcommand)]
    AppFeedback(AppFeedbackCmd),
    /// Print the human-area style contract (docs/HUMAN_STYLE.md, embedded in this binary).
    #[command(
        name = "human-style",
        after_help = "EXAMPLES\n  agentmon human-style\n  agentmon human-style --json\n\n  \
        Every record carries a human area: the same work retold for a reader who was not \
        there and does not program (--human on the write verbs). This prints the contract \
        that text is written to. It is write-time reading — open it when you are about to \
        write one, not at the start of a session."
    )]
    HumanStyle,
    /// Snapshot of this project: active work, open bugs, recent events.
    #[command(after_help = "EXAMPLES\n  agentmon status\n  agentmon status --json")]
    Status,
    /// Validate project integrity. Exits 1 when something is wrong.
    #[command(after_help = "EXAMPLES\n  agentmon doctor\n  agentmon doctor --strict --json\n\n\
        Errors mean the app will show something wrong or untrue. Warnings mean the project is \
        readable but something is off. --strict makes warnings fail too.")]
    Doctor {
        /// Treat warnings as failures.
        #[arg(long)]
        strict: bool,
    },
    /// Repair a two-machine id collision: re-key this clone's unpushed records against
    /// an incoming copy and rewrite everything that points at them. Dry run by default.
    #[command(after_help = RECONCILE_HELP)]
    Reconcile {
        /// The incoming AgentMonitoring folder (or the directory holding one): a git
        /// worktree of the branch you are about to merge, or the other machine's clone.
        #[arg(long, value_name = "FOLDER")]
        theirs: PathBuf,
        /// Execute the plan. Without it the command prints exactly what would change
        /// and touches nothing.
        #[arg(long)]
        apply: bool,
        /// Re-key exactly these local ids (comma-separated WORK-/BUG- ids) instead of
        /// the detected set — the override for a record classified wrong.
        #[arg(long, value_delimiter = ',', value_name = "IDS")]
        only: Vec<String>,
        /// Agent recorded as the actor of the project_updated event an applied re-key logs.
        #[arg(long, env = "AGENTMON_AGENT", default_value = "agentmon")]
        agent: String,
        /// When the reconcile happened (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
        /// Do not install the `events.jsonl merge=union` rule in
        /// AgentMonitoring/.gitattributes — for a repo that manages its own attributes.
        #[arg(long)]
        no_gitattributes: bool,
    },
    /// Copy one project out of a v1 vault into <folder>/AgentMonitoring (schema v2).
    #[command(after_help = "EXAMPLE\n  agentmon migrate --from /c/old/vault \\\n    \
        --project agent-monitoring --to /c/Code/AgentMonitoring\n\n  Records, events and \
        timestamps are copied byte-for-byte; only project.json is rewritten to v2. The vault \
        is left untouched — delete it yourself once `agentmon doctor` passes on the new \
        folder. Refuses (exit 5) if the target already holds a project.")]
    Migrate {
        /// The v1 vault directory (the folder holding vault.json).
        #[arg(long, value_name = "VAULT")]
        from: PathBuf,
        /// The project slug inside the vault (its folder name under projects/).
        #[arg(long, value_name = "SLUG")]
        project: String,
        /// Where the AgentMonitoring folder goes (typically the code repo root).
        #[arg(long, value_name = "FOLDER")]
        to: PathBuf,
    },
}

#[derive(Subcommand, Debug)]
enum ProjectCmd {
    /// Show this project's metadata and counts.
    #[command(after_help = "EXAMPLES\n  agentmon project view\n  agentmon project view --json")]
    View,
    /// Change this project's name, description or tags.
    #[command(after_help = "EXAMPLE\n  agentmon project update \\\n    \
        --description \"Replace the legacy checkout with the new payment provider.\" \\\n    \
        --tags frontend,payments,q3\n\n  Only the flags you pass change; --tags replaces the \
        whole list. Logs a project_updated event, which hand-editing project.json does not.")]
    Update {
        /// New display name.
        #[arg(long)]
        name: Option<String>,
        /// New one-or-two-sentence description.
        #[arg(long)]
        description: Option<String>,
        /// Replacement tag list, comma-separated.
        #[arg(long, value_delimiter = ',')]
        tags: Option<Vec<String>>,
        /// Agent recorded as the actor of the project_updated event.
        #[arg(long, env = "AGENTMON_AGENT", default_value = "agentmon")]
        agent: String,
        /// When the change happened (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// List the projects registered on this machine (~/.AgentMonitoring/registry.json).
    #[command(after_help = "EXAMPLE\n  agentmon project list\n\n  The registry is the app's \
        bookmark list — machine-local, updated when a project is created here or opened in \
        the app. An empty list does not mean no projects exist; it means none are registered.")]
    List,
    /// Write (or refresh) this project's `.mcp.json`, registering the agentmon MCP
    /// server for Claude Code — what `init --claude-mcp` does, for a project
    /// that already exists. Only the `agentmon` entry is touched.
    #[command(name = "claude-mcp", visible_alias = "mcp-json", after_help = "EXAMPLE\n  agentmon project claude-mcp\n\n  \
        Points the file at the mcp/server.mjs found near this binary (the installed app, \
        or this checkout), with absolute paths — re-run it on the machine the repo moves to.")]
    McpJson {
        /// Default agent handle inside the registration; any call can override it.
        #[arg(long, value_name = "handle", default_value = "claude")]
        agent: String,
    },
    /// Add or refresh Codex MCP in this project's .codex/config.toml.
    /// Replaces only agentmon; keeps other settings and comments.
    #[command(after_help = "EXAMPLE\n  agentmon project codex-mcp\n\n  Codex reads this file only in trusted projects.")]
    CodexMcp {
        /// Default record author; any MCP call can override it.
        #[arg(long, value_name = "handle", default_value = "codex")]
        agent: String,
    },
    /// Write the agentmon instructions into this repo's CLAUDE.md — what
    /// `init --claude-md` does, for a project that already exists. Conservative: a file
    /// already there gets the section appended after what the human wrote, and a file
    /// that already carries it (either language) is left alone.
    #[command(name = "claude-md", after_help = "EXAMPLE\n  agentmon project claude-md --lang ko\n\n  \
        Re-run it after an app update to pick up a refreshed template: an unchanged \
        section reports `already_present` and writes nothing.")]
    ClaudeMd {
        /// Language of the instructions: ko or en.
        #[arg(long, value_name = "ko|en")]
        lang: String,
    },
    /// Write the agentmon instructions into this repo's AGENTS.md for Codex and
    /// compatible tools. Appends to existing rules; skips a section already present.
    #[command(name = "agents-md", after_help = "EXAMPLE\n  agentmon project agents-md --lang ko")]
    AgentsMd {
        /// Language of the instructions: ko or en.
        #[arg(long, value_name = "ko|en")]
        lang: String,
    },
}

#[derive(Subcommand, Debug)]
enum AppFeedbackCmd {
    /// File a bug or a wish about this app — not about the project you are working in.
    #[command(after_help = "EXAMPLES\n  agentmon app-feedback add --agent my-agent --type bug \\\n    \
        --title \"status counts an abandoned log as in progress\" \\\n    \
        --body \"Repro: abandon a log, run status — the in-progress count still includes it.\" \\\n    \
        --human \"If a task is stopped rather than finished, the summary still counts it as \
        being worked on, so the numbers on the dashboard read high.\"\n  \
        agentmon app-feedback add --agent my-agent --type idea \\\n    \
        --title \"note list should filter by tag\" \\\n    \
        --human \"There is no way to narrow the notes list to one subject, so finding one \
        means reading all of them.\"\n\n  \
        --body is optional: a specific title can carry a whole wish. --human is not — this \
        board is read by the owner, so an item that speaks only to agents speaks to nobody \
        (`agentmon human-style`).")]
    Add {
        /// bug (something is wrong) or idea (something is missing).
        #[arg(long, value_name = "bug|idea")]
        r#type: String,
        /// One specific line.
        #[arg(long)]
        title: String,
        /// Free prose — repro for a bug, the situation that made you wish for an idea.
        #[arg(long)]
        body: Option<String>,
        #[command(flatten)]
        agent: AgentArg,
        #[command(flatten)]
        human: HumanArg,
        /// When it was noticed (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Rewrite an item's human area — the one thing about a filed item that can change.
    #[command(after_help = "EXAMPLE\n  agentmon app-feedback update FB-0003 --agent my-agent \\\n    \
        --human \"The board kept saying an item was open after I marked it done, so I \
        filed this; here is what I saw and when.\"\n\n  \
        Everything else about an item is fixed once filed. This exists so an item that \
        speaks only to agents — or whose retelling turned out to be wrong — can be made \
        readable by the person whose board it is. `agentmon human-style` prints the contract.")]
    Update {
        /// FB-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        #[command(flatten)]
        human: HumanArg,
        /// When the rewrite happened (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Every item, open first, newest first.
    #[command(after_help = "EXAMPLES\n  agentmon app-feedback list\n  \
        agentmon app-feedback list --status open --type bug --json")]
    List {
        /// open | done
        #[arg(long)]
        status: Option<String>,
        /// bug | idea
        #[arg(long)]
        r#type: Option<String>,
    },
    /// One item, body included.
    #[command(after_help = "EXAMPLE\n  agentmon app-feedback view FB-0001")]
    View { id: String },
    /// Mark an item handled — after really handling it.
    #[command(after_help = "EXAMPLE\n  agentmon app-feedback done FB-0001")]
    Done { id: String },
    /// Put a done item back on the board.
    #[command(after_help = "EXAMPLE\n  agentmon app-feedback reopen FB-0001")]
    Reopen { id: String },
    /// Delete a done item for good. Refused while it is open: mark it done first, so a
    /// complaint can never vanish unread.
    #[command(after_help = "EXAMPLE\n  agentmon app-feedback done FB-0001\n  \
        agentmon app-feedback delete FB-0001")]
    Delete { id: String },
}

#[derive(Args, Debug)]
struct AgentArg {
    /// Your agent handle, recorded on the record and the event. Defaults to $AGENTMON_AGENT.
    #[arg(long, value_name = "NAME", env = "AGENTMON_AGENT")]
    agent: String,
}

/// The human area (SPEC.md, "The human area"): the same work retold for a reader who was
/// not there and does not program.
///
/// One struct on every verb that takes one, so the flag pair reads the same everywhere and
/// a rejection can name it without knowing which command was run. `agentmon human-style`
/// prints the contract; a refusal prints the short version of it.
#[derive(Args, Debug)]
struct HumanArg {
    /// Retell this record for a non-programmer reader (see `agentmon human-style`).
    #[arg(long, value_name = "TEXT", conflicts_with = "human_file")]
    human: Option<String>,
    /// Read the human area from a file ('-' reads stdin).
    #[arg(long, value_name = "FILE")]
    human_file: Option<PathBuf>,
}

const RECONCILE_HELP: &str = "\
THE PROBLEM THIS REPAIRS
  Record ids are a per-project sequence counted from local files, so two machines working
  one repo offline both allocate WORK-0011 for different work, and the first git pull
  collides on worklogs/WORK-0011.md while events.jsonl points one id at two meanings.

WHAT IT DOES
  Compares this project against the incoming copy. Where the same id holds different
  content on the two sides, the LOCAL record — the one the rest of the world has not
  seen — moves to the next id free on BOTH sides, and everything pointing at it moves in
  the same breath: the file is renamed, its frontmatter id rewritten, every refs: entry
  and bare prose mention across local records rewritten (the exact WORK-/BUG- grammar the
  app links; [[note-names]] are untouched), and events.jsonl's ref fields and summary
  mentions rewritten. A mapping table says what moved where.

  Left alone, with the reason printed: an id whose bytes match on both sides (already
  synced — nothing to do), and one record edited on both sides (that is a content merge;
  git is the tool for it, re-keying would fork the record).

  --apply also installs `events.jsonl merge=union` in AgentMonitoring/.gitattributes:
  the event log is append-only and its readers sort by timestamp, so keeping both sides'
  lines IS the correct merge, on this pull and every future one.

  Re-keying moves records without changing a word in them, so no --human is asked for;
  the one event an applied run logs is project_updated, carrying the mapping.

EXAMPLE (the two-machine recovery, start to finish)
  git fetch origin
  git worktree add ../incoming origin/main
  agentmon reconcile --theirs ../incoming/AgentMonitoring            # dry run: the plan
  agentmon reconcile --theirs ../incoming/AgentMonitoring --apply
  git worktree remove ../incoming
  git add AgentMonitoring && git commit -m \"reconcile: re-key colliding record ids\"
  git pull   # paths no longer collide; events.jsonl merges by union
  agentmon doctor --strict

  Full recipe (including replaying a note the collision cost you):
  docs/AGENT_MANUAL.md, \"Two machines, one repo\".";

const WORK_START_HELP: &str = "\
BODY CONTRACT
  The body must contain all three sections. Anything else you add is kept.

  ## What   what you are building or changing, concretely
  ## Why    the problem, the constraint, the alternative you rejected
  ## How    the approach, and the parts a reviewer would otherwise reverse-engineer

HUMAN AREA (required)
  --human \"<text>\" (or --human-file <path>, '-' for stdin) retells the same work for a
  reader who was not there and does not program. It is stored as the record's last
  section, `## For humans`, which you may not write yourself. `agentmon human-style`
  prints the contract; so does every refusal.

EXAMPLE (Git Bash)
  agentmon work start --agent cli-builder \\
    --title \"Wire the change watcher into the desktop app\" \\
    --tags tauri,live-updates --refs BUG-0002 \\
    --human \"The app used to show whatever it had read when you opened a screen, so a
  record written a second ago looked missing. This makes it notice by itself.\" \\
    --body \"$(cat <<'EOF'
  ## What

  Start a notify watcher in the Tauri shell and emit project-changed.

  ## Why

  The desktop app shows whatever the project held when a screen opened, so browser mode
  looks more live than the product.

  ## How

  recommended_watcher on each registered AgentMonitoring folder, 250ms debounce.
  EOF
  )\"

  Long bodies: write a file and pass --body-file notes.md (or --body-file - for stdin).

ALREADY STARTED (or finished) THE WORK?
  Pass the real start time, then close the record with the real end time:
  agentmon work start ... --started-at 2026-08-18T09:12:00Z
  agentmon work done WORK-0007 ... --finished-at 2026-08-18T11:30:00Z --outcome \"...\" \\
    --human \"...\"

TIMESTAMPS (every --started-at / --finished-at / --at / --created-at)
  UTC ISO8601: 2026-08-18T09:12:00Z. Also accepted: 2026-08-18T09:12,
  \"2026-08-18 09:12:00\", 2026-08-18 (midnight UTC), 2026-08-18T11:12:00+02:00.
  Refused (exit 2): a time in the future, or one before the state it follows. The time
  is written into the record *and* into events.jsonl, so the app's timeline stays true.";

#[derive(Subcommand, Debug)]
enum WorkCmd {
    /// Start a work log. The body must contain ## What, ## Why and ## How.
    #[command(after_help = WORK_START_HELP)]
    Start {
        #[command(flatten)]
        agent: AgentArg,
        /// One line, shown in every list. Be specific.
        #[arg(long)]
        title: String,
        /// Comma-separated.
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
        /// Related records, comma-separated: WORK-0001,BUG-0002.
        #[arg(long, value_delimiter = ',')]
        refs: Vec<String>,
        /// Markdown body with the three required sections.
        #[arg(long, conflicts_with = "body_file")]
        body: Option<String>,
        /// Read the body from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// When the work actually began (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        started_at: Option<String>,
        /// Not valid here — a record gains its end time from `work done --finished-at`.
        #[arg(long, value_name = "ISO8601", hide = true)]
        finished_at: Option<String>,
    },
    /// Append a timestamped note to a work log — a progress note, or a later correction.
    #[command(after_help = "EXAMPLE\n  agentmon work update WORK-0003 \\\n    \
        --agent cli-builder \\\n    --message \"Debounce is in: one save produced four notify \
        events, now one reload.\" \\\n    --human \"Saving a file used to redraw the screen \
        four times; now it redraws once.\"\n\n  Notes are append-only and timestamped; they \
        are the story of the work, so write what changed and what you learned, not \
        \"progress\".\n\n\
        Writing it up afterwards? --at 2026-08-18T10:05:00Z stamps the note with the time it \
        actually happened.\n\n  A FINISHED record still takes notes. Nothing already written \
        changes — the note lands at the end of the timeline, dated at or after the close — so \
        this is how a record that turns out to state something false gets corrected inside \
        itself. Open the note with \"Correction:\" and the record page marks it and says so at \
        the top:\n\n  agentmon work update WORK-0011 --agent p6-curator \\\n    \
        --message \"Correction: relay has four agents, not ten (BUG-0017).\" \\\n    \
        --human \"An earlier line here said ten agents; the real number is four.\"\n\n\
        THE HUMAN AREA\n  A --message REQUIRES --human with it: the note is new events, and \
        its plain-language\n  telling travels with it. The telling is APPENDED to the page \
        as a dated entry paired\n  with the note — tell what this note did, not the whole \
        record again.\n\n  \
        --human alone is a refresh: nothing is added to ## Updates, the page is replaced \
        whole\n  (this is where tellings are merged or repaired), and the feed logs one \
        human_updated line.\n  \
        agentmon work update WORK-0011 --agent p6-curator \\\n    \
        --human \"What this work actually did, said plainly.\"\n\n\
        REPLAYING A LOST NOTE (reconstruction only)\n  A record re-created after a sync \
        collision (see `agentmon reconcile`) takes its original\n  notes back at their real \
        times with --replayed: the note may predate the close and the\n  notes around it, it \
        is inserted at its place in the timeline, and the event says\n  \"Replayed:\" so it \
        never passes for an original. Requires --at, --message and --human;\n  the telling \
        is inserted into the page at the note's time too.\n\n  \
        agentmon work update WORK-0011 --agent recovery-agent --replayed \\\n    \
        --at 2026-08-22T10:05:00Z --message \"<the lost note, verbatim>\" \\\n    \
        --human \"<that note's own telling>\"")]
    Update {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        /// The progress note: what changed, what you learned, what is next.
        #[arg(long, conflicts_with = "body_file")]
        message: Option<String>,
        /// Read the note from a file ('-' reads stdin). --message-file is the same flag.
        #[arg(long, value_name = "FILE", visible_alias = "message-file")]
        body_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// When the note was written (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
        /// Reconstruction only: write the note at the time the lost original happened,
        /// even where that predates the record's close or its other notes. Requires
        /// --at and --message; the note is inserted in timeline order and the event
        /// summary opens with "Replayed:".
        #[arg(long)]
        replayed: bool,
    },
    /// Stop a work log that will not be finished (status abandoned, with the reason).
    #[command(after_help = "EXAMPLE\n  agentmon work abandon WORK-0003 \\\n    \
        --agent cli-builder \\\n    --reason \"Superseded by WORK-0009, which solves the same \
        problem in agentmon-core; nothing from this branch was kept.\" \\\n    \
        --human \"We stopped this one and did the same job in another place; nothing here \
        was kept.\"\n\n  Stopping is an ending, so --human is required and lands as the \
        page's last entry.\n\n  Use it when work \
        stops for good: leaving it in_progress shows an agent still working on something \
        nobody is doing. The reason is appended under ## Updates and `finished` is stamped \
        with the moment it stopped. --at backdates it.")]
    Abandon {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        /// Why it stopped, and what a reader should look at instead.
        #[arg(long, conflicts_with = "reason_file")]
        reason: Option<String>,
        /// Read the reason from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        reason_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// When it stopped (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Close a work log with an outcome (what shipped, what changed, how it was verified).
    #[command(after_help = "EXAMPLE\n  agentmon work done WORK-0003 \\\n    \
        --agent cli-builder \\\n    --files src-tauri/src/lib.rs,src-tauri/Cargo.toml \\\n    \
        --outcome \"Shipped the debounced watcher; cargo check -p agentmonitoring clean and the \
        dashboard refreshes within ~300ms of a CLI write.\" \\\n    \
        --human \"The window now notices a new record on its own, about a third of a second \
        after it is written, instead of waiting for you to click.\"\n\n  The outcome is for \
        the next agent; --human is for everyone else, appended as the ending after the \
        tellings the record gathered while it ran (`agentmon human-style`).\n\n\
        RECORDING WORK THAT IS ALREADY OVER\n  --finished-at 2026-08-18T11:30:00Z stamps the \
        real end time; add --started-at to correct a start you had to guess at. Both land in \
        the frontmatter and in events.jsonl, so the duration and the feed agree.")]
    Done {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        /// What shipped, what changed, how it was verified.
        #[arg(long, conflicts_with = "outcome_file")]
        outcome: Option<String>,
        /// Read the outcome from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        outcome_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// Files this work touched, comma-separated (added to the record).
        #[arg(long, value_delimiter = ',')]
        files: Vec<String>,
        /// Related records to link, comma-separated.
        #[arg(long, value_delimiter = ',')]
        refs: Vec<String>,
        /// When the work actually ended (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        finished_at: Option<String>,
        /// Corrects the recorded start time (UTC ISO8601), for work logged after the fact.
        #[arg(long, value_name = "ISO8601")]
        started_at: Option<String>,
    },
    /// List work logs.
    #[command(after_help = "EXAMPLES\n  agentmon work list\n  \
        agentmon work list --status in_progress\n  \
        agentmon work list --agent cli-builder --json")]
    List {
        /// in_progress | done | abandoned
        #[arg(long)]
        status: Option<String>,
        /// Only this agent's work logs.
        #[arg(long)]
        agent: Option<String>,
        /// Only records carrying this tag.
        #[arg(long)]
        tag: Option<String>,
    },
    /// Show one work log.
    #[command(after_help = "EXAMPLES\n  agentmon work view WORK-0003\n  \
        agentmon work view WORK-0003 --json")]
    View {
        /// WORK-NNNN.
        id: String,
    },
}

const BUG_CREATE_HELP: &str = "\
BODY CONTRACT
  Plain prose becomes the ## Report section. Write repro steps, expected, actual.

HUMAN AREA (required)
  --human \"<text>\" (or --human-file <path>) says what is wrong for a reader who does not
  program: what they would see, and what it costs them. `agentmon human-style` is the
  contract, and every refusal prints its short form.

EXAMPLE (Git Bash)
  agentmon bug create --agent cli-builder \\
    --title \"work done exits 0 but leaves status in_progress\" \\
    --severity high --labels cli,data-loss \\
    --human \"Finishing a task says it worked, but the task still shows as running
  afterwards — so the board cannot be trusted to say what is done.\" \\
    --body \"$(cat <<'EOF'
  ## Report

  Repro:

  1. agentmon work start --agent a --title t --body \"\\$(cat body.md)\"
  2. agentmon work done WORK-0001 --agent a --outcome \"shipped it, tests green\"
  3. agentmon work view WORK-0001

  Expected: status done, finished set.
  Actual: exit 0, but status is still in_progress and finished is null.
  EOF
  )\"

SEVERITY
  critical  the product is unusable or data is being lost
  high      a core flow is broken and there is no workaround
  medium    broken with a workaround, or wrong in a visible but survivable way
  low       cosmetic, or an edge case nobody hits often";

#[derive(Subcommand, Debug)]
enum BugCmd {
    /// File a bug.
    #[command(after_help = BUG_CREATE_HELP)]
    Create {
        #[command(flatten)]
        agent: AgentArg,
        #[arg(long)]
        title: String,
        /// critical | high | medium | low
        #[arg(long, value_name = "LEVEL")]
        severity: String,
        /// Repro steps, expected, actual. Plain prose becomes the ## Report section.
        #[arg(long, conflicts_with = "body_file")]
        body: Option<String>,
        /// Read the report from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// Comma-separated.
        #[arg(long, value_delimiter = ',')]
        labels: Vec<String>,
        /// Related records, comma-separated.
        #[arg(long, value_delimiter = ',')]
        refs: Vec<String>,
        /// When the bug was found (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        created_at: Option<String>,
    },
    /// Take ownership of a bug (sets assignee and status in_progress).
    #[command(after_help = "EXAMPLE\n  agentmon bug claim BUG-0002 --agent cli-builder\n\n  \
        Claiming a bug someone else holds is refused — comment on it instead.\n\n  \
        Claiming writes no prose, so --human is optional here — except on a bug filed \
        before the human area existed, which gains one the first time anything touches it:\n  \
        agentmon bug claim BUG-0002 --agent cli-builder \\\n    \
        --human \"What this bug is, in plain words.\"")]
    Claim {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        #[command(flatten)]
        human: HumanArg,
        /// When it was claimed (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Add a comment to a bug's thread.
    #[command(after_help = "EXAMPLE\n  agentmon bug comment BUG-0002 \\\n    \
        --agent cli-builder \\\n    --message \"Root cause: setup() never started a watcher, so \
        project-changed was never emitted.\" \\\n    --human \"The app never noticed saved \
        files because the part that watches for them\n    was never switched on.\"\n\n  \
        THE HUMAN AREA\n  A --message REQUIRES --human with it: the finding is part of the \
        bug's story, and\n  its plain-language telling travels with it — APPENDED to the \
        page as a dated entry\n  paired with the comment, so tell what this finding is, not \
        the whole bug again.\n\n  \
        --human alone adds nothing to the thread; it replaces the bug's page whole (the \
        place\n  to merge or repair tellings) and logs one human_updated line:\n  \
        agentmon bug comment BUG-0002 --agent cli-builder \\\n    \
        --human \"What this bug looks like to somebody using the app.\"\n\n\
        REPLAYING A LOST COMMENT (reconstruction only)\n  A bug re-created after a sync \
        collision (see `agentmon reconcile`) takes its original\n  comments back at their \
        real times with --replayed — inserted in timeline order, the\n  event marked \
        \"Replayed:\". Requires --at, --message and --human; the telling is inserted\n  \
        into the page at the comment's time too.\n\n  \
        agentmon bug comment BUG-0006 --agent recovery-agent --replayed \\\n    \
        --at 2026-08-22T10:05:00Z --message \"<the lost comment, verbatim>\" \\\n    \
        --human \"<that comment's own telling>\"")]
    Comment {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        /// What you found, what you tried, what it means for the fix.
        #[arg(long, conflicts_with = "body_file")]
        message: Option<String>,
        /// Read the comment from a file ('-' reads stdin). --message-file is the same flag.
        #[arg(long, value_name = "FILE", visible_alias = "message-file")]
        body_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// Reconstruction only: write the comment at the time the lost original
        /// happened, even where that predates later comments. Requires --at and
        /// --message; the comment is inserted in timeline order and the event summary
        /// opens with "Replayed:".
        #[arg(long)]
        replayed: bool,
        /// When the comment was written (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Resolve a bug with a written resolution.
    #[command(after_help = "EXAMPLE\n  agentmon bug resolve BUG-0002 \\\n    \
        --agent cli-builder \\\n    --resolution \"Root cause: no watcher was ever started. Fix: \
        setup() spawns a debounced notify watcher that emits project-changed. Verified: cargo \
        check -p agentmonitoring clean; dashboard refreshed on a CLI write.\" \\\n    \
        --human \"It works now: the window updates by itself when a record is written, and \
        we checked that by writing one while it was open.\"\n\n  Say the root \
        cause, the fix, and the verification. Resolving a bug you did not claim assigns it to \
        you. --human is required and lands as the page's last entry — the ending, after \
        the chase (`agentmon human-style`).")]
    Resolve {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        agent: AgentArg,
        /// Root cause, the fix, and how it was verified.
        #[arg(long, conflicts_with = "resolution_file")]
        resolution: Option<String>,
        /// Read the resolution from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        resolution_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// When it was fixed (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// List bugs.
    #[command(after_help = "EXAMPLES\n  agentmon bug list --status open\n  \
        agentmon bug list --severity high --json\n  \
        agentmon bug list --label tauri")]
    List {
        /// open | in_progress | resolved | closed
        #[arg(long)]
        status: Option<String>,
        /// critical | high | medium | low
        #[arg(long)]
        severity: Option<String>,
        /// Only bugs carrying this label.
        #[arg(long)]
        label: Option<String>,
        /// Only bugs assigned to this agent.
        #[arg(long)]
        assignee: Option<String>,
    },
    /// Show one bug with its comment thread.
    #[command(after_help = "EXAMPLES\n  agentmon bug view BUG-0002\n  \
        agentmon bug view BUG-0002 --json")]
    View {
        /// BUG-NNNN.
        id: String,
    },
}

const NOTE_ADD_HELP: &str = "\
WHAT A NOTE IS
  A work log is history; a note is knowledge — the thing you wish the previous agent
  had told you. One fact, one file: before adding, run `agentmon note list` and update
  an existing note instead of writing a near-duplicate.

TYPES (pick the question your note answers)
  memory     a durable fact or gotcha about this project (\"gate scripts must sandbox
             the registry\")
  handoff    state for whoever works next: done, mid-flight, do-this-first
  decision   a choice and its reasoning, so it is not relitigated from scratch
  reference  a pointer to something outside the project: a URL, a dashboard, a spec

EXAMPLE (Git Bash)
  agentmon note add --agent cli-builder \\
    --type memory \\
    --title \"Gate scripts must sandbox the registry\" \\
    --description \"Any script that runs agentmon init must set AGENTMON_REGISTRY_DIR.\" \\
    --tags gates,registry --refs WORK-0035 \\
    --human \"A test script that creates a pretend project can leave it in the list of
  real projects on this machine, unless it is pointed at a scratch folder first.\" \\
    --body \"$(cat <<'EOF'
  agentmon init registers the new project in ~/.AgentMonitoring/registry.json, best
  effort. A gate script that inits a temp fixture therefore bookmarks that fixture in
  the real user registry unless it points AGENTMON_REGISTRY_DIR at a scratch dir first.
  EOF
  )\"

NAMES
  The note's identity is its kebab-case name (also the file: notes/<name>.md). It is
  derived from the title — the example above becomes gate-scripts-must-sandbox-the-registry
  — or passed explicitly with --name. Non-ascii titles need an explicit --name.

  The body is free-form markdown: sections, lists and code fences are all yours — except
  `## For humans`, which is the reserved human area agentmon writes from --human.
  Refused (exit 5): a name that already exists — update that note instead.";

#[derive(Subcommand, Debug)]
enum NoteCmd {
    /// Add a note. Refuses a name that already exists — update that note instead.
    #[command(visible_alias = "create", after_help = NOTE_ADD_HELP)]
    Add {
        #[command(flatten)]
        agent: AgentArg,
        /// One line, shown in every list. Be specific.
        #[arg(long)]
        title: String,
        /// essential | memory | handoff | decision | reference — `essential` is required
        /// session-start reading and every list surfaces it first.
        #[arg(long = "type", value_name = "TYPE")]
        note_type: String,
        /// One line: what this note knows and when to read it. Lists show it.
        #[arg(long)]
        description: String,
        /// Kebab-case identity (and file name). Defaults to a slug of the title.
        #[arg(long)]
        name: Option<String>,
        /// Free-form markdown body — the knowledge itself.
        #[arg(long, conflicts_with = "body_file")]
        body: Option<String>,
        /// Read the body from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// Comma-separated.
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
        /// Related records and notes, comma-separated: WORK-0001,BUG-0002,other-note.
        #[arg(long, value_delimiter = ',')]
        refs: Vec<String>,
        /// When the note was written (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Rewrite parts of a note: any metadata flag, and/or the whole body.
    #[command(after_help = "EXAMPLES\n  agentmon note update handoff-p13 --agent ui-builder \\\n    \
        --body-file handoff.md --human \"Where this hand-over stands now, in plain words.\"\n  \
        agentmon note update registry-gate-gotcha --agent cli-builder \\\n    \
        --description \"Every gate must set AGENTMON_REGISTRY_DIR; check-live now does too.\"\n  \
        agentmon note update handoff-p13 --agent ui-builder \\\n    \
        --human \"A clearer telling of the same note.\"        # rewrites only that\n\n  \
        Only the flags you pass change. --body REPLACES the body — a note holds what is \
        currently true, not a diary (history belongs in work logs) — and a replaced body \
        needs --human with it, because the old telling described knowledge that is gone. \
        --tags and --refs replace their lists. The event log keeps who changed what and when.")]
    Update {
        /// The note's name (see `agentmon note list`).
        name: String,
        #[command(flatten)]
        agent: AgentArg,
        /// New one-line title.
        #[arg(long)]
        title: Option<String>,
        /// essential | memory | handoff | decision | reference — `essential` is required
        /// session-start reading and every list surfaces it first.
        #[arg(long = "type", value_name = "TYPE")]
        note_type: Option<String>,
        /// New one-line description.
        #[arg(long)]
        description: Option<String>,
        /// Replacement tag list, comma-separated.
        #[arg(long, value_delimiter = ',')]
        tags: Option<Vec<String>>,
        /// Replacement refs list, comma-separated.
        #[arg(long, value_delimiter = ',')]
        refs: Option<Vec<String>>,
        /// Replacement markdown body.
        #[arg(long, conflicts_with = "body_file")]
        body: Option<String>,
        /// Read the replacement body from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
        #[command(flatten)]
        human: HumanArg,
        /// When the change happened (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Remove a note that is wrong or fully absorbed. The event log keeps the removal.
    #[command(visible_alias = "rm", after_help = "EXAMPLE\n  \
        agentmon note remove handoff-p12 --agent p13-builder\n\n  \
        Remove a note when keeping it would mislead: it is wrong, superseded, or a \
        handoff that has been fully absorbed. The note_removed event stays on the feed — \
        who removed it, when, and what it was called.\n\n  This is for notes only. Work \
        logs and bugs are history and have no remove command, anywhere.")]
    Remove {
        /// The note's name.
        name: String,
        #[command(flatten)]
        agent: AgentArg,
        /// When it was removed (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// List notes: names, types and the one-line descriptions. Start every session here.
    #[command(after_help = "EXAMPLES\n  agentmon note list\n  \
        agentmon note list --type handoff\n  \
        agentmon note list --search registry --json\n\n  \
        The list is the index: scan the descriptions, then `agentmon note view <name>` \
        the ones that matter for your task.")]
    List {
        /// essential | memory | handoff | decision | reference — `essential` is required
        /// session-start reading and every list surfaces it first.
        #[arg(long = "type", value_name = "TYPE")]
        note_type: Option<String>,
        /// Only notes carrying this tag.
        #[arg(long)]
        tag: Option<String>,
        /// Only notes written by this agent.
        #[arg(long)]
        agent: Option<String>,
        /// Case-insensitive match on name, title, description, tags and body.
        #[arg(long, value_name = "TEXT")]
        search: Option<String>,
    },
    /// Show one note in full.
    #[command(after_help = "EXAMPLES\n  agentmon note view registry-gate-gotcha\n  \
        agentmon note view handoff-p13 --json")]
    View {
        /// The note's name.
        name: String,
    },
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            if cli.json {
                let payload = serde_json::json!({
                    "ok": false,
                    "error": { "kind": err.kind, "message": err.message, "exitCode": err.code },
                });
                eprintln!("{}", serde_json::to_string_pretty(&payload).unwrap());
            } else {
                eprintln!("agentmon: {}", err.message);
            }
            ExitCode::from(err.code)
        }
    }
}

struct CliError {
    code: u8,
    kind: &'static str,
    message: String,
}

impl From<CoreError> for CliError {
    fn from(e: CoreError) -> Self {
        let code = match &e {
            CoreError::ProjectDirNotFound { .. } | CoreError::RecordNotFound { .. } => {
                exit::NOT_FOUND
            }
            CoreError::InvalidBody(_) => exit::INVALID_BODY,
            CoreError::Conflict { .. } | CoreError::Locked { .. } => exit::CONFLICT,
            CoreError::Malformed { .. } => exit::INVALID_PROJECT,
            CoreError::Io { .. } => exit::IO,
            CoreError::InvalidId { .. } | CoreError::InvalidValue { .. } => exit::USAGE,
            // SPEC.md fixes this one at 2: a missing human area is a call written wrong,
            // not a body that failed validation.
            CoreError::MissingHuman(_) => exit::USAGE,
        };
        CliError {
            code,
            kind: e.kind(),
            message: e.to_string(),
        }
    }
}

type CliResult = std::result::Result<(), CliError>;

fn run(cli: &Cli) -> CliResult {
    match &cli.command {
        Command::Init {
            name,
            description,
            tags,
            agent,
            at,
            claude_md,
            agents_md,
            mcp_json,
            mcp_agent,
            codex_mcp,
            codex_agent,
        } => cmd_init(
            cli,
            name,
            description.as_deref(),
            tags,
            agent,
            at.as_deref(),
            claude_md.as_deref(),
            agents_md.as_deref(),
            *mcp_json,
            mcp_agent,
            *codex_mcp,
            codex_agent,
        ),
        Command::Project(cmd) => run_project(cli, cmd),
        Command::Work(cmd) => run_work(cli, cmd),
        Command::Bug(cmd) => run_bug(cli, cmd),
        Command::Note(cmd) => run_note(cli, cmd),
        Command::AppFeedback(cmd) => run_app_feedback(cli, cmd),
        Command::HumanStyle => cmd_human_style(cli),
        Command::Status => cmd_status(cli, cli.json),
        Command::Doctor { strict } => cmd_doctor(cli, *strict, cli.json),
        Command::Reconcile {
            theirs,
            apply,
            only,
            agent,
            at,
            no_gitattributes,
        } => cmd_reconcile(cli, theirs, *apply, only, agent, at.as_deref(), *no_gitattributes),
        Command::Migrate { from, project, to } => cmd_migrate(cli, from, project, to),
    }
}

/// Register a store in `~/.AgentMonitoring/registry.json`, best effort.
///
/// A failure here never fails the command that triggered it: the registry is the app's
/// bookmark list, and headless machines (CI, containers) legitimately have none.
fn register(store: &Store) -> bool {
    let name = store.project().ok().map(|p| p.name);
    let mut reg = Registry::load();
    reg.add(store.root(), name.as_deref());
    reg.save().is_ok()
}

// ---------------------------------------------------------------------------
// init / project / migrate
// ---------------------------------------------------------------------------

fn cmd_init(
    cli: &Cli,
    name: &str,
    description: Option<&str>,
    tags: &[String],
    agent: &str,
    at: Option<&str>,
    claude_md: Option<&str>,
    agents_md: Option<&str>,
    mcp_json: bool,
    mcp_agent: &str,
    codex_mcp: bool,
    codex_agent: &str,
) -> CliResult {
    // Parsed before anything is written: a typo in either language must not leave behind a
    // project that a corrected re-run then refuses to create.
    let claude_md = claude_md.map(agentmon_core::parse_claude_md_lang).transpose()?;
    let agents_md = agents_md.map(agentmon_core::parse_agents_md_lang).transpose()?;
    // `init` is the one command that must not resolve an existing project: the location
    // is --dir, $AGENTMON_DIR or the current directory, taken literally.
    let location = cli
        .dir
        .clone()
        .or_else(|| std::env::var_os("AGENTMON_DIR").map(PathBuf::from))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    let store = Store::init(
        &location,
        &NewProject {
            name: name.to_string(),
            description: description.unwrap_or_default().to_string(),
            tags: tags.to_vec(),
            actor: agent.to_string(),
            at: at.map(str::to_string),
        },
    )?;
    let registered = register(&store);
    let claude = claude_md
        .map(|lang| agentmon_core::write_claude_md(store.location(), lang))
        .transpose()?;
    let agents = agents_md
        .map(|lang| agentmon_core::write_agents_md(store.location(), lang))
        .transpose()?;
    let mut registrations = Vec::new();
    for (enabled, codex, handle) in [(mcp_json, false, mcp_agent), (codex_mcp, true, codex_agent)] {
        if !enabled {
            continue;
        }
        let file = if codex { ".codex/config.toml" } else { ".mcp.json" };
        // The server ships beside this binary (installed app) or at <repo>/mcp (source
        // checkout); pointing .mcp.json at a path that is not there helps nobody.
        let server = agentmon_core::find_mcp_server().ok_or_else(|| CliError {
            code: exit::NOT_FOUND,
            kind: "not_found",
            message: format!("the project was created, but {file} was not: no mcp/server.mjs \
                      found near this agentmon binary — write the file by hand instead \
                      (see docs/MCP.md)"),
        })?;
        let result = if codex {
            agentmon_core::write_codex_mcp(store.location(), &server, Some(handle))
        } else {
            agentmon_core::write_mcp_json(store.location(), &server, Some(handle))
        };
        registrations.push(result?);
    }
    let project = store.project()?;
    if cli.json {
        return print_json(&project);
    }
    println!("Created project \"{}\"", project.name);
    println!("  {}", store.root().display());
    if registered {
        println!("  registered in the app's project list");
    }
    for (path, outcome) in [claude, agents].into_iter().flatten() {
        use agentmon_core::ClaudeMdOutcome as O;
        match outcome {
            O::Created => println!("  wrote {}", path.display()),
            O::Appended => println!("  appended the agent instructions to {}", path.display()),
            O::AlreadyPresent => {
                println!("  {} already carries the agent instructions", path.display())
            }
        }
    }
    for (path, outcome) in registrations {
        use agentmon_core::McpJsonOutcome as O;
        match outcome {
            O::Created => println!("  wrote {} (MCP server registered)", path.display()),
            O::Updated => println!("  added the agentmon server to {}", path.display()),
            O::AlreadyPresent => {
                println!("  {} already registers the agentmon server", path.display())
            }
        }
    }
    println!();
    println!("Next:");
    println!(
        "  agentmon work start --agent <you> --title \"<title>\" --body \"...\" --human \"...\""
    );
    println!();
    println!(
        "Commands run from inside {} find this project automatically (like git).",
        store.location().display()
    );
    Ok(())
}

fn cmd_reconcile(
    cli: &Cli,
    theirs: &Path,
    apply: bool,
    only: &[String],
    agent: &str,
    at: Option<&str>,
    no_gitattributes: bool,
) -> CliResult {
    let store = open(cli)?;
    let plan = agentmon_core::reconcile(
        &store,
        &agentmon_core::ReconcileRequest {
            theirs: theirs.to_path_buf(),
            apply,
            only: only.to_vec(),
            actor: agent.to_string(),
            at: at.map(str::to_string),
            gitattributes: !no_gitattributes,
        },
    )?;
    if cli.json {
        return print_json(&plan);
    }

    println!("local:    {}", plan.local);
    println!("incoming: {}", plan.incoming);

    if plan.mappings.is_empty() {
        println!("\nNothing to re-key: no id here holds different content on the two sides.");
    } else {
        println!(
            "\n{} — {} record id(s) move:",
            if plan.applied {
                "RE-KEYED"
            } else {
                "RE-KEY PLAN (dry run — nothing was written)"
            },
            plan.mappings.len()
        );
        for m in &plan.mappings {
            println!("\n  {} → {}", m.from, m.to);
            println!(
                "    local (moves):     \"{}\"  ({}, {})",
                clip(&m.local_title, 60),
                m.local_agent,
                m.local_at
            );
            println!(
                "    incoming (stays):  \"{}\"  ({}, {})",
                clip(&m.incoming_title, 60),
                m.incoming_agent,
                m.incoming_at
            );
        }
        println!("\nFILES {}", if plan.applied { "REWRITTEN" } else { "TO REWRITE" });
        for f in &plan.files {
            match &f.renamed_to {
                Some(to) => println!("  {} → {}  ({} id mention(s))", f.path, to, f.mentions),
                None => println!("  {}  ({} id mention(s))", f.path, f.mentions),
            }
        }
        if plan.events.refs + plan.events.summaries > 0 {
            println!(
                "  events.jsonl  ({} ref field(s), {} summary mention(s), {} line(s) total)",
                plan.events.refs, plan.events.summaries, plan.events.total_lines
            );
        }
    }

    if !plan.skipped.is_empty() {
        println!("\nLEFT ALONE");
        for s in &plan.skipped {
            println!("  {}  [{}]  {}", s.id, s.reason, s.detail);
        }
    }

    use agentmon_core::GitAttributes as G;
    match plan.gitattributes {
        G::Created => println!("\nWrote AgentMonitoring/.gitattributes: events.jsonl merge=union"),
        G::Appended => {
            println!("\nAppended to AgentMonitoring/.gitattributes: events.jsonl merge=union")
        }
        G::AlreadyPresent => {
            println!("\nAgentMonitoring/.gitattributes already carries the events.jsonl merge rule")
        }
        G::Skipped => {}
    }

    if plan.applied {
        if let Some(ev) = &plan.event {
            println!("\nLogged project_updated: {}", ev.summary);
        }
        println!("\nNext:");
        println!("  git add AgentMonitoring && git commit -m \"reconcile: re-key colliding record ids\"");
        println!("  git pull        # paths no longer collide; events.jsonl merges by union");
        println!("  agentmon doctor --strict");
    } else if !plan.mappings.is_empty() {
        println!("\nThis was a dry run. Execute exactly this plan:");
        println!("  agentmon reconcile --theirs {} --apply", theirs.display());
    }
    Ok(())
}

fn cmd_migrate(cli: &Cli, from: &Path, slug: &str, to: &Path) -> CliResult {
    let store = agentmon_core::migrate(from, slug, to)?;
    let registered = register(&store);
    let project = store.project()?;
    if cli.json {
        return print_json(&project);
    }
    println!(
        "Migrated \"{}\" ({} work logs, {} bugs, {} events)",
        project.name, project.counts.work_total, project.counts.bugs_total, project.counts.events
    );
    println!("  {}", store.root().display());
    if registered {
        println!("  registered in the app's project list");
    }
    println!();
    println!("Next:");
    println!("  agentmon doctor --dir {}", store.root().display());
    println!("  …then delete the old vault folder yourself. It was not modified.");
    Ok(())
}

fn run_project(cli: &Cli, cmd: &ProjectCmd) -> CliResult {
    match cmd {
        ProjectCmd::View => {
            let store = open(cli)?;
            let p = store.project()?;
            if cli.json {
                return print_json(&p);
            }
            println!("{}", p.name);
            if !p.description.is_empty() {
                println!("{}", p.description);
            }
            if !p.tags.is_empty() {
                println!("tags: {}", p.tags.join(", "));
            }
            println!("{}", p.path);
            println!(
                "work {} ({} in progress) · bugs {} ({} open) · {} events · last activity {}",
                p.counts.work_total,
                p.counts.work_in_progress,
                p.counts.bugs_total,
                p.counts.bugs_open,
                p.counts.events,
                p.counts.last_activity.as_deref().unwrap_or("—")
            );
            Ok(())
        }
        ProjectCmd::Update {
            name,
            description,
            tags,
            agent,
            at,
        } => {
            let store = open(cli)?;
            let written = store.update_project(&UpdateProject {
                name: name.clone(),
                description: description.clone(),
                tags: tags.clone(),
                actor: agent.clone(),
                at: at.clone(),
            })?;
            // Keep the registry's cached display name in step with the rename.
            register(&store);
            if cli.json {
                return print_json(&written);
            }
            let p = &written.record;
            println!("Updated project {}", p.name);
            if !p.description.is_empty() {
                println!("  {}", clip(&p.description, 100));
            }
            if !p.tags.is_empty() {
                println!("  tags: {}", p.tags.join(", "));
            }
            println!("  {}", written.path);
            Ok(())
        }
        ProjectCmd::McpJson { agent } | ProjectCmd::CodexMcp { agent } => {
            let store = open(cli)?;
            let server = agentmon_core::find_mcp_server().ok_or_else(|| CliError {
                code: exit::NOT_FOUND,
                kind: "not_found",
                message: "no mcp/server.mjs found near this agentmon binary — write the \
                          file by hand instead (see docs/MCP.md)"
                    .to_string(),
            })?;
            let (path, outcome) = match cmd {
                ProjectCmd::CodexMcp { .. } => {
                    agentmon_core::write_codex_mcp(store.location(), &server, Some(agent))?
                }
                _ => agentmon_core::write_mcp_json(store.location(), &server, Some(agent))?,
            };
            if cli.json {
                use agentmon_core::McpJsonOutcome as O;
                return print_json(&serde_json::json!({
                    "ok": true,
                    "path": path.display().to_string(),
                    "outcome": match outcome {
                        O::Created => "created",
                        O::Updated => "updated",
                        O::AlreadyPresent => "already_present",
                    },
                }));
            }
            use agentmon_core::McpJsonOutcome as O;
            match outcome {
                O::Created => println!("Wrote {} (MCP server registered)", path.display()),
                O::Updated => println!("Added the agentmon server to {}", path.display()),
                O::AlreadyPresent => {
                    println!("{} already registers the agentmon server", path.display())
                }
            }
            println!("  server: {}", server.display());
            Ok(())
        }
        ProjectCmd::ClaudeMd { lang } | ProjectCmd::AgentsMd { lang } => {
            let lang = agentmon_core::parse_claude_md_lang(lang).map_err(|e| {
                let mut err = CliError::from(e);
                err.message = err.message.replace("--claude-md", "--lang");
                err
            })?;
            let store = open(cli)?;
            let (path, outcome) = match cmd {
                ProjectCmd::AgentsMd { .. } => agentmon_core::write_agents_md(store.location(), lang)?,
                _ => agentmon_core::write_claude_md(store.location(), lang)?,
            };
            if cli.json {
                use agentmon_core::ClaudeMdOutcome as O;
                return print_json(&serde_json::json!({
                    "ok": true,
                    "path": path.display().to_string(),
                    "outcome": match outcome {
                        O::Created => "created",
                        O::Appended => "appended",
                        O::AlreadyPresent => "already_present",
                    },
                }));
            }
            use agentmon_core::ClaudeMdOutcome as O;
            match outcome {
                O::Created => println!("Wrote {}", path.display()),
                O::Appended => {
                    println!("Appended the agentmon section to {}", path.display())
                }
                O::AlreadyPresent => {
                    println!("{} already carries the agentmon section", path.display())
                }
            }
            Ok(())
        }
        ProjectCmd::List => {
            let reg = Registry::load();
            #[derive(serde::Serialize)]
            #[serde(rename_all = "camelCase")]
            struct Row {
                path: String,
                available: bool,
                name: Option<String>,
                #[serde(skip_serializing_if = "Option::is_none")]
                error: Option<String>,
            }
            let rows: Vec<Row> = reg
                .projects
                .iter()
                .map(|e| match Store::open(&e.path) {
                    Ok(store) => match store.project() {
                        Ok(p) => Row {
                            path: e.path.display().to_string(),
                            available: true,
                            name: Some(p.name),
                            error: None,
                        },
                        Err(err) => Row {
                            path: e.path.display().to_string(),
                            available: false,
                            name: e.name.clone(),
                            error: Some(err.to_string()),
                        },
                    },
                    Err(err) => Row {
                        path: e.path.display().to_string(),
                        available: false,
                        name: e.name.clone(),
                        error: Some(err.to_string()),
                    },
                })
                .collect();
            if cli.json {
                return print_json(&rows);
            }
            if rows.is_empty() {
                println!("No projects registered on this machine.");
                println!();
                println!("Create one:");
                println!("  agentmon init --name \"<name>\"           # in the repo it belongs to");
                println!();
                println!("Or open an existing folder once in the AgentMonitoring app.");
                return Ok(());
            }
            for r in &rows {
                let name = r.name.as_deref().unwrap_or("—");
                if r.available {
                    println!("{:<30} {}", clip(name, 30), r.path);
                } else {
                    println!("{:<30} {}  (unavailable)", clip(name, 30), r.path);
                }
            }
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// work
// ---------------------------------------------------------------------------

fn run_work(cli: &Cli, cmd: &WorkCmd) -> CliResult {
    match cmd {
        WorkCmd::Start {
            agent,
            title,
            tags,
            refs,
            body,
            body_file,
            human,
            started_at,
            finished_at,
        } => {
            if let Some(f) = finished_at {
                return Err(finished_at_on_start(f));
            }
            one_stdin(&[
                ("--body-file", body_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            let body = read_text(
                body.as_deref(),
                body_file.as_deref(),
                BodySource {
                    what: "work log body",
                    inline_flag: "--body",
                    file_flag: "--body-file",
                    template: validate::WORK_TEMPLATE,
                    example: validate::WORK_EXAMPLE,
                },
            )?;
            let human = human.required()?;
            let store = open(cli)?;
            let w = store.start_work(&StartWork {
                agent: agent.agent.clone(),
                title: title.clone(),
                tags: tags.clone(),
                refs: refs.clone(),
                body,
                human,
                started_at: started_at.clone(),
            })?;
            if cli.json {
                return print_json(&w);
            }
            println!("Started {}  {}", w.id, w.record.meta.title);
            println!("  {}", w.path);
            println!();
            println!("Next:");
            println!(
                "  agentmon work update {} --agent {} --message \"<what changed>\" \\\n    \
                 --human \"<that note's own telling — it is appended to the page>\"",
                w.id, agent.agent
            );
            println!(
                "  agentmon work done   {} --agent {} --outcome \"<what shipped, how verified>\" \\\n    \
                 --human \"<the same, for a reader who does not program>\"",
                w.id, agent.agent
            );
            Ok(())
        }
        WorkCmd::Update {
            id,
            agent,
            message,
            body_file,
            human,
            at,
            replayed,
        } => {
            one_stdin(&[
                ("--body-file", body_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            // A note is optional here: `--human` alone is the refresh SPEC.md defines, and
            // demanding a progress note for it would put a note in the record that never
            // happened. Core refuses the case where neither was passed.
            let message = match (message.as_deref(), body_file.as_deref()) {
                (None, None) => None,
                (inline, file) => Some(read_text(
                    inline,
                    file,
                    BodySource {
                        what: "work update",
                        inline_flag: "--message",
                        file_flag: "--body-file (or --message-file)",
                        template: "A sentence or two: what changed since the last note, what \
                                   you learned, what you are doing next.",
                        example: "agentmon work update WORK-0003 \\\n  \
                                  --agent cli-builder \\\n  --message \"Debounce is in: one \
                                  save produced four notify events, now one reload.\" \\\n  \
                                  --human \"Saving used to redraw the screen four times; now \
                                  it redraws once.\"",
                    },
                )?),
            };
            let human = human.read()?;
            let store = open(cli)?;
            let w = if *replayed {
                let (Some(message), Some(at)) = (message.as_deref(), at.as_deref()) else {
                    return Err(replay_usage("work update"));
                };
                store.replay_work_note(id, &agent.agent, message, human.as_deref(), at)?
            } else {
                store.update_work(
                    id,
                    &agent.agent,
                    message.as_deref(),
                    human.as_deref(),
                    at.as_deref(),
                )?
            };
            if cli.json {
                return print_json(&w);
            }
            let n = w.record.updates.len();
            if *replayed {
                println!("Replayed a note onto {} at {}", w.id, w.event.ts);
                println!("  inserted in timeline order; the event summary says \"Replayed:\"");
            } else if message.is_none() {
                println!("Rewrote the human area of {}", w.id);
                println!("  ## Updates is untouched; the feed logs human_updated");
            } else {
                println!(
                    "Updated {}  ({} note{} now, latest {})",
                    w.id,
                    n,
                    if n == 1 { "" } else { "s" },
                    w.record.updates.last().map(|u| u.ts.as_str()).unwrap_or("—")
                );
            }
            println!("  {}", w.path);
            // Say plainly what was and was not touched, because appending to a closed
            // record looks like editing history and is not. (A replay already said what
            // it did in its own two lines — inserted, marked — so it skips this one.)
            if !*replayed && w.record.meta.status != WorkStatus::InProgress {
                println!(
                    "  Appended to a {} record: status, timestamps and everything above ## Updates are unchanged.",
                    w.record.meta.status.as_str()
                );
            }
            Ok(())
        }
        WorkCmd::Abandon {
            id,
            agent,
            reason,
            reason_file,
            human,
            at,
        } => {
            one_stdin(&[
                ("--reason-file", reason_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            let reason = read_text(
                reason.as_deref(),
                reason_file.as_deref(),
                BodySource {
                    what: "abandon reason",
                    inline_flag: "--reason",
                    file_flag: "--reason-file",
                    template: "One or two sentences: why this stopped, and what a reader \
                               should look at instead.",
                    example: "agentmon work abandon WORK-0003 \\\n  \
                              --agent cli-builder \\\n  --reason \"Superseded by WORK-0009, \
                              which solves the same problem in agentmon-core; nothing from \
                              this branch was kept.\" \\\n  \
                              --human \"We stopped this one and did the same job in another \
                              place; nothing here was kept.\"",
                },
            )?;
            let human = human.required()?;
            let store = open(cli)?;
            let w = store.abandon_work(
                id,
                &AbandonWork {
                    agent: agent.agent.clone(),
                    reason,
                    human,
                    at: at.clone(),
                },
            )?;
            if cli.json {
                return print_json(&w);
            }
            println!("Abandoned {}  {}", w.id, w.record.meta.title);
            println!(
                "  started {}  stopped {}",
                w.record.meta.started,
                w.record.meta.finished.as_deref().unwrap_or("—")
            );
            println!("  {}", w.path);
            Ok(())
        }
        WorkCmd::Done {
            id,
            agent,
            outcome,
            outcome_file,
            human,
            files,
            refs,
            finished_at,
            started_at,
        } => {
            one_stdin(&[
                ("--outcome-file", outcome_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            let outcome = read_text(
                outcome.as_deref(),
                outcome_file.as_deref(),
                BodySource {
                    what: "outcome",
                    inline_flag: "--outcome",
                    file_flag: "--outcome-file",
                    template: validate::OUTCOME_TEMPLATE,
                    example: validate::OUTCOME_EXAMPLE,
                },
            )?;
            let human = human.required()?;
            let store = open(cli)?;
            let w = store.finish_work(
                id,
                &FinishWork {
                    agent: agent.agent.clone(),
                    outcome,
                    human,
                    files: files.clone(),
                    refs: refs.clone(),
                    finished_at: finished_at.clone(),
                    started_at: started_at.clone(),
                },
            )?;
            if cli.json {
                return print_json(&w);
            }
            println!("Completed {}  {}", w.id, w.record.meta.title);
            println!(
                "  started {}  finished {}",
                w.record.meta.started,
                w.record.meta.finished.as_deref().unwrap_or("—")
            );
            if !w.record.meta.files.is_empty() {
                println!("  files: {}", w.record.meta.files.join(", "));
            }
            println!("  {}", w.path);
            Ok(())
        }
        WorkCmd::List { status, agent, tag } => {
            let store = open(cli)?;
            let mut works = store.worklogs()?;
            if let Some(s) = status {
                let want = agentmon_core::parse_work_status(s)?;
                works.retain(|w| w.meta.status == want);
            }
            if let Some(a) = agent {
                works.retain(|w| w.meta.agent.eq_ignore_ascii_case(a));
            }
            if let Some(t) = tag {
                works.retain(|w| w.meta.tags.iter().any(|x| x.eq_ignore_ascii_case(t)));
            }
            if cli.json {
                return print_json(&works);
            }
            if works.is_empty() {
                println!("No work logs match in {}. Start one:", store.root().display());
                println!(
                    "  agentmon work start --agent <you> --title \"<title>\" --body \"...\" \
                     --human \"...\""
                );
                return Ok(());
            }
            println!(
                "{:<10} {:<12} {:<18} {:<20}  TITLE",
                "ID", "STATUS", "AGENT", "UPDATED"
            );
            for w in &works {
                println!(
                    "{:<10} {:<12} {:<18} {:<20}  {}",
                    w.meta.id,
                    w.meta.status.as_str(),
                    clip(&w.meta.agent, 18),
                    w.last_activity,
                    w.meta.title
                );
            }
            let open_n = works
                .iter()
                .filter(|w| w.meta.status == WorkStatus::InProgress)
                .count();
            println!("\n{} work log(s), {} in progress", works.len(), open_n);
            Ok(())
        }
        WorkCmd::View { id } => {
            let store = open(cli)?;
            let w = store.worklog(id)?;
            if cli.json {
                return print_json(&w);
            }
            println!("{}  {}", w.meta.id, w.meta.title);
            println!(
                "{} · {} · started {}{}",
                w.meta.agent,
                w.meta.status.as_str(),
                w.meta.started,
                w.meta
                    .finished
                    .as_ref()
                    .map(|f| format!(" · finished {f}"))
                    .unwrap_or_default()
            );
            if !w.meta.tags.is_empty() {
                println!("tags: {}", w.meta.tags.join(", "));
            }
            if !w.meta.refs.is_empty() {
                println!("refs: {}", w.meta.refs.join(", "));
            }
            if !w.meta.files.is_empty() {
                println!("files: {}", w.meta.files.join(", "));
            }
            println!("\n{}", w.body);
            print_human(w.human.as_deref(), &w.meta.id, "work update");
            Ok(())
        }
    }
}

/// Print the record's human area under its own heading, or say plainly that it has none
/// and name the command that adds one.
///
/// The empty state is the point: a record that speaks only to agents is not finished, and
/// the reader of `agentmon <kind> view` is exactly who can fix that.
fn print_human(human: Option<&str>, id: &str, verb: &str) {
    match human {
        Some(text) => println!("\n## For humans\n\n{text}"),
        None => {
            println!("\n## For humans\n\n(none yet — this record speaks only to agents)");
            println!(
                "Add one:  agentmon {verb} {id} --agent <you> --human \"<retelling>\"   \
                 (agentmon human-style)"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// bugs
// ---------------------------------------------------------------------------

fn run_bug(cli: &Cli, cmd: &BugCmd) -> CliResult {
    match cmd {
        BugCmd::Create {
            agent,
            title,
            severity,
            body,
            body_file,
            human,
            labels,
            refs,
            created_at,
        } => {
            let severity: Severity = agentmon_core::parse_severity(severity)?;
            one_stdin(&[
                ("--body-file", body_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            let body = read_text(
                body.as_deref(),
                body_file.as_deref(),
                BodySource {
                    what: "bug report",
                    inline_flag: "--body",
                    file_flag: "--body-file",
                    template: validate::BUG_TEMPLATE,
                    example: validate::BUG_EXAMPLE,
                },
            )?;
            let human = human.required()?;
            let store = open(cli)?;
            let b = store.create_bug(&NewBug {
                agent: agent.agent.clone(),
                title: title.clone(),
                severity,
                labels: labels.clone(),
                refs: refs.clone(),
                body,
                human,
                created_at: created_at.clone(),
            })?;
            if cli.json {
                return print_json(&b);
            }
            println!(
                "Filed {}  [{}]  {}",
                b.id,
                b.record.meta.severity.as_str(),
                b.record.meta.title
            );
            println!("  {}", b.path);
            println!();
            println!("Next:");
            println!("  agentmon bug claim {} --agent {}", b.id, agent.agent);
            Ok(())
        }
        BugCmd::Claim {
            id,
            agent,
            human,
            at,
        } => {
            let human = human.read()?;
            let store = open(cli)?;
            let b = store.claim_bug(id, &agent.agent, human.as_deref(), at.as_deref())?;
            if cli.json {
                return print_json(&b);
            }
            println!(
                "Claimed {}  {}  (status {})",
                b.id,
                b.record.meta.title,
                b.record.meta.status.as_str()
            );
            println!("  {}", b.path);
            println!();
            println!("Next:");
            println!(
                "  agentmon bug comment {} --agent {} --message \"<root cause>\" \\\n    \
                 --human \"<that finding's own telling — it is appended to the page>\"",
                b.id, agent.agent
            );
            println!(
                "  agentmon bug resolve {} --agent {} --resolution \"<fix, why, verification>\" \\\n    \
                 --human \"<what is different now, for a reader who does not program>\"",
                b.id, agent.agent
            );
            Ok(())
        }
        BugCmd::Comment {
            id,
            agent,
            message,
            body_file,
            human,
            replayed,
            at,
        } => {
            one_stdin(&[
                ("--body-file", body_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            // `--human` alone is a refresh: it rewrites the human area and adds nothing to
            // the thread. Core refuses the case where neither was passed.
            let message = match (message.as_deref(), body_file.as_deref()) {
                (None, None) => None,
                (inline, file) => Some(read_text(
                    inline,
                    file,
                    BodySource {
                        what: "bug comment",
                        inline_flag: "--message",
                        file_flag: "--body-file (or --message-file)",
                        template: "A sentence or two: what you found, what you tried, what it \
                                   means for the fix.",
                        example: "agentmon bug comment BUG-0002 \\\n  \
                                  --agent cli-builder \\\n  --message \"Root cause: setup() \
                                  never started a watcher, so project-changed was never \
                                  emitted.\" \\\n  --human \"The app never heard about saved \
                                  files because its watcher was never switched on.\"",
                    },
                )?),
            };
            let human = human.read()?;
            let store = open(cli)?;
            let b = if *replayed {
                let (Some(message), Some(at)) = (message.as_deref(), at.as_deref()) else {
                    return Err(replay_usage("bug comment"));
                };
                store.replay_bug_comment(id, &agent.agent, message, human.as_deref(), at)?
            } else {
                store.comment_bug(
                    id,
                    &agent.agent,
                    message.as_deref(),
                    human.as_deref(),
                    at.as_deref(),
                )?
            };
            if cli.json {
                return print_json(&b);
            }
            if *replayed {
                println!("Replayed a comment onto {} at {}", b.id, b.event.ts);
                println!("  inserted in timeline order; the event summary says \"Replayed:\"");
            } else if message.is_none() {
                println!("Rewrote the human area of {}", b.id);
                println!("  ## Comments is untouched; the feed logs human_updated");
            } else {
                let n = b.record.comments.len();
                println!(
                    "Commented on {}  ({} comment{} now)",
                    b.id,
                    n,
                    if n == 1 { "" } else { "s" }
                );
            }
            println!("  {}", b.path);
            Ok(())
        }
        BugCmd::Resolve {
            id,
            agent,
            resolution,
            resolution_file,
            human,
            at,
        } => {
            one_stdin(&[
                (
                    "--resolution-file",
                    resolution_file.as_deref().map(is_stdin).unwrap_or(false),
                ),
                ("--human-file", human.wants_stdin()),
            ])?;
            let resolution = read_text(
                resolution.as_deref(),
                resolution_file.as_deref(),
                BodySource {
                    what: "resolution",
                    inline_flag: "--resolution",
                    file_flag: "--resolution-file",
                    template: validate::RESOLUTION_TEMPLATE,
                    example: validate::RESOLUTION_EXAMPLE,
                },
            )?;
            let human = human.required()?;
            let store = open(cli)?;
            let b = store.resolve_bug(id, &agent.agent, &resolution, &human, at.as_deref())?;
            if cli.json {
                return print_json(&b);
            }
            println!("Resolved {}  {}", b.id, b.record.meta.title);
            println!(
                "  reported by {} on {} · resolved by {} on {}",
                b.record.meta.reporter,
                b.record.meta.created,
                b.record.meta.resolved_by.as_deref().unwrap_or("—"),
                b.record.meta.resolved.as_deref().unwrap_or("—")
            );
            println!("  {}", b.path);
            Ok(())
        }
        BugCmd::List {
            status,
            severity,
            label,
            assignee,
        } => {
            let store = open(cli)?;
            let mut bugs = store.bugs()?;
            if let Some(s) = status {
                let want = agentmon_core::parse_bug_status(s)?;
                bugs.retain(|b| b.meta.status == want);
            }
            if let Some(s) = severity {
                let want = agentmon_core::parse_severity(s)?;
                bugs.retain(|b| b.meta.severity == want);
            }
            if let Some(l) = label {
                bugs.retain(|b| b.meta.labels.iter().any(|x| x.eq_ignore_ascii_case(l)));
            }
            if let Some(a) = assignee {
                bugs.retain(|b| {
                    b.meta
                        .assignee
                        .as_deref()
                        .map(|x| x.eq_ignore_ascii_case(a))
                        .unwrap_or(false)
                });
            }
            if cli.json {
                return print_json(&bugs);
            }
            if bugs.is_empty() {
                println!("No bugs match in {}.", store.root().display());
                return Ok(());
            }
            println!(
                "{:<9} {:<9} {:<12} {:<18} {:<20}  TITLE",
                "ID", "SEVERITY", "STATUS", "ASSIGNEE", "UPDATED"
            );
            for b in &bugs {
                println!(
                    "{:<9} {:<9} {:<12} {:<18} {:<20}  {}",
                    b.meta.id,
                    b.meta.severity.as_str(),
                    b.meta.status.as_str(),
                    clip(b.meta.assignee.as_deref().unwrap_or("—"), 18),
                    b.last_activity,
                    b.meta.title
                );
            }
            let open_n = bugs.iter().filter(|b| b.meta.status.is_open()).count();
            println!("\n{} bug(s), {} still open", bugs.len(), open_n);
            Ok(())
        }
        BugCmd::View { id } => {
            let store = open(cli)?;
            let b = store.bug(id)?;
            if cli.json {
                return print_json(&b);
            }
            println!("{}  {}", b.meta.id, b.meta.title);
            println!(
                "{} · {} · reported by {} on {}",
                b.meta.severity.as_str(),
                b.meta.status.as_str(),
                b.meta.reporter,
                b.meta.created
            );
            if let Some(a) = &b.meta.assignee {
                println!("assignee: {a}");
            }
            if !b.meta.labels.is_empty() {
                println!("labels: {}", b.meta.labels.join(", "));
            }
            if !b.meta.refs.is_empty() {
                println!("refs: {}", b.meta.refs.join(", "));
            }
            println!("\n{}", b.body);
            print_human(b.human.as_deref(), &b.meta.id, "bug comment");
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

fn run_note(cli: &Cli, cmd: &NoteCmd) -> CliResult {
    match cmd {
        NoteCmd::Add {
            agent,
            title,
            note_type,
            description,
            name,
            body,
            body_file,
            human,
            tags,
            refs,
            at,
        } => {
            let note_type: NoteType = agentmon_core::parse_note_type(note_type)?;
            one_stdin(&[
                ("--body-file", body_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            let body = read_text(
                body.as_deref(),
                body_file.as_deref(),
                BodySource {
                    what: "note body",
                    inline_flag: "--body",
                    file_flag: "--body-file",
                    template: validate::NOTE_TEMPLATE,
                    example: validate::NOTE_EXAMPLE,
                },
            )?;
            let human = human.required()?;
            let store = open(cli)?;
            let n = store.add_note(&NewNote {
                agent: agent.agent.clone(),
                name: name.clone(),
                title: title.clone(),
                note_type,
                description: description.clone(),
                tags: tags.clone(),
                refs: refs.clone(),
                body,
                human,
                at: at.clone(),
            })?;
            if cli.json {
                return print_json(&n);
            }
            println!(
                "Added note {}  [{}]  {}",
                n.id,
                n.record.meta.note_type.as_str(),
                n.record.meta.title
            );
            println!("  {}", n.path);
            println!();
            println!("Next:");
            println!(
                "  agentmon note update {} --agent {} --body-file <file> --human \"<retelling>\"   \
                 # when it changes",
                n.id, agent.agent
            );
            println!("  agentmon note list   # what the project already knows");
            Ok(())
        }
        NoteCmd::Update {
            name,
            agent,
            title,
            note_type,
            description,
            tags,
            refs,
            body,
            body_file,
            human,
            at,
        } => {
            let note_type = note_type
                .as_deref()
                .map(agentmon_core::parse_note_type)
                .transpose()?;
            one_stdin(&[
                ("--body-file", body_file.as_deref().map(is_stdin).unwrap_or(false)),
                ("--human-file", human.wants_stdin()),
            ])?;
            // Unlike the required bodies above, an update without a body is a metadata
            // edit — so only read a body when one of the two flags was actually passed.
            let body = match (body.as_deref(), body_file.as_deref()) {
                (None, None) => None,
                (inline, file) => Some(read_text(
                    inline,
                    file,
                    BodySource {
                        what: "note body",
                        inline_flag: "--body",
                        file_flag: "--body-file",
                        template: validate::NOTE_TEMPLATE,
                        example: validate::NOTE_EXAMPLE,
                    },
                )?),
            };
            let human = human.read()?;
            let store = open(cli)?;
            // An essential note is required session-start reading, pinned first in every
            // list — and --type taking that away is how an index once fell out of the
            // front of the list unnoticed (FB-0001). Honor the flag, but say it back.
            let demotes_essential = note_type
                .is_some_and(|t| t != NoteType::Essential)
                && store.note(name)?.meta.note_type == NoteType::Essential;
            let n = store.update_note(
                name,
                &UpdateNote {
                    agent: agent.agent.clone(),
                    title: title.clone(),
                    note_type,
                    description: description.clone(),
                    tags: tags.clone(),
                    refs: refs.clone(),
                    body,
                    human,
                    at: at.clone(),
                },
            )?;
            let warning = demotes_essential.then(|| {
                format!(
                    "warning: this note was essential — required session-start reading, \
                     listed first. It is now {}. If that was not meant: agentmon note \
                     update {} --type essential",
                    n.record.meta.note_type.as_str(),
                    n.id
                )
            });
            if cli.json {
                // stdout is the JSON envelope; the warning must not corrupt it.
                if let Some(w) = warning {
                    eprintln!("{w}");
                }
                return print_json(&n);
            }
            println!("Updated note {}  {}", n.id, n.record.meta.title);
            println!("  {}", n.event.summary);
            if let Some(w) = warning {
                println!("  {w}");
            }
            println!("  {}", n.path);
            Ok(())
        }
        NoteCmd::Remove { name, agent, at } => {
            let store = open(cli)?;
            let gone = store.remove_note(name, &agent.agent, at.as_deref())?;
            if cli.json {
                return print_json(&gone);
            }
            println!("Removed note {}  {}", gone.name, gone.record.title);
            println!("  the note_removed event keeps the trail on the feed");
            Ok(())
        }
        NoteCmd::List {
            note_type,
            tag,
            agent,
            search,
        } => {
            let store = open(cli)?;
            let mut notes = store.notes()?;
            if let Some(t) = note_type {
                let want = agentmon_core::parse_note_type(t)?;
                notes.retain(|n| n.meta.note_type == want);
            }
            if let Some(t) = tag {
                notes.retain(|n| n.meta.tags.iter().any(|x| x.eq_ignore_ascii_case(t)));
            }
            if let Some(a) = agent {
                notes.retain(|n| n.meta.agent.eq_ignore_ascii_case(a));
            }
            if let Some(q) = search {
                let q = q.to_lowercase();
                notes.retain(|n| {
                    format!(
                        "{} {} {} {}",
                        n.meta.name, n.meta.title, n.meta.description, n.search_text
                    )
                    .to_lowercase()
                    .contains(&q)
                });
            }
            if cli.json {
                return print_json(&notes);
            }
            if notes.is_empty() {
                println!("No notes match in {}.", store.root().display());
                println!();
                println!("Leave the first one:");
                println!(
                    "  agentmon note add --agent <you> --type memory --title \"<fact>\" \\"
                );
                println!(
                    "    --description \"<one line>\" --body \"...\" --human \"<retelling>\""
                );
                return Ok(());
            }
            let essentials = notes
                .iter()
                .filter(|n| n.meta.note_type == agentmon_core::NoteType::Essential)
                .count();
            if essentials > 0 {
                // The list opens with the reading contract, not just rows: essential
                // notes are what a session must read before working.
                println!(
                    "{essentials} essential note(s) — required reading before you start work.\n"
                );
            }
            for n in &notes {
                // The agent shown is whoever the current words belong to — the last
                // rewriter, else the author — because it sits beside the updated time.
                println!(
                    "{:<32} {:<10} {:<16} {}",
                    clip(&n.meta.name, 32),
                    n.meta.note_type.as_str(),
                    clip(n.meta.current_agent(), 16),
                    n.last_activity
                );
                println!("  {}", clip(&n.meta.description, 96));
            }
            println!("\n{} note(s). Read one: agentmon note view <name>", notes.len());
            Ok(())
        }
        NoteCmd::View { name } => {
            let store = open(cli)?;
            let n = store.note(name)?;
            if cli.json {
                return print_json(&n);
            }
            println!("{}  [{}]  {}", n.meta.name, n.meta.note_type.as_str(), n.meta.title);
            println!("{}", n.meta.description);
            println!(
                "by {} · created {} · updated {}{}",
                n.meta.agent,
                n.meta.created,
                n.meta.updated,
                match n.meta.updated_by.as_deref() {
                    Some(editor) if editor != n.meta.agent => format!(" by {editor}"),
                    _ => String::new(),
                }
            );
            if !n.meta.tags.is_empty() {
                println!("tags: {}", n.meta.tags.join(", "));
            }
            if !n.meta.refs.is_empty() {
                println!("refs: {}", n.meta.refs.join(", "));
            }
            println!("\n{}", n.body);
            print_human(n.human.as_deref(), &n.meta.name, "note update");
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// status / doctor
// ---------------------------------------------------------------------------

/// `agentmon human-style` — the write-time reading, carried inside the binary.
///
/// Embedded rather than read off disk on purpose: an agent writing a record from an
/// installed app, or from a repo that never shipped docs/, still gets the contract, and
/// the compact rules every rejection prints are cut from this same text at build time.
fn cmd_human_style(cli: &Cli) -> CliResult {
    if cli.json {
        return print_json(&serde_json::json!({
            "ok": true,
            "style": agentmon_core::HUMAN_STYLE,
            "compactRules": agentmon_core::HUMAN_COMPACT_RULES,
        }));
    }
    println!("{}", agentmon_core::HUMAN_STYLE.trim_end());
    Ok(())
}

fn cmd_status(cli: &Cli, json: bool) -> CliResult {
    let store = open(cli)?;
    let snap = store.status()?;
    if json {
        return print_json(&snap);
    }
    let c = &snap.project.counts;
    println!("{}", snap.project.name);
    println!("{}", store.root().display());
    println!();
    println!(
        "work   {} in progress · {} done · {} total",
        c.work_in_progress, c.work_done, c.work_total
    );
    let mut by_sev: Vec<(&str, usize)> = Vec::new();
    for sev in [
        Severity::Critical,
        Severity::High,
        Severity::Medium,
        Severity::Low,
    ] {
        let n = snap
            .open_bugs
            .iter()
            .filter(|b| b.meta.severity == sev)
            .count();
        if n > 0 {
            by_sev.push((sev.as_str(), n));
        }
    }
    let sev_text = if by_sev.is_empty() {
        String::new()
    } else {
        format!(
            "  ({})",
            by_sev
                .iter()
                .map(|(s, n)| format!("{n} {s}"))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    println!(
        "bugs   {} open · {} total{}",
        c.bugs_open, c.bugs_total, sev_text
    );
    println!("notes  {} (agentmon note list)", c.notes_total);

    if !snap.active_work.is_empty() {
        println!("\nACTIVE WORK");
        for w in &snap.active_work {
            println!(
                "  {:<10} {:<18} {}",
                w.meta.id,
                clip(&w.meta.agent, 18),
                w.meta.title
            );
        }
    }
    if !snap.open_bugs.is_empty() {
        println!("\nOPEN BUGS");
        for b in &snap.open_bugs {
            println!(
                "  {:<9} {:<9} {:<18} {}",
                b.meta.id,
                b.meta.severity.as_str(),
                clip(b.meta.assignee.as_deref().unwrap_or("unassigned"), 18),
                b.meta.title
            );
        }
    }
    if !snap.recent_notes.is_empty() {
        println!("\nLATEST NOTES  (agentmon note view <name>)");
        for n in &snap.recent_notes {
            println!(
                "  {:<10} {:<30} {}",
                n.meta.note_type.as_str(),
                clip(&n.meta.name, 30),
                clip(&n.meta.description, 60)
            );
        }
    }
    if !snap.agents.is_empty() {
        println!("\nAGENTS");
        for a in snap.agents.iter().take(8) {
            println!(
                "  {:<20} {} in progress · {} done · {} bugs filed · {} resolved",
                clip(&a.agent, 20),
                a.in_progress,
                a.done,
                a.bugs_reported,
                a.bugs_resolved
            );
        }
    }
    if !snap.recent_events.is_empty() {
        println!("\nRECENT ACTIVITY");
        for e in snap.recent_events.iter().take(10) {
            println!(
                "  {}  {:<15} {:<10} {}",
                e.ts,
                e.event_type,
                e.r#ref.as_deref().unwrap_or(""),
                clip(&e.summary, 76)
            );
        }
    }
    Ok(())
}

fn cmd_doctor(cli: &Cli, strict: bool, json: bool) -> CliResult {
    let store = open(cli)?;
    let report = doctor::check(&store)?;
    let errors = report.errors();
    let warnings = report.warnings();
    let failed = errors > 0 || (strict && warnings > 0);

    if json {
        let payload = serde_json::json!({
            "ok": !failed,
            "report": report,
            "errors": errors,
            "warnings": warnings,
        });
        println!("{}", serde_json::to_string_pretty(&payload).unwrap());
    } else {
        println!(
            "{} — {} work log(s), {} bug(s), {} note(s), {} event(s)",
            report.path, report.worklogs, report.bugs, report.notes, report.events
        );
        // Printed before the problem list and outside it: these are not problems — a note
        // in the project accounts for each one — but the feed is still claiming a progress
        // note the record does not hold, and that fact does not stop being true because
        // someone wrote it down. Every run says so, so nobody rediscovers it as news.
        if !report.reconciled_events.is_empty() {
            println!(
                "\n{} event(s) announce a progress note their record does not hold, each \
                 accounted for in the {} note: {}",
                report.reconciled_events.len(),
                doctor::RECONCILE_NOTE,
                report.reconciled_events.join(", ")
            );
        }
        if report.problems.is_empty() {
            println!("\nNo problems found.");
        } else {
            println!();
            for p in &report.problems {
                let level = match p.level {
                    doctor::Level::Error => "error",
                    doctor::Level::Warning => "warning",
                };
                println!("{level:<8} {}", p.scope);
                println!("         {}", p.message);
                println!("         fix: {}", p.fix);
            }
            println!(
                "\n{errors} error(s), {warnings} warning(s) in {} record(s) checked",
                report.records_checked()
            );
        }
    }

    if failed {
        Err(CliError {
            code: exit::PROBLEMS,
            kind: "project_problems",
            message: format!(
                "{errors} error(s) and {warnings} warning(s) in {}. Fix them and re-run \
                 `agentmon doctor`.",
                report.path
            ),
        })
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// app feedback (machine-level — no store, no --dir)
// ---------------------------------------------------------------------------

fn run_app_feedback(cli: &Cli, cmd: &AppFeedbackCmd) -> CliResult {
    match cmd {
        AppFeedbackCmd::Add {
            r#type,
            title,
            body,
            agent,
            human,
            at,
        } => {
            let human = human.required()?;
            let item = agentmon_core::add_feedback(&agentmon_core::NewFeedback {
                kind: agentmon_core::parse_feedback_kind(r#type)?,
                title: title.clone(),
                body: body.clone().unwrap_or_default(),
                human,
                agent: agent.agent.clone(),
                at: at.clone(),
            })?;
            if cli.json {
                return print_json(&item);
            }
            println!("Filed {}  {}", item.id, item.title);
            if let Some(dir) = agentmon_core::feedback_dir() {
                println!("  {}", dir.join(format!("{}.md", item.id)).display());
            }
            println!("  the human reads these on the app's App feedback board");
            Ok(())
        }
        AppFeedbackCmd::Update {
            id,
            agent,
            human,
            at,
        } => {
            let human = human.required()?;
            let item =
                agentmon_core::set_feedback_human(id, &agent.agent, &human, at.as_deref())?;
            if cli.json {
                return print_json(&item);
            }
            println!("Rewrote the human area of {}  {}", item.id, item.title);
            if let Some(dir) = agentmon_core::feedback_dir() {
                println!("  {}", dir.join(format!("{}.md", item.id)).display());
            }
            Ok(())
        }
        AppFeedbackCmd::List { status, r#type } => {
            let status = status
                .as_deref()
                .map(agentmon_core::parse_feedback_status)
                .transpose()?;
            let kind = r#type
                .as_deref()
                .map(agentmon_core::parse_feedback_kind)
                .transpose()?;
            let items: Vec<_> = agentmon_core::list_feedback()?
                .into_iter()
                .filter(|f| status.is_none_or(|s| f.status == s))
                .filter(|f| kind.is_none_or(|k| f.kind == k))
                .collect();
            if cli.json {
                return print_json(&items);
            }
            if items.is_empty() {
                println!("No app feedback. File some: agentmon app-feedback add --help");
                return Ok(());
            }
            for f in &items {
                println!(
                    "{:<8} {:<5} {:<5} {}  ({}, {})",
                    f.id,
                    f.kind.as_str(),
                    f.status.as_str(),
                    f.title,
                    f.agent,
                    &f.created[..10.min(f.created.len())],
                );
            }
            println!("\n{} item(s). Read one: agentmon app-feedback view <FB-ID>", items.len());
            Ok(())
        }
        AppFeedbackCmd::View { id } => {
            let f = agentmon_core::view_feedback(id)?;
            if cli.json {
                return print_json(&f);
            }
            println!("{}  {}", f.id, f.title);
            println!("{} · {} · filed by {} on {}", f.kind.as_str(), f.status.as_str(), f.agent, f.created);
            if let Some(done) = &f.done {
                println!("handled on {done}");
            }
            if let Some(updated) = &f.updated {
                println!("retold on {updated}");
            }
            if !f.body.is_empty() {
                println!("\n{}", f.body);
            }
            print_human(f.human.as_deref(), &f.id, "app-feedback update");
            Ok(())
        }
        AppFeedbackCmd::Done { id } => {
            let f = agentmon_core::set_feedback_status(id, agentmon_core::FeedbackStatus::Done)?;
            if cli.json {
                return print_json(&f);
            }
            println!("Done {}  {}", f.id, f.title);
            Ok(())
        }
        AppFeedbackCmd::Reopen { id } => {
            let f = agentmon_core::set_feedback_status(id, agentmon_core::FeedbackStatus::Open)?;
            if cli.json {
                return print_json(&f);
            }
            println!("Reopened {}  {}", f.id, f.title);
            Ok(())
        }
        AppFeedbackCmd::Delete { id } => {
            let f = agentmon_core::delete_feedback(id)?;
            if cli.json {
                return print_json(&f);
            }
            println!("Deleted {}  {}", f.id, f.title);
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

fn open(cli: &Cli) -> std::result::Result<Store, CliError> {
    Ok(Store::resolve(cli.dir.as_deref())?)
}

fn print_json<T: serde::Serialize>(value: &T) -> CliResult {
    let text = serde_json::to_string_pretty(value).map_err(|e| CliError {
        code: exit::IO,
        kind: "io_error",
        message: format!("could not serialize output: {e}"),
    })?;
    println!("{text}");
    Ok(())
}

/// `work start --finished-at ...` is a guess an agent makes when it is recording work it
/// already did. Answer with the two commands that do what it meant.
fn finished_at_on_start(finished: &str) -> CliError {
    CliError {
        code: exit::USAGE,
        kind: "invalid_argument",
        message: format!(
            "--finished-at is not a flag of `work start`: a work log gains its end time when \
             it is closed.\n\nRecord work that is already over in two steps:\n\n  \
             agentmon work start ... --started-at <when it began>       # prints the new id\n  \
             agentmon work done <ID> ... --finished-at {finished} \\\n    --outcome \"<what \
             shipped, how it was verified>\" \\\n    --human \"<the same, for a reader who \
             does not program>\""
        ),
    }
}

/// `--replayed` without the two flags that make a replay a replay. Reconstruction writes
/// history back at its real time, so a replay with no time — or with nothing to say — is a
/// call written wrong, refused before anything opens the project.
fn replay_usage(verb: &str) -> CliError {
    CliError {
        code: exit::USAGE,
        kind: "invalid_argument",
        message: format!(
            "--replayed is for reconstruction: it writes the lost original back at the time \
             it really happened, so it needs both --at <that time> and --message/--message-file \
             <the original text> — and, like every --message, the --human telling with \
             it.\n\n  agentmon {verb} <ID> --agent <you> --replayed \\\n    \
             --at 2026-08-22T10:05:00Z --message \"<the lost text, verbatim>\" \\\n    \
             --human \"<that entry's own telling>\"\n\nWithout \
             --replayed the normal ordering guard applies, which is what you want on any \
             write that is not rebuilding a lost record (docs/AGENT_MANUAL.md, \"Two \
             machines, one repo\")."
        ),
    }
}

impl HumanArg {
    /// The human area as text, or `None` when neither flag was passed.
    ///
    /// Absent is *not* rejected here: which verbs require one is core's rule (SPEC.md's
    /// matrix), and core's refusal is the one that carries the style contract. The CLI
    /// only turns two flags into one string.
    fn read(&self) -> std::result::Result<Option<String>, CliError> {
        match (self.human.as_deref(), self.human_file.as_deref()) {
            (None, None) => Ok(None),
            (inline, file) => Ok(Some(read_text(
                inline,
                file,
                BodySource {
                    what: "human area",
                    inline_flag: "--human",
                    file_flag: "--human-file",
                    template: "The same work retold for a reader who was not there and does \
                               not program.\nRun `agentmon human-style` for the contract.",
                    example: "agentmon work done WORK-0003 --agent cli-builder \\\n  \
                              --outcome \"...\" \\\n  --human \"The app used to lose a record \
                              when two agents started work in the same second. It does not \
                              any more: ...\"",
                },
            )?)),
        }
    }

    /// What core needs for a verb that requires one: the empty string when nothing was
    /// passed, so the refusal (and the style rules with it) comes from core.
    fn required(&self) -> std::result::Result<String, CliError> {
        Ok(self.read()?.unwrap_or_default())
    }

    /// Is this asking to read stdin?
    fn wants_stdin(&self) -> bool {
        self.human_file.as_deref().map(is_stdin).unwrap_or(false)
    }
}

fn is_stdin(path: &Path) -> bool {
    path.as_os_str() == "-"
}

/// Refuse a command that asks two different flags to read stdin.
///
/// Only one of them could win: the first read drains the pipe and the second silently gets
/// an empty string, which would land as an empty body or an empty human area — a record
/// written wrong by a command that looked like it worked.
fn one_stdin(flags: &[(&str, bool)]) -> std::result::Result<(), CliError> {
    let asking: Vec<&str> = flags
        .iter()
        .filter(|(_, yes)| *yes)
        .map(|(name, _)| *name)
        .collect();
    if asking.len() < 2 {
        return Ok(());
    }
    Err(CliError {
        code: exit::USAGE,
        kind: "invalid_argument",
        message: format!(
            "{} both ask to read stdin ('-'), and stdin can be read only once — whichever \
             was read second would land empty.\n\nGive one of them another source: inline \
             text (--human \"<text>\") or a real file (--body-file notes.md), and keep '-' \
             for the other.",
            asking.join(" and ")
        ),
    })
}

/// Everything needed to explain how to supply a missing body.
struct BodySource {
    what: &'static str,
    inline_flag: &'static str,
    file_flag: &'static str,
    template: &'static str,
    example: &'static str,
}

/// Read prose from `--x` or `--x-file` (where `-` means stdin).
fn read_text(
    inline: Option<&str>,
    file: Option<&Path>,
    src: BodySource,
) -> std::result::Result<String, CliError> {
    if let Some(text) = inline {
        return Ok(text.to_string());
    }
    if let Some(path) = file {
        if path.as_os_str() == "-" {
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf).map_err(|e| CliError {
                code: exit::IO,
                kind: "io_error",
                message: format!("could not read the {} from stdin: {e}", src.what),
            })?;
            return Ok(buf);
        }
        return std::fs::read_to_string(path).map_err(|e| CliError {
            code: exit::IO,
            kind: "io_error",
            message: format!(
                "could not read {} from {}: {e}\n\nCheck the path, or pass the text inline with \
                 {}.",
                src.what,
                path.display(),
                src.inline_flag
            ),
        });
    }
    Err(CliError {
        code: exit::USAGE,
        kind: "invalid_argument",
        message: format!(
            "no {what} supplied — pass {inline} \"<text>\" or {file} <path> (use {file} - to read \
             stdin).\n\nExpected structure:\n\n{template}\n\nExample that works (Git Bash):\n\n\
             {example}",
            what = src.what,
            inline = src.inline_flag,
            file = src.file_flag,
            template = indent(src.template, "    "),
            example = indent(src.example, "    "),
        ),
    })
}

fn indent(text: &str, pad: &str) -> String {
    text.lines()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                format!("{pad}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Clip to a column width without splitting a UTF-8 character.
fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Used by tests and by `--help` generation; keeps clap's derive honest.
#[allow(dead_code)]
fn command() -> clap::Command {
    Cli::command()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn every_command_documents_an_example() {
        // A subcommand without a worked example is a subcommand an agent will get wrong.
        fn walk(cmd: &clap::Command, path: &str) {
            let name = if path.is_empty() {
                cmd.get_name().to_string()
            } else {
                format!("{path} {}", cmd.get_name())
            };
            let leaf = cmd.get_subcommands().count() == 0;
            if leaf && cmd.get_name() != "help" {
                let help = cmd
                    .clone()
                    .render_long_help()
                    .to_string()
                    .to_ascii_lowercase();
                assert!(
                    help.contains("agentmon "),
                    "`{name}` has no example in its help"
                );
            }
            for sub in cmd.get_subcommands() {
                walk(sub, &name);
            }
        }
        walk(&Cli::command(), "");
    }

    #[test]
    fn exit_codes_are_distinct() {
        let codes = [
            exit::PROBLEMS,
            exit::USAGE,
            exit::NOT_FOUND,
            exit::INVALID_BODY,
            exit::CONFLICT,
            exit::INVALID_PROJECT,
            exit::IO,
        ];
        let mut sorted = codes.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), codes.len(), "exit codes must be distinct");
        assert!(!codes.contains(&0), "0 is reserved for success");
    }

    #[test]
    fn core_errors_map_to_the_documented_codes() {
        let cases: Vec<(CoreError, u8)> = vec![
            (
                CoreError::ProjectDirNotFound {
                    path: PathBuf::from("p"),
                    hint: "no project here".into(),
                },
                exit::NOT_FOUND,
            ),
            (
                CoreError::conflict("already done", "start a new one"),
                exit::CONFLICT,
            ),
            (
                CoreError::malformed("f.md", "bad frontmatter"),
                exit::INVALID_PROJECT,
            ),
            (
                CoreError::InvalidId {
                    id: "x".into(),
                    expected: "WORK-NNNN".into(),
                },
                exit::USAGE,
            ),
        ];
        for (err, want) in cases {
            let cli: CliError = err.into();
            assert_eq!(cli.code, want, "{}", cli.message);
        }
        let body_err: CliError = agentmon_core::validate::work_body("nope").unwrap_err().into();
        assert_eq!(body_err.code, exit::INVALID_BODY);
        assert_eq!(body_err.kind, "invalid_body");

        // A missing human area is exit 2 (SPEC.md), and its message carries the contract.
        let human_err: CliError = agentmon_core::human::require("", "this work log")
            .unwrap_err()
            .into();
        assert_eq!(human_err.code, exit::USAGE);
        assert_eq!(human_err.kind, "invalid_argument");
        assert!(human_err.message.contains("--human"), "{}", human_err.message);
        assert!(
            human_err.message.contains("agentmon human-style"),
            "{}",
            human_err.message
        );
    }

    /// Walk to a subcommand by path, e.g. `["work", "done"]`.
    fn sub(path: &[&str]) -> clap::Command {
        let mut cmd = Cli::command();
        for name in path {
            let next = cmd
                .get_subcommands()
                .find(|c| c.get_name() == *name)
                .unwrap_or_else(|| panic!("`agentmon {}` exists", path.join(" ")))
                .clone();
            cmd = next;
        }
        cmd
    }

    fn has_flag(path: &[&str], long: &str) -> bool {
        sub(path).get_arguments().any(|a| {
            a.get_long() == Some(long)
                || a.get_all_aliases()
                    .map(|al| al.iter().any(|x| *x == long))
                    .unwrap_or(false)
        })
    }

    #[test]
    fn json_is_global_so_placement_never_matters() {
        for args in [
            vec!["agentmon", "--json", "work", "list"],
            vec!["agentmon", "work", "list", "--json"],
            vec!["agentmon", "work", "--json", "list"],
        ] {
            let cli = Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
            assert!(cli.json, "{args:?}");
        }
        let cli = Cli::try_parse_from(["agentmon", "work", "list"]).unwrap();
        assert!(!cli.json, "--json is opt-in");
        // and the same is true of --dir, which agents write in both places
        for args in [
            vec!["agentmon", "--dir", "d", "status"],
            vec!["agentmon", "status", "--dir", "d"],
        ] {
            let cli = Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
            assert_eq!(cli.dir.as_deref(), Some(Path::new("d")), "{args:?}");
        }
    }

    #[test]
    fn there_is_no_project_flag_left_to_type() {
        // v2 resolves the project from the directory, like git. A stray -p in a script
        // must fail loudly at parse time, not be silently accepted.
        assert!(
            Cli::try_parse_from(["agentmon", "work", "list", "-p", "demo"]).is_err(),
            "-p must not parse"
        );
        assert!(
            Cli::try_parse_from(["agentmon", "status", "--project", "demo"]).is_err(),
            "--project must not parse"
        );
        assert!(
            Cli::try_parse_from(["agentmon", "work", "list", "--vault", "v"]).is_err(),
            "--vault is v1 and must not parse"
        );
    }

    #[test]
    fn every_mutation_accepts_the_time_it_really_happened() {
        // These pairs are the table in docs/AGENT_MANUAL.md ("Backdating"). If one is
        // renamed here, the manual is wrong and a fresh agent will paste a flag that
        // does not exist.
        let cases: &[(&[&str], &str)] = &[
            (&["init"], "at"),
            (&["project", "update"], "at"),
            (&["work", "start"], "started-at"),
            (&["work", "update"], "at"),
            (&["work", "done"], "finished-at"),
            (&["work", "done"], "started-at"),
            (&["work", "abandon"], "at"),
            (&["bug", "create"], "created-at"),
            (&["bug", "claim"], "at"),
            (&["bug", "comment"], "at"),
            (&["bug", "resolve"], "at"),
            (&["note", "add"], "at"),
            (&["note", "update"], "at"),
            (&["note", "remove"], "at"),
            (&["reconcile"], "at"),
        ];
        for (path, flag) in cases {
            assert!(
                has_flag(path, flag),
                "`agentmon {}` must accept --{flag}",
                path.join(" ")
            );
        }
    }

    /// SPEC.md's CLI block: `--human s | --human-file f` on every verb that creates,
    /// closes or rewrites a record — and nowhere else, because a flag that does nothing is
    /// a flag an agent will pass and wonder about.
    #[test]
    fn the_human_flags_are_on_exactly_the_verbs_that_take_one() {
        let takes: &[&[&str]] = &[
            &["work", "start"],
            &["work", "update"],
            &["work", "done"],
            &["work", "abandon"],
            &["bug", "create"],
            &["bug", "claim"],
            &["bug", "comment"],
            &["bug", "resolve"],
            &["note", "add"],
            &["note", "update"],
            &["app-feedback", "add"],
            &["app-feedback", "update"],
        ];
        for path in takes {
            assert!(has_flag(path, "human"), "`agentmon {}` takes --human", path.join(" "));
            assert!(
                has_flag(path, "human-file"),
                "`agentmon {}` takes --human-file",
                path.join(" ")
            );
        }
        // Removing a note writes no record, and neither does project metadata.
        for path in [
            vec!["note", "remove"],
            vec!["project", "update"],
            vec!["app-feedback", "done"],
        ] {
            assert!(!has_flag(&path, "human"), "`agentmon {}` has no --human", path.join(" "));
        }
    }

    /// Two flags reading `-` would leave the second one empty — a command that looks like
    /// it worked and wrote a record with a blank half.
    #[test]
    fn two_flags_cannot_both_read_stdin() {
        let err = one_stdin(&[("--body-file", true), ("--human-file", true)]).unwrap_err();
        assert_eq!(err.code, exit::USAGE);
        assert!(err.message.contains("--body-file"), "{}", err.message);
        assert!(err.message.contains("--human-file"), "{}", err.message);
        assert!(err.message.contains("stdin"), "{}", err.message);
        assert!(one_stdin(&[("--body-file", true), ("--human-file", false)]).is_ok());

        // …and a real command is refused before it reads a byte or opens a project.
        let cli = Cli::try_parse_from([
            "agentmon", "work", "start", "--agent", "a", "--title", "t", "--body-file", "-",
            "--human-file", "-",
        ])
        .expect("both flags parse, so the error can be a good one");
        let err = run(&cli).unwrap_err();
        assert_eq!(err.code, exit::USAGE);
        assert!(err.message.contains("stdin"), "{}", err.message);
    }

    /// The style contract ships inside the binary, and the compact rules every rejection
    /// prints are cut out of the same text at build time.
    #[test]
    fn human_style_is_embedded_and_printable() {
        let cli = Cli::try_parse_from(["agentmon", "human-style"]).unwrap();
        assert!(run(&cli).is_ok());
        assert!(agentmon_core::HUMAN_STYLE.contains("<!-- compact-rules -->"));
        assert!(!agentmon_core::HUMAN_COMPACT_RULES.trim().is_empty());
        assert!(agentmon_core::HUMAN_STYLE.contains(agentmon_core::HUMAN_COMPACT_RULES.trim()));
    }

    /// `--replayed` lives on exactly the two verbs whose entries have a timeline to replay
    /// into — and a replay without its time or its text is refused as usage, before any
    /// project is opened, with the recipe in the message.
    #[test]
    fn replayed_is_reconstruction_only_and_demands_at_and_message() {
        assert!(has_flag(&["work", "update"], "replayed"));
        assert!(has_flag(&["bug", "comment"], "replayed"));
        for path in [
            vec!["work", "start"],
            vec!["work", "done"],
            vec!["bug", "create"],
            vec!["bug", "resolve"],
            vec!["note", "update"],
        ] {
            assert!(
                !has_flag(&path, "replayed"),
                "`agentmon {}` has no --replayed",
                path.join(" ")
            );
        }
        for args in [
            // no --at: a replay without the real time is not a replay
            vec!["agentmon", "work", "update", "WORK-0001", "--agent", "a", "--replayed",
                 "--message", "The lost note."],
            // no --message: nothing to replay
            vec!["agentmon", "bug", "comment", "BUG-0001", "--agent", "a", "--replayed",
                 "--at", "2026-08-22T10:05:00Z"],
        ] {
            let cli = Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
            let err = run(&cli).unwrap_err();
            assert_eq!(err.code, exit::USAGE, "{args:?}");
            assert!(err.message.contains("--at"), "{}", err.message);
            assert!(err.message.contains("--message"), "{}", err.message);
        }
    }

    /// `reconcile` moves records without changing a word in them, so it takes no --human —
    /// and it never runs without being told where the incoming copy is.
    #[test]
    fn reconcile_needs_theirs_and_takes_no_human() {
        assert!(
            Cli::try_parse_from(["agentmon", "reconcile"]).is_err(),
            "--theirs is required"
        );
        assert!(!has_flag(&["reconcile"], "human"), "re-keying rewrites no prose");
        let cli = Cli::try_parse_from([
            "agentmon", "reconcile", "--theirs", "../incoming/AgentMonitoring",
            "--only", "WORK-0011,BUG-0006", "--apply",
        ])
        .unwrap();
        match cli.command {
            Command::Reconcile { only, apply, .. } => {
                assert_eq!(only, ["WORK-0011", "BUG-0006"]);
                assert!(apply);
            }
            other => panic!("unexpected parse: {other:?}"),
        }
    }

    #[test]
    fn message_file_is_the_same_flag_as_body_file() {
        for path in [
            vec!["agentmon", "work", "update", "WORK-0001"],
            vec!["agentmon", "bug", "comment", "BUG-0001"],
        ] {
            let mut args = path.clone();
            args.extend(["--agent", "a", "--message-file", "notes.md"]);
            let cli = Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
            let file = match cli.command {
                Command::Work(WorkCmd::Update { body_file, .. }) => body_file,
                Command::Bug(BugCmd::Comment { body_file, .. }) => body_file,
                other => panic!("unexpected parse: {other:?}"),
            };
            assert_eq!(file.as_deref(), Some(Path::new("notes.md")), "{args:?}");
        }
        assert!(has_flag(&["work", "update"], "body-file"), "--body-file still works");
        assert!(has_flag(&["bug", "comment"], "body-file"), "--body-file still works");
    }

    #[test]
    fn finished_at_on_work_start_points_at_the_two_step_recipe() {
        let cli = Cli::try_parse_from([
            "agentmon",
            "work",
            "start",
            "--agent",
            "a",
            "--title",
            "Something already finished",
            "--body",
            "## What\n\nx\n\n## Why\n\ny\n\n## How\n\nz",
            "--finished-at",
            "2026-08-18T11:30:00Z",
        ])
        .expect("--finished-at parses, so the error can be a good one");
        let err = run(&cli).unwrap_err();
        assert_eq!(err.code, exit::USAGE);
        assert!(err.message.contains("agentmon work done"), "{}", err.message);
        assert!(err.message.contains("--started-at"), "{}", err.message);
        assert!(err.message.contains("2026-08-18T11:30:00Z"), "{}", err.message);
    }

    #[test]
    fn missing_body_explains_both_ways_to_supply_one() {
        let err = read_text(
            None,
            None,
            BodySource {
                what: "work log body",
                inline_flag: "--body",
                file_flag: "--body-file",
                template: validate::WORK_TEMPLATE,
                example: validate::WORK_EXAMPLE,
            },
        )
        .unwrap_err();
        assert_eq!(err.code, exit::USAGE);
        assert!(err.message.contains("--body-file - to read stdin"), "{}", err.message);
        assert!(err.message.contains("## What"), "{}", err.message);
    }

    #[test]
    fn migrate_names_its_three_required_flags() {
        for missing in [
            vec!["agentmon", "migrate", "--project", "p", "--to", "t"],
            vec!["agentmon", "migrate", "--from", "f", "--to", "t"],
            vec!["agentmon", "migrate", "--from", "f", "--project", "p"],
        ] {
            assert!(Cli::try_parse_from(&missing).is_err(), "{missing:?}");
        }
        let cli = Cli::try_parse_from([
            "agentmon", "migrate", "--from", "f", "--project", "p", "--to", "t",
        ])
        .unwrap();
        assert!(matches!(cli.command, Command::Migrate { .. }));
    }
}
