//! `agentmon` — the agent-facing CLI.
//!
//! P0 scope: the full command surface from SPEC.md is declared here (so `--help` is the
//! real contract), and every read path is implemented on top of agentmon-core. The
//! mutating commands are stubbed with an explicit, actionable error; they are P1's piece.
//! Nothing here silently half-writes a vault.

use std::path::PathBuf;
use std::process::ExitCode;

use agentmon_core::{Vault, WorkStatus};
use clap::{Args, Parser, Subcommand};

/// Exit codes are part of the contract — agents script against them.
const EXIT_USAGE: u8 = 2;
const EXIT_NOT_FOUND: u8 = 3;
const EXIT_UNIMPLEMENTED: u8 = 4;

#[derive(Parser, Debug)]
#[command(
    name = "agentmon",
    version,
    about = "Record agent work in a plain-file vault that humans read in the AgentMonitoring app.",
    long_about = "agentmon writes work logs, bug reports and events into a vault directory of plain \
files. The AgentMonitoring desktop app reads the same directory.\n\n\
Vault resolution order: --vault flag, then $AGENTMON_VAULT, then ./vault.",
    propagate_version = true
)]
struct Cli {
    /// Vault directory (overrides $AGENTMON_VAULT and ./vault).
    #[arg(long, global = true, value_name = "DIR")]
    vault: Option<PathBuf>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Create a new vault in an empty directory.
    Init {
        #[arg(long, value_name = "NAME", default_value = "AgentMonitoring vault")]
        name: String,
    },
    /// Create, list and inspect projects.
    #[command(subcommand)]
    Project(ProjectCmd),
    /// Record what you are doing, progress on it, and how it ended.
    #[command(subcommand)]
    Work(WorkCmd),
    /// File, claim, discuss and resolve bugs.
    #[command(subcommand)]
    Bug(BugCmd),
    /// Snapshot of a project: active work, open bugs, recent events.
    Status {
        #[arg(short, long, value_name = "SLUG")]
        project: String,
        #[arg(long)]
        json: bool,
    },
    /// Validate vault integrity. Exits non-zero when something is wrong.
    Doctor,
}

#[derive(Subcommand, Debug)]
enum ProjectCmd {
    /// Create a project.
    Create {
        slug: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
    },
    /// List projects in the vault.
    List {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Args, Debug)]
struct ProjectArg {
    /// Project slug (e.g. agent-monitoring).
    #[arg(short, long, value_name = "SLUG")]
    project: String,
}

