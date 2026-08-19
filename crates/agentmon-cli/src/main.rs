//! `agentmon` — the agent-facing CLI.
//!
//! Design rules, because the reader of this file is usually about to add a command:
//!
//! * **This file is a wrapper.** Every rule about the vault (what a valid body is, which
//!   state transitions are legal, how ids are allocated) lives in `agentmon-core`. Here
//!   we parse arguments, choose an exit code, and print.
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
    doctor, validate, AbandonWork, CoreError, FinishWork, NewBug, NewProject, Severity, StartWork,
    UpdateProject, Vault, WorkStatus,
};
use clap::{Args, CommandFactory, Parser, Subcommand};

/// Exit codes. Stable across releases; documented in docs/AGENT_MANUAL.md.
mod exit {
    /// The vault has problems (`doctor`), or the command failed for a reason with no
    /// more specific code.
    pub const PROBLEMS: u8 = 1;
    /// Bad usage: unknown flag, missing argument, unparseable value. (clap uses this too.)
    pub const USAGE: u8 = 2;
    /// The vault, project or record does not exist.
    pub const NOT_FOUND: u8 = 3;
    /// The record body is missing required sections or says nothing.
    pub const INVALID_BODY: u8 = 4;
    /// The mutation is not legal in the record's current state (already done, already
    /// claimed, already exists), or another process holds the write lock.
    pub const CONFLICT: u8 = 5;
    /// The vault is there but corrupt: unparseable frontmatter, bad vault.json.
    pub const INVALID_VAULT: u8 = 6;
    /// Filesystem failure: permissions, disk, a path that vanished mid-write.
    pub const IO: u8 = 7;
}

const ROOT_AFTER_HELP: &str = "\
EXAMPLES
  agentmon work start -p agent-monitoring --agent cli-builder \\
      --title \"Wire the vault watcher into the desktop app\" \\
      --body \"$(cat <<'EOF'
  ## What
  ...
  ## Why
  ...
  ## How
  ...
  EOF
  )\"
  agentmon work done WORK-0003 -p agent-monitoring --agent cli-builder --outcome \"...\"
  agentmon bug list -p agent-monitoring --status open
  agentmon status -p agent-monitoring
  agentmon doctor

ALREADY FINISHED THE WORK?
  Record it after the fact — every mutation takes the time it really happened:
  agentmon work start -p <proj> --agent <you> --title \"...\" --body \"...\" \\
      --started-at 2026-08-18T09:12:00Z
  agentmon work done WORK-0007 -p <proj> --agent <you> --outcome \"...\" \\
      --finished-at 2026-08-18T11:30:00Z
  Also: --created-at on `bug create`, --at on work update/abandon and bug claim/comment/resolve.

VAULT RESOLUTION
  --vault <dir>  >  $AGENTMON_VAULT  >  ./vault (when it contains vault.json)

DEFAULTS FROM THE ENVIRONMENT
  $AGENTMON_AGENT    supplies --agent    $AGENTMON_PROJECT  supplies --project

GLOBAL FLAGS
  --vault <dir> and --json work anywhere on the line, before or after the subcommand.

EXIT CODES
  0 ok   1 vault has problems   2 usage   3 not found
  4 body rejected   5 conflict   6 invalid vault   7 io error

Full manual: docs/AGENT_MANUAL.md";

#[derive(Parser, Debug)]
#[command(
    name = "agentmon",
    version,
    about = "Record agent work in a plain-file vault that humans read in the AgentMonitoring app.",
    long_about = "agentmon writes work logs, bug reports and events into a vault directory of \
plain files. The AgentMonitoring desktop app reads the same directory.\n\n\
Work logs answer three questions — ## What, ## Why, ## How — and gain an ## Outcome when they \
finish. Bugs carry a ## Report, a comment thread and a ## Resolution. The CLI enforces that \
shape, because a record nobody can reconstruct the work from is worse than no record.",
    after_help = ROOT_AFTER_HELP,
    propagate_version = true,
    disable_help_subcommand = false
)]
struct Cli {
    /// Vault directory (overrides $AGENTMON_VAULT and ./vault).
    #[arg(long, global = true, value_name = "DIR")]
    vault: Option<PathBuf>,

