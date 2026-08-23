//! The optional CLAUDE.md a new project can start with.
//!
//! A project's records are only as good as the agents' habit of writing them, and the
//! habit comes from the repo's own agent instructions. This module owns the two
//! canonical instruction texts (Korean and English) and the one way they reach a repo:
//! written to `<location>/CLAUDE.md` — the repo root, *next to* the AgentMonitoring
//! folder, because that is the file coding agents actually load.
//!
//! The write is deliberately conservative about a file it does not own:
//!
//!   * no file → create it from the template;
//!   * a CLAUDE.md already there → append the section after a blank line, touching
//!     nothing the human wrote;
//!   * the section already present (either language) → change nothing. Idempotent, so
//!     a re-run or a second project tool can never stack duplicates.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::fsx;

const TEMPLATE_KO: &str = include_str!("../templates/claude-md.ko.md");
const TEMPLATE_EN: &str = include_str!("../templates/claude-md.en.md");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeMdLang {
    Ko,
    En,
}

impl ClaudeMdLang {
    pub fn template(self) -> &'static str {
        match self {
            ClaudeMdLang::Ko => TEMPLATE_KO,
            ClaudeMdLang::En => TEMPLATE_EN,
        }
    }

    /// The template's first line — the marker that says a CLAUDE.md already carries
    /// these instructions, in this language.
    fn heading(self) -> &'static str {
        self.template().lines().next().unwrap_or_default()
    }
}

/// Parse a language from the CLI / app, listing the alternatives on failure.
pub fn parse_claude_md_lang(value: &str) -> Result<ClaudeMdLang> {
    match value.trim().to_ascii_lowercase().as_str() {
        "ko" => Ok(ClaudeMdLang::Ko),
        "en" => Ok(ClaudeMdLang::En),
        _ => Err(CoreError::InvalidValue {
            what: "--claude-md".to_string(),
            value: value.trim().to_string(),
            expected: "one of: ko, en".to_string(),
        }),
    }
}

/// What [`write_claude_md`] did to the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeMdOutcome {
    Created,
    Appended,
    AlreadyPresent,
}

/// Write the agent instructions to `<location>/CLAUDE.md`. `location` is the folder
/// that holds the `AgentMonitoring` folder ([`Store::location`](crate::Store::location)),
/// not the data folder itself.
pub fn write_claude_md(location: &Path, lang: ClaudeMdLang) -> Result<(PathBuf, ClaudeMdOutcome)> {
    let path = location.join("CLAUDE.md");
    let existing = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(CoreError::io(&path, e)),
    };

    let outcome = match existing {
        None => {
            fsx::write_atomic(&path, lang.template())?;
            ClaudeMdOutcome::Created
        }
        Some(text)
            if text.contains(ClaudeMdLang::Ko.heading())
                || text.contains(ClaudeMdLang::En.heading()) =>
        {
            ClaudeMdOutcome::AlreadyPresent
        }
        Some(text) => {
            let mut joined = text;
            while !joined.ends_with("\n\n") {
                joined.push('\n');
            }
            joined.push_str(lang.template());
            fsx::write_atomic(&path, &joined)?;
            ClaudeMdOutcome::Appended
        }
    };
    Ok((path, outcome))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-claude-md-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn both_templates_start_with_their_marker_heading_and_name_the_tools() {
        for lang in [ClaudeMdLang::Ko, ClaudeMdLang::En] {
            let t = lang.template();
            assert!(t.starts_with("# "), "template must open with its marker heading");
            assert!(t.ends_with('\n'));
            for tool in ["log_work", "update_work", "report_bug", "resolve_bug", "note", "status"] {
                assert!(t.contains(tool), "{lang:?} template must mention {tool}");
            }
        }
        assert_ne!(ClaudeMdLang::Ko.heading(), ClaudeMdLang::En.heading());
    }

    // Neither template says anything about the human area, and a test used to insist both
    // did. The line was written, then measured against its own absence: the repo without it
    // saved a conforming record on the same attempt as the repo with it, because the CLI's
    // refusal teaches the contract either way. Every byte here is re-sent on every turn of
    // every conversation in the seeded project, so a line that changes no record does not
    // earn one. Do not add it back without a measurement that says it works.

    #[test]
    fn creates_then_holds_then_appends_to_a_foreign_file() {
        let dir = tmp("lifecycle");

        // No file: created verbatim.
        let (path, outcome) = write_claude_md(&dir, ClaudeMdLang::Ko).unwrap();
        assert_eq!(outcome, ClaudeMdOutcome::Created);
        assert_eq!(fs::read_to_string(&path).unwrap(), ClaudeMdLang::Ko.template());

        // Section already there — in either language: untouched.
        let before = fs::read_to_string(&path).unwrap();
        assert_eq!(
            write_claude_md(&dir, ClaudeMdLang::Ko).unwrap().1,
            ClaudeMdOutcome::AlreadyPresent
        );
        assert_eq!(
            write_claude_md(&dir, ClaudeMdLang::En).unwrap().1,
            ClaudeMdOutcome::AlreadyPresent
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);

        // A CLAUDE.md the human already owns: the section is appended, theirs kept.
        let theirs = "# My repo\n\nRun `make dev`.";
        fs::write(&path, theirs).unwrap();
        let (_, outcome) = write_claude_md(&dir, ClaudeMdLang::En).unwrap();
        assert_eq!(outcome, ClaudeMdOutcome::Appended);
        let joined = fs::read_to_string(&path).unwrap();
        assert!(joined.starts_with("# My repo\n\nRun `make dev`.\n\n# Work records"));
        assert!(joined.ends_with(ClaudeMdLang::En.template()));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lang_parses_the_two_words_and_refuses_the_rest() {
        assert_eq!(parse_claude_md_lang(" KO ").unwrap(), ClaudeMdLang::Ko);
        assert_eq!(parse_claude_md_lang("en").unwrap(), ClaudeMdLang::En);
        let err = parse_claude_md_lang("kr").unwrap_err();
        assert!(err.to_string().contains("ko, en"), "{err}");
    }
}