#[derive(Subcommand, Debug)]
enum WorkCmd {
    /// Start a work log. The body must contain ## What, ## Why and ## How.
    Start {
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
        #[arg(long)]
        title: String,
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
        #[arg(long, conflicts_with = "body_file")]
        body: Option<String>,
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
    },
    /// Append a timestamped progress note to a work log.
    Update {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
        #[arg(long, conflicts_with = "body_file")]
        message: Option<String>,
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
    },
    /// Close a work log with an outcome (what shipped, what changed, verification).
    Done {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
        #[arg(long, conflicts_with = "outcome_file")]
        outcome: Option<String>,
        #[arg(long, value_name = "FILE")]
        outcome_file: Option<PathBuf>,
        #[arg(long, value_delimiter = ',')]
        files: Vec<String>,
    },
    /// List work logs.
    List {
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        agent: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Show one work log.
    View {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand, Debug)]
enum BugCmd {
    /// File a bug.
    Create {
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
        #[arg(long)]
        title: String,
        #[arg(long, value_name = "critical|high|medium|low")]
        severity: String,
        #[arg(long, conflicts_with = "body_file")]
        body: Option<String>,
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
        #[arg(long, value_delimiter = ',')]
        labels: Vec<String>,
    },
    /// Take ownership of a bug.
    Claim {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
    },
    /// Add a comment to a bug.
    Comment {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
        #[arg(long, conflicts_with = "body_file")]
        message: Option<String>,
        #[arg(long, value_name = "FILE")]
        body_file: Option<PathBuf>,
    },
    /// Resolve a bug with a written resolution.
    Resolve {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        agent: String,
        #[arg(long, conflicts_with = "resolution_file")]
        resolution: Option<String>,
        #[arg(long, value_name = "FILE")]
        resolution_file: Option<PathBuf>,
    },
    /// List bugs.
    List {
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        severity: Option<String>,
        #[arg(long)]
        label: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Show one bug.
    View {
        id: String,
        #[command(flatten)]
        project: ProjectArg,
        #[arg(long)]
        json: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("agentmon: {err}");
            ExitCode::from(err.code)
        }
    }
}

struct CliError {
    code: u8,
    message: String,
}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<agentmon_core::CoreError> for CliError {
    fn from(e: agentmon_core::CoreError) -> Self {
        let code = match e {
            agentmon_core::CoreError::ProjectNotFound { .. }
            | agentmon_core::CoreError::RecordNotFound { .. }
            | agentmon_core::CoreError::VaultNotFound { .. } => EXIT_NOT_FOUND,
            _ => EXIT_USAGE,
        };
        CliError {
            code,
            message: e.to_string(),
        }
    }
}

fn unimplemented(what: &str) -> CliError {
    CliError {
        code: EXIT_UNIMPLEMENTED,
        message: format!(
            "`{what}` is not implemented in this build (P0 foundation). Write commands land with \
             the P1 CLI piece; read commands (project list, work list/view, bug list/view, status, \
             doctor) work today."
        ),
    }
}

type CliResult = std::result::Result<(), CliError>;

fn run(cli: &Cli) -> CliResult {
    match &cli.command {
        Command::Init { .. } => Err(unimplemented("agentmon init")),
        Command::Project(ProjectCmd::Create { .. }) => Err(unimplemented("agentmon project create")),
        Command::Project(ProjectCmd::List { json }) => {
            let vault = open(cli)?;
            let projects = vault.projects()?;
            if *json {
                print_json(&projects)?;
            } else if projects.is_empty() {
                println!("no projects yet — create one with `agentmon project create <slug> --name <n>`");
            } else {
                println!("{:<22} {:<34} {:>5} {:>5}", "SLUG", "NAME", "WORK", "BUGS");
                for p in projects {
                    println!(
                        "{:<22} {:<34} {:>5} {:>5}",
                        p.slug, p.name, p.counts.work_total, p.counts.bugs_open
                    );
                }
            }
            Ok(())
        }
        Command::Work(WorkCmd::Start { .. }) => Err(unimplemented("agentmon work start")),
        Command::Work(WorkCmd::Update { .. }) => Err(unimplemented("agentmon work update")),
        Command::Work(WorkCmd::Done { .. }) => Err(unimplemented("agentmon work done")),
        Command::Work(WorkCmd::List {
            project,
            status,
            agent,
            json,
        }) => {
            let vault = open(cli)?;
            let mut works = vault.worklogs(&project.project)?;
            if let Some(s) = status {
                works.retain(|w| w.meta.status.as_str() == s.as_str());
            }
            if let Some(a) = agent {
                works.retain(|w| w.meta.agent == *a);
            }
            if *json {
                print_json(&works)?;
            } else {
                for w in works {
                    println!(
                        "{}  {:<11} {:<22} {}",
                        w.meta.id,
                        w.meta.status.as_str(),
                        w.meta.agent,
                        w.meta.title
                    );
                }
            }
            Ok(())
        }
        Command::Work(WorkCmd::View { id, project, json }) => {
            let vault = open(cli)?;
            let work = vault.worklog(&project.project, id)?;
            if *json {
                print_json(&work)?;
            } else {
                println!("{}  {}", work.meta.id, work.meta.title);
                println!(
                    "agent: {}   status: {}   started: {}",
                    work.meta.agent,
                    work.meta.status.as_str(),
                    work.meta.started
                );
                println!();
                println!("{}", work.body);
            }
            Ok(())
        }
        Command::Bug(BugCmd::Create { .. }) => Err(unimplemented("agentmon bug create")),
        Command::Bug(BugCmd::Claim { .. }) => Err(unimplemented("agentmon bug claim")),
        Command::Bug(BugCmd::Comment { .. }) => Err(unimplemented("agentmon bug comment")),
        Command::Bug(BugCmd::Resolve { .. }) => Err(unimplemented("agentmon bug resolve")),
        Command::Bug(BugCmd::List {
            project,
            status,
            severity,
            label,
            json,
        }) => {
            let vault = open(cli)?;
            let mut bugs = vault.bugs(&project.project)?;
            if let Some(s) = status {
                bugs.retain(|b| b.meta.status.as_str() == s.as_str());
            }
            if let Some(s) = severity {
                bugs.retain(|b| b.meta.severity.as_str() == s.as_str());
            }
            if let Some(l) = label {
                bugs.retain(|b| b.meta.labels.iter().any(|x| x == l));
            }
            if *json {
                print_json(&bugs)?;
            } else {
                for b in bugs {
                    println!(
                        "{}  {:<9} {:<12} {}",
                        b.meta.id,
                        b.meta.severity.as_str(),
                        b.meta.status.as_str(),
                        b.meta.title
                    );
                }
            }
            Ok(())
        }
        Command::Bug(BugCmd::View { id, project, json }) => {
            let vault = open(cli)?;
            let bug = vault.bug(&project.project, id)?;
            if *json {
                print_json(&bug)?;
            } else {
                println!("{}  {}", bug.meta.id, bug.meta.title);
                println!(
                    "severity: {}   status: {}   reporter: {}",
                    bug.meta.severity.as_str(),
                    bug.meta.status.as_str(),
                    bug.meta.reporter
                );
                println!();
                println!("{}", bug.body);
            }
            Ok(())
        }
        Command::Status { project, json } => {
            let vault = open(cli)?;
            let snap = vault.status(project)?;
            if *json {
                print_json(&snap)?;
            } else {
                println!("{} ({})", snap.project.name, snap.project.slug);
                println!(
                    "  work: {} in progress, {} done of {}",
                    snap.project.counts.work_in_progress,
                    snap.project.counts.work_done,
                    snap.project.counts.work_total
                );
                println!(
                    "  bugs: {} open of {}",
                    snap.project.counts.bugs_open, snap.project.counts.bugs_total
                );
                if !snap.active_work.is_empty() {
                    println!("\nactive work:");
                    for w in &snap.active_work {
                        println!("  {}  {}  ({})", w.meta.id, w.meta.title, w.meta.agent);
                    }
                }
                if !snap.open_bugs.is_empty() {
                    println!("\nopen bugs:");
                    for b in &snap.open_bugs {
                        println!(
                            "  {}  [{}]  {}",
                            b.meta.id,
                            b.meta.severity.as_str(),
                            b.meta.title
                        );
                    }
                }
                if !snap.recent_events.is_empty() {
                    println!("\nrecent events:");
                    for e in snap.recent_events.iter().take(10) {
                        println!("  {}  {:<14} {}", e.ts, e.event_type, e.summary);
                    }
                }
            }
            Ok(())
        }
        Command::Doctor => doctor(cli),
    }
}

fn open(cli: &Cli) -> std::result::Result<Vault, CliError> {
    Ok(Vault::resolve(cli.vault.as_deref())?)
}

fn print_json<T: serde::Serialize>(value: &T) -> CliResult {
    let text = serde_json::to_string_pretty(value).map_err(|e| CliError {
        code: EXIT_USAGE,
        message: format!("could not serialize output: {e}"),
    })?;
    println!("{text}");
    Ok(())
}

/// Walk everything and report every problem found, not just the first one.
fn doctor(cli: &Cli) -> CliResult {
    let vault = open(cli)?;
    let info = vault.info()?;
    let mut problems: Vec<String> = Vec::new();
    let mut checked = 0usize;

    if info.version != agentmon_core::SCHEMA_VERSION {
        problems.push(format!(
            "vault.json version is {} but this build speaks schema v{}",
            info.version,
            agentmon_core::SCHEMA_VERSION
        ));
    }

    for project in vault.projects()? {
        match vault.worklogs(&project.slug) {
            Ok(works) => {
                for w in works {
                    checked += 1;
                    match vault.worklog(&project.slug, &w.meta.id) {
                        Ok(d) => {
                            for (name, value) in
                                [("What", &d.what), ("Why", &d.why), ("How", &d.how)]
                            {
                                if value.trim().is_empty() {
                                    problems.push(format!(
                                        "{}/{}: missing `## {name}` section",
                                        project.slug, w.meta.id
                                    ));
                                }
                            }
                            if d.meta.status == WorkStatus::Done && d.outcome.is_none() {
                                problems.push(format!(
                                    "{}/{}: status is done but there is no `## Outcome` section",
                                    project.slug, w.meta.id
                                ));
                            }
                        }
                        Err(e) => problems.push(e.to_string()),
                    }
                }
            }
            Err(e) => problems.push(e.to_string()),
        }
        match vault.bugs(&project.slug) {
            Ok(bugs) => {
                for b in bugs {
                    checked += 1;
                    match vault.bug(&project.slug, &b.meta.id) {
                        Ok(d) => {
                            if d.report.trim().is_empty() {
                                problems.push(format!(
                                    "{}/{}: missing `## Report` section",
                                    project.slug, b.meta.id
                                ));
                            }
                            if matches!(
                                d.meta.status,
                                agentmon_core::BugStatus::Resolved | agentmon_core::BugStatus::Closed
                            ) && d.resolution.is_none()
                            {
                                problems.push(format!(
                                    "{}/{}: status is {} but there is no `## Resolution` section",
                                    project.slug,
                                    b.meta.id,
                                    d.meta.status.as_str()
                                ));
                            }
                        }
                        Err(e) => problems.push(e.to_string()),
                    }
                }
            }
            Err(e) => problems.push(e.to_string()),
        }
        if let Err(e) = vault.events(&project.slug, None) {
            problems.push(e.to_string());
        }
    }

    if problems.is_empty() {
        println!("vault ok: {} ({} records checked)", info.path, checked);
        Ok(())
    } else {
        for p in &problems {
            eprintln!("  problem: {p}");
        }
        Err(CliError {
            code: 1,
            message: format!("{} problem(s) found in {}", problems.len(), info.path),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_definition_is_valid() {
        Cli::command().debug_assert();
    }
}