    /// Print the result as JSON; on failure prints {"ok":false,"error":{...}}.
    ///
    /// Global, so `agentmon --json work list -p x` and `agentmon work list -p x --json`
    /// are the same command — agents write it both ways.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Create a new vault (a directory of plain files).
    #[command(after_help = "EXAMPLES\n  agentmon init --name \"AgentMonitoring\"\n  \
        agentmon init --vault /srv/records --name \"Team records\"")]
    Init {
        /// Human-readable vault name, shown in the app.
        #[arg(long, value_name = "NAME", default_value = "AgentMonitoring vault")]
        name: String,
    },
    /// Create and list projects.
    #[command(subcommand)]
    Project(ProjectCmd),
    /// Record what you are doing, progress on it, and how it ended.
    #[command(subcommand)]
    Work(WorkCmd),
    /// File, claim, discuss and resolve bugs.
    #[command(subcommand)]
    Bug(BugCmd),
    /// Snapshot of a project: active work, open bugs, recent events.
    #[command(after_help = "EXAMPLES\n  agentmon status -p agent-monitoring\n  \
        agentmon status -p agent-monitoring --json")]
    Status {
        /// Project slug.
        #[arg(short, long, value_name = "SLUG", env = "AGENTMON_PROJECT")]
        project: String,
    },
    /// Validate vault integrity. Exits 1 when something is wrong.
    #[command(after_help = "EXAMPLES\n  agentmon doctor\n  agentmon doctor --strict --json\n\n\
        Errors mean the app will show something wrong or untrue. Warnings mean the vault is \
        readable but something is off. --strict makes warnings fail too.")]
    Doctor {
        /// Treat warnings as failures.
        #[arg(long)]
        strict: bool,
    },
}

#[derive(Subcommand, Debug)]
enum ProjectCmd {
    /// Create a project (a slug directory with worklogs, bugs and an event log).
    #[command(after_help = "EXAMPLE\n  agentmon project create checkout-rewrite \\\n    \
        --name \"Checkout rewrite\" \\\n    --description \"Replace the legacy checkout flow.\" \\\n    \
        --tags frontend,payments")]
    Create {
        /// Directory-safe id: lowercase letters, digits, '-' or '_'.
        slug: String,
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
    },
    /// Change a project's name, description or tags.
    #[command(after_help = "EXAMPLE\n  agentmon project update checkout-rewrite \\\n    \
        --description \"Replace the legacy checkout with the new payment provider.\" \\\n    \
        --tags frontend,payments,q3\n\n  Only the flags you pass change; --tags replaces the \
        whole list. Logs a project_updated event, which hand-editing project.json does not.")]
    Update {
        /// The project slug (the directory name under projects/).
        slug: String,
        /// New display name.
        #[arg(long)]
        name: Option<String>,
        /// New one-or-two-sentence description.
        #[arg(long)]
        description: Option<String>,
        /// Replacement tag list, comma-separated.
        #[arg(long, value_delimiter = ',')]
        tags: Option<Vec<String>>,
        /// active | archived. Archiving hides the project from the app's default view and
        /// deletes nothing; the records stay exactly where they are.
        #[arg(long, value_name = "STATE")]
        status: Option<String>,
        /// Agent recorded as the actor of the project_updated event.
        #[arg(long, env = "AGENTMON_AGENT", default_value = "agentmon")]
        agent: String,
        /// When the change happened (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// List projects in the vault.
    #[command(after_help = "EXAMPLE\n  agentmon project list")]
    List,
}

#[derive(Args, Debug)]
struct ProjectArg {
    /// Project slug (e.g. agent-monitoring). Defaults to $AGENTMON_PROJECT.
    #[arg(short, long, value_name = "SLUG", env = "AGENTMON_PROJECT")]
    project: String,
}

#[derive(Args, Debug)]
struct AgentArg {
    /// Your agent handle, recorded on the record and the event. Defaults to $AGENTMON_AGENT.
    #[arg(long, value_name = "NAME", env = "AGENTMON_AGENT")]
    agent: String,
}

const WORK_START_HELP: &str = "\
BODY CONTRACT
  The body must contain all three sections. Anything else you add is kept.

  ## What   what you are building or changing, concretely
  ## Why    the problem, the constraint, the alternative you rejected
  ## How    the approach, and the parts a reviewer would otherwise reverse-engineer

EXAMPLE (Git Bash)
  agentmon work start -p agent-monitoring --agent cli-builder \\
    --title \"Wire the vault watcher into the desktop app\" \\
    --tags tauri,live-updates --refs BUG-0002 \\
    --body \"$(cat <<'EOF'
  ## What

  Start a notify watcher in the Tauri shell and emit vault-changed.

  ## Why

  The desktop app shows whatever the vault held when a screen opened, so browser mode
  looks more live than the product.

  ## How

  recommended_watcher on <vault>/projects, 250ms debounce, slug in the payload.
  EOF
  )\"

  Long bodies: write a file and pass --body-file notes.md (or --body-file - for stdin).

ALREADY STARTED (or finished) THE WORK?
  Pass the real start time, then close the record with the real end time:
  agentmon work start ... --started-at 2026-08-18T09:12:00Z
  agentmon work done WORK-0007 ... --finished-at 2026-08-18T11:30:00Z --outcome \"...\"

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
        project: ProjectArg,
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
        /// When the work actually began (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        started_at: Option<String>,
        /// Not valid here — a record gains its end time from `work done --finished-at`.
        #[arg(long, value_name = "ISO8601", hide = true)]
        finished_at: Option<String>,
    },
    /// Append a timestamped note to a work log — a progress note, or a later correction.
    #[command(after_help = "EXAMPLE\n  agentmon work update WORK-0003 -p agent-monitoring \\\n    \
        --agent cli-builder \\\n    --message \"Debounce is in: one save produced four notify \
        events, now one reload.\"\n\n  Notes are append-only and timestamped; they are the \
        story of the work, so write what changed and what you learned, not \"progress\".\n\n\
        Writing it up afterwards? --at 2026-08-18T10:05:00Z stamps the note with the time it \
        actually happened.\n\n  A FINISHED record still takes notes. Nothing already written \
        changes — the note lands at the end of the timeline, dated at or after the close — so \
        this is how a record that turns out to state something false gets corrected inside \
        itself. Open the note with \"Correction:\" and the record page marks it and says so at \
        the top:\n\n  agentmon work update WORK-0011 -p agent-monitoring --agent p6-curator \\\n    \
        --message \"Correction: relay has four agents, not ten (BUG-0017).\"")]
    Update {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[command(flatten)]
        agent: AgentArg,
        /// The progress note: what changed, what you learned, what is next.
        #[arg(long, conflicts_with = "body_file")]
        message: Option<String>,
        /// Read the note from a file ('-' reads stdin). --message-file is the same flag.
        #[arg(long, value_name = "FILE", visible_alias = "message-file")]
        body_file: Option<PathBuf>,
        /// When the note was written (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Stop a work log that will not be finished (status abandoned, with the reason).
    #[command(after_help = "EXAMPLE\n  agentmon work abandon WORK-0003 -p agent-monitoring \\\n    \
        --agent cli-builder \\\n    --reason \"Superseded by WORK-0009, which solves the same \
        problem in agentmon-core; nothing from this branch was kept.\"\n\n  Use it when work \
        stops for good: leaving it in_progress shows an agent still working on something \
        nobody is doing. The reason is appended under ## Updates and `finished` is stamped \
        with the moment it stopped. --at backdates it.")]
    Abandon {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[command(flatten)]
        agent: AgentArg,
        /// Why it stopped, and what a reader should look at instead.
        #[arg(long, conflicts_with = "reason_file")]
        reason: Option<String>,
        /// Read the reason from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        reason_file: Option<PathBuf>,
        /// When it stopped (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Close a work log with an outcome (what shipped, what changed, how it was verified).
    #[command(after_help = "EXAMPLE\n  agentmon work done WORK-0003 -p agent-monitoring \\\n    \
        --agent cli-builder \\\n    --files src-tauri/src/lib.rs,src-tauri/Cargo.toml \\\n    \
        --outcome \"Shipped the debounced watcher; cargo check -p agentmonitoring clean and the \
        dashboard refreshes within ~300ms of a CLI write.\"\n\n  The outcome is what a human \
        reads first. Name the artifacts and the verification you actually ran.\n\n\
        RECORDING WORK THAT IS ALREADY OVER\n  --finished-at 2026-08-18T11:30:00Z stamps the \
        real end time; add --started-at to correct a start you had to guess at. Both land in \
        the frontmatter and in events.jsonl, so the duration and the feed agree.")]
    Done {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[command(flatten)]
        agent: AgentArg,
        /// What shipped, what changed, how it was verified.
        #[arg(long, conflicts_with = "outcome_file")]
        outcome: Option<String>,
        /// Read the outcome from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        outcome_file: Option<PathBuf>,
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
    #[command(after_help = "EXAMPLES\n  agentmon work list -p agent-monitoring\n  \
        agentmon work list -p agent-monitoring --status in_progress\n  \
        agentmon work list -p agent-monitoring --agent cli-builder --json")]
    List {
        #[command(flatten)]
        project: ProjectArg,
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
    #[command(after_help = "EXAMPLES\n  agentmon work view WORK-0003 -p agent-monitoring\n  \
        agentmon work view WORK-0003 -p agent-monitoring --json")]
    View {
        /// WORK-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
    },
}

const BUG_CREATE_HELP: &str = "\
BODY CONTRACT
  Plain prose becomes the ## Report section. Write repro steps, expected, actual.

EXAMPLE (Git Bash)
  agentmon bug create -p agent-monitoring --agent cli-builder \\
    --title \"work done exits 0 but leaves status in_progress\" \\
    --severity high --labels cli,data-loss \\
    --body \"$(cat <<'EOF'
  ## Report

  Repro:

  1. agentmon work start -p demo --agent a --title t --body \"\\$(cat body.md)\"
  2. agentmon work done WORK-0001 -p demo --agent a --outcome \"shipped it, tests green\"
  3. agentmon work view WORK-0001 -p demo

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
        project: ProjectArg,
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
    #[command(after_help = "EXAMPLE\n  agentmon bug claim BUG-0002 -p agent-monitoring \
        --agent cli-builder\n\n  Claiming a bug someone else holds is refused — comment on it \
        instead.")]
    Claim {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[command(flatten)]
        agent: AgentArg,
        /// When it was claimed (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Add a comment to a bug's thread.
    #[command(after_help = "EXAMPLE\n  agentmon bug comment BUG-0002 -p agent-monitoring \\\n    \
        --agent cli-builder \\\n    --message \"Root cause: setup() never started a watcher, so \
        vault-changed was never emitted.\"")]
    Comment {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[command(flatten)]
        agent: AgentArg,
        /// What you found, what you tried, what it means for the fix.
        #[arg(long, conflicts_with = "body_file")]
        message: Option<String>,
        /// Read the comment from a file ('-' reads stdin). --message-file is the same flag.
        #[arg(long, value_name = "FILE", visible_alias = "message-file")]
        body_file: Option<PathBuf>,
        /// When the comment was written (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// Resolve a bug with a written resolution.
    #[command(after_help = "EXAMPLE\n  agentmon bug resolve BUG-0002 -p agent-monitoring \\\n    \
        --agent cli-builder \\\n    --resolution \"Root cause: no watcher was ever started. Fix: \
        setup() spawns a debounced notify watcher that emits vault-changed. Verified: cargo check \
        -p agentmonitoring clean; dashboard refreshed on a CLI write.\"\n\n  Say the root cause, \
        the fix, and the verification. Resolving a bug you did not claim assigns it to you.")]
    Resolve {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[command(flatten)]
        agent: AgentArg,
        /// Root cause, the fix, and how it was verified.
        #[arg(long, conflicts_with = "resolution_file")]
        resolution: Option<String>,
        /// Read the resolution from a file ('-' reads stdin).
        #[arg(long, value_name = "FILE")]
        resolution_file: Option<PathBuf>,
        /// When it was fixed (UTC ISO8601). Defaults to now.
        #[arg(long, value_name = "ISO8601")]
        at: Option<String>,
    },
    /// List bugs.
    #[command(after_help = "EXAMPLES\n  agentmon bug list -p agent-monitoring --status open\n  \
        agentmon bug list -p agent-monitoring --severity high --json\n  \
        agentmon bug list -p agent-monitoring --label tauri")]
    List {
        #[command(flatten)]
        project: ProjectArg,
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
    #[command(after_help = "EXAMPLES\n  agentmon bug view BUG-0002 -p agent-monitoring\n  \
        agentmon bug view BUG-0002 -p agent-monitoring --json")]
    View {
        /// BUG-NNNN.
        id: String,
        #[command(flatten)]
        project: ProjectArg,
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
            CoreError::VaultNotFound { .. }
            | CoreError::ProjectNotFound { .. }
            | CoreError::RecordNotFound { .. } => exit::NOT_FOUND,
            CoreError::InvalidBody(_) => exit::INVALID_BODY,
            CoreError::Conflict { .. } | CoreError::Locked { .. } => exit::CONFLICT,
            CoreError::Malformed { .. } => exit::INVALID_VAULT,
            CoreError::Io { .. } => exit::IO,
            CoreError::InvalidId { .. } | CoreError::InvalidValue { .. } => exit::USAGE,
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
        Command::Init { name } => cmd_init(cli, name, cli.json),
        Command::Project(cmd) => run_project(cli, cmd),
        Command::Work(cmd) => run_work(cli, cmd),
        Command::Bug(cmd) => run_bug(cli, cmd),
        Command::Status { project } => cmd_status(cli, project, cli.json),
        Command::Doctor { strict } => cmd_doctor(cli, *strict, cli.json),
    }
}

// ---------------------------------------------------------------------------
// init / project
// ---------------------------------------------------------------------------

fn cmd_init(cli: &Cli, name: &str, json: bool) -> CliResult {
    // `init` is the one command that must not resolve an existing vault.
    let target = cli
        .vault
        .clone()
        .or_else(|| std::env::var_os("AGENTMON_VAULT").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("vault"));
    let vault = Vault::init(&target, name)?;
    let info = vault.info()?;
    if json {
        print_json(&info)?;
    } else {
        println!("Created vault \"{}\" at {}", info.name, info.path);
        println!();
        println!("Next:");
        println!(
            "  agentmon project create <slug> --name \"<name>\"   # e.g. checkout-rewrite"
        );
        println!("  agentmon project list");
        if cli.vault.is_none() && std::env::var_os("AGENTMON_VAULT").is_none() {
            println!();
            println!(
                "This vault is ./vault, so agentmon finds it automatically from this directory."
            );
            println!(
                "From anywhere else, pass --vault {} or export AGENTMON_VAULT={}",
                info.path, info.path
            );
        }
    }
    Ok(())
}

fn run_project(cli: &Cli, cmd: &ProjectCmd) -> CliResult {
    match cmd {
        ProjectCmd::Create {
            slug,
            name,
            description,
            tags,
            agent,
            at,
        } => {
            let vault = open(cli)?;
            let written = vault.create_project(&NewProject {
                slug: slug.clone(),
                name: name.clone(),
                description: description.clone().unwrap_or_default(),
                tags: tags.clone(),
                actor: agent.clone(),
                at: at.clone(),
            })?;
            if cli.json {
                print_json(&written)?;
            } else {
                println!("Created project {} ({})", written.record.name, written.id);
                println!("  {}", written.path);
                println!();
                println!("Next:");
                println!(
                    "  agentmon work start -p {} --agent <you> --title \"<title>\" --body \"...\"",
                    written.id
                );
            }
            Ok(())
        }
        ProjectCmd::Update {
            slug,
            name,
            description,
            tags,
            status,
            agent,
            at,
        } => {
            let vault = open(cli)?;
            let status = status
                .as_deref()
                .map(agentmon_core::parse_project_status)
                .transpose()?;
            let written = vault.update_project(
                slug,
                &UpdateProject {
                    name: name.clone(),
                    description: description.clone(),
                    tags: tags.clone(),
                    status,
                    actor: agent.clone(),
                    at: at.clone(),
                },
            )?;
            if cli.json {
                return print_json(&written);
            }
            let p = &written.record;
            println!("Updated project {} ({})", p.name, p.slug);
            if p.status == agentmon_core::ProjectStatus::Archived {
                println!("  archived — its records are still in the vault");
            }
            if !p.description.is_empty() {
                println!("  {}", clip(&p.description, 100));
            }
            if !p.tags.is_empty() {
                println!("  tags: {}", p.tags.join(", "));
            }
            println!("  {}", written.path);
            Ok(())
        }
        ProjectCmd::List => {
            let vault = open(cli)?;
            let projects = vault.projects()?;
            if cli.json {
                return print_json(&projects);
            }
            if projects.is_empty() {
                println!("No projects yet in {}.", vault.root().display());
                println!();
                println!("Create one:");
                println!("  agentmon project create <slug> --name \"<name>\"");
                return Ok(());
            }
            // Print the vault first: "which vault did that write go to" is the question
            // behind most confused bug reports, and this is the cheapest place to answer it.
            println!("{}\n", vault.root().display());
            let w = projects.iter().map(|p| p.slug.len()).max().unwrap_or(4).max(4);
            println!(
                "{:<w$}  {:<30} {:>6} {:>6} {:>9}  LAST ACTIVITY",
                "SLUG",
                "NAME",
                "WORK",
                "BUGS",
                "STATUS",
                w = w
            );
            for p in projects {
                println!(
                    "{:<w$}  {:<30} {:>6} {:>6} {:>9}  {}",
                    p.slug,
                    clip(&p.name, 30),
                    p.counts.work_total,
                    p.counts.bugs_open,
                    match p.status {
                        agentmon_core::ProjectStatus::Active => "active",
                        agentmon_core::ProjectStatus::Archived => "archived",
                    },
                    p.counts.last_activity.as_deref().unwrap_or("—"),
                    w = w
                );
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
            project,
            agent,
            title,
            tags,
            refs,
            body,
            body_file,
            started_at,
            finished_at,
        } => {
            if let Some(f) = finished_at {
                return Err(finished_at_on_start(f));
            }
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
            let vault = open(cli)?;
            let w = vault.start_work(
                &project.project,
                &StartWork {
                    agent: agent.agent.clone(),
                    title: title.clone(),
                    tags: tags.clone(),
                    refs: refs.clone(),
                    body,
                    started_at: started_at.clone(),
                },
            )?;
            if cli.json {
                return print_json(&w);
            }
            println!("Started {}  {}", w.id, w.record.meta.title);
            println!("  {}", w.path);
            println!();
            println!("Next:");
            println!(
                "  agentmon work update {} -p {} --agent {} --message \"<what changed>\"",
                w.id, project.project, agent.agent
            );
            println!(
                "  agentmon work done   {} -p {} --agent {} --outcome \"<what shipped, how verified>\"",
                w.id, project.project, agent.agent
            );
            Ok(())
        }
        WorkCmd::Update {
            id,
            project,
            agent,
            message,
            body_file,
            at,
        } => {
            let message = read_text(
                message.as_deref(),
                body_file.as_deref(),
                BodySource {
                    what: "work update",
                    inline_flag: "--message",
                    file_flag: "--body-file (or --message-file)",
                    template: "A sentence or two: what changed since the last note, what you \
                               learned, what you are doing next.",
                    example: "agentmon work update WORK-0003 -p agent-monitoring \\\n  \
                              --agent cli-builder \\\n  --message \"Debounce is in: one save \
                              produced four notify events, now one reload.\"",
                },
            )?;
            let vault = open(cli)?;
            let w =
                vault.update_work(&project.project, id, &agent.agent, &message, at.as_deref())?;
            if cli.json {
                return print_json(&w);
            }
            let n = w.record.updates.len();
            println!(
                "Updated {}  ({} note{} now, latest {})",
                w.id,
                n,
                if n == 1 { "" } else { "s" },
                w.record.updates.last().map(|u| u.ts.as_str()).unwrap_or("—")
            );
            println!("  {}", w.path);
            // Say plainly what was and was not touched, because appending to a closed
            // record looks like editing history and is not.
            if w.record.meta.status != WorkStatus::InProgress {
                println!(
                    "  Appended to a {} record: status, timestamps and everything above ## Updates are unchanged.",
                    w.record.meta.status.as_str()
                );
            }
            Ok(())
        }
        WorkCmd::Abandon {
            id,
            project,
            agent,
            reason,
            reason_file,
            at,
        } => {
            let reason = read_text(
                reason.as_deref(),
                reason_file.as_deref(),
                BodySource {
                    what: "abandon reason",
                    inline_flag: "--reason",
                    file_flag: "--reason-file",
                    template: "One or two sentences: why this stopped, and what a reader \
                               should look at instead.",
                    example: "agentmon work abandon WORK-0003 -p agent-monitoring \\\n  \
                              --agent cli-builder \\\n  --reason \"Superseded by WORK-0009, \
                              which solves the same problem in agentmon-core; nothing from \
                              this branch was kept.\"",
                },
            )?;
            let vault = open(cli)?;
            let w = vault.abandon_work(
                &project.project,
                id,
                &AbandonWork {
                    agent: agent.agent.clone(),
                    reason,
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
            project,
            agent,
            outcome,
            outcome_file,
            files,
            refs,
            finished_at,
            started_at,
        } => {
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
            let vault = open(cli)?;
            let w = vault.finish_work(
                &project.project,
                id,
                &FinishWork {
                    agent: agent.agent.clone(),
                    outcome,
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
        WorkCmd::List {
            project,
            status,
            agent,
            tag,
        } => {
            let vault = open(cli)?;
            let mut works = vault.worklogs(&project.project)?;
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
                println!(
                    "No work logs match in project '{}'. Start one:",
                    project.project
                );
                println!(
                    "  agentmon work start -p {} --agent <you> --title \"<title>\" --body \"...\"",
                    project.project
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
        WorkCmd::View { id, project } => {
            let vault = open(cli)?;
            let w = vault.worklog(&project.project, id)?;
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
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// bugs
// ---------------------------------------------------------------------------

fn run_bug(cli: &Cli, cmd: &BugCmd) -> CliResult {
    match cmd {
        BugCmd::Create {
            project,
            agent,
            title,
            severity,
            body,
            body_file,
            labels,
            refs,
            created_at,
        } => {
            let severity: Severity = agentmon_core::parse_severity(severity)?;
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
            let vault = open(cli)?;
            let b = vault.create_bug(
                &project.project,
                &NewBug {
                    agent: agent.agent.clone(),
                    title: title.clone(),
                    severity,
                    labels: labels.clone(),
                    refs: refs.clone(),
                    body,
                    created_at: created_at.clone(),
                },
            )?;
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
            println!(
                "  agentmon bug claim {} -p {} --agent {}",
                b.id, project.project, agent.agent
            );
            Ok(())
        }
        BugCmd::Claim {
            id,
            project,
            agent,
            at,
        } => {
            let vault = open(cli)?;
            let b = vault.claim_bug(&project.project, id, &agent.agent, at.as_deref())?;
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
                "  agentmon bug comment {} -p {} --agent {} --message \"<root cause>\"",
                b.id, project.project, agent.agent
            );
            println!(
                "  agentmon bug resolve {} -p {} --agent {} --resolution \"<fix, why, verification>\"",
                b.id, project.project, agent.agent
            );
            Ok(())
        }
        BugCmd::Comment {
            id,
            project,
            agent,
            message,
            body_file,
            at,
        } => {
            let message = read_text(
                message.as_deref(),
                body_file.as_deref(),
                BodySource {
                    what: "bug comment",
                    inline_flag: "--message",
                    file_flag: "--body-file (or --message-file)",
                    template: "A sentence or two: what you found, what you tried, what it means \
                               for the fix.",
                    example: "agentmon bug comment BUG-0002 -p agent-monitoring \\\n  \
                              --agent cli-builder \\\n  --message \"Root cause: setup() never \
                              started a watcher, so vault-changed was never emitted.\"",
                },
            )?;
            let vault = open(cli)?;
            let b =
                vault.comment_bug(&project.project, id, &agent.agent, &message, at.as_deref())?;
            if cli.json {
                return print_json(&b);
            }
            let n = b.record.comments.len();
            println!(
                "Commented on {}  ({} comment{} now)",
                b.id,
                n,
                if n == 1 { "" } else { "s" }
            );
            println!("  {}", b.path);
            Ok(())
        }
        BugCmd::Resolve {
            id,
            project,
            agent,
            resolution,
            resolution_file,
            at,
        } => {
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
            let vault = open(cli)?;
            let b = vault.resolve_bug(&project.project, id, &agent.agent, &resolution, at.as_deref())?;
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
            project,
            status,
            severity,
            label,
            assignee,
        } => {
            let vault = open(cli)?;
            let mut bugs = vault.bugs(&project.project)?;
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
                println!("No bugs match in project '{}'.", project.project);
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
        BugCmd::View { id, project } => {
            let vault = open(cli)?;
            let b = vault.bug(&project.project, id)?;
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
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// status / doctor
// ---------------------------------------------------------------------------

fn cmd_status(cli: &Cli, project: &str, json: bool) -> CliResult {
    let vault = open(cli)?;
    let snap = vault.status(project)?;
    if json {
        return print_json(&snap);
    }
    let c = &snap.project.counts;
    println!("{}  ({})", snap.project.name, snap.project.slug);
    println!("{}", vault.root().display());
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
    let vault = open(cli)?;
    let report = doctor::check(&vault)?;
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
            "{} — {} project(s), {} work log(s), {} bug(s), {} event(s)",
            report.vault, report.projects, report.worklogs, report.bugs, report.events
        );
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
            kind: "vault_problems",
            message: format!(
                "{errors} error(s) and {warnings} warning(s) in {}. Fix them and re-run \
                 `agentmon doctor`.",
                report.vault
            ),
        })
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

fn open(cli: &Cli) -> std::result::Result<Vault, CliError> {
    Ok(Vault::resolve(cli.vault.as_deref())?)
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
             shipped, how it was verified>\""
        ),
    }
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
            exit::INVALID_VAULT,
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
                CoreError::ProjectNotFound {
                    slug: "x".into(),
                    vault: PathBuf::from("v"),
                },
                exit::NOT_FOUND,
            ),
            (
                CoreError::conflict("already done", "start a new one"),
                exit::CONFLICT,
            ),
            (
                CoreError::malformed("f.md", "bad frontmatter"),
                exit::INVALID_VAULT,
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
            vec!["agentmon", "--json", "work", "list", "-p", "demo"],
            vec!["agentmon", "work", "list", "-p", "demo", "--json"],
            vec!["agentmon", "work", "--json", "list", "-p", "demo"],
        ] {
            let cli = Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
            assert!(cli.json, "{args:?}");
        }
        let cli = Cli::try_parse_from(["agentmon", "work", "list", "-p", "demo"]).unwrap();
        assert!(!cli.json, "--json is opt-in");
        // and the same is true of --vault, which agents write in both places
        for args in [
            vec!["agentmon", "--vault", "v", "status", "-p", "demo"],
            vec!["agentmon", "status", "-p", "demo", "--vault", "v"],
        ] {
            let cli = Cli::try_parse_from(&args).unwrap_or_else(|e| panic!("{args:?}: {e}"));
            assert_eq!(cli.vault.as_deref(), Some(Path::new("v")), "{args:?}");
        }
    }

    #[test]
    fn every_mutation_accepts_the_time_it_really_happened() {
        // These pairs are the table in docs/AGENT_MANUAL.md ("Backdating"). If one is
        // renamed here, the manual is wrong and a fresh agent will paste a flag that
        // does not exist.
        let cases: &[(&[&str], &str)] = &[
            (&["project", "create"], "at"),
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
        ];
        for (path, flag) in cases {
            assert!(
                has_flag(path, flag),
                "`agentmon {}` must accept --{flag}",
                path.join(" ")
            );
        }
    }

    #[test]
    fn message_file_is_the_same_flag_as_body_file() {
        for path in [
            vec!["agentmon", "work", "update", "WORK-0001"],
            vec!["agentmon", "bug", "comment", "BUG-0001"],
        ] {
            let mut args = path.clone();
            args.extend(["-p", "demo", "--agent", "a", "--message-file", "notes.md"]);
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
            "-p",
            "demo",
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
}
