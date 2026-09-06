//! Optional CLAUDE.md and AGENTS.md instructions a project can start with.
//!
//! A project's records are only as good as the agents' habit of writing them, and the
//! habit comes from the repo's own agent instructions. This module owns the two
//! canonical instruction texts (Korean and English) and the one way they reach a repo:
//! written to `<location>/CLAUDE.md` or `<location>/AGENTS.md` — the repo root,
//! *next to* the AgentMonitoring folder. Both files use the same templates.
//!
//! Only the versioned managed section is refreshed. Exact historical templates can
//! be migrated; edited legacy sections or malformed markers require a manual merge.
//! User text outside the section and an existing section's language are preserved.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::fsx;

const TEMPLATE_KO: &str = include_str!("../templates/claude-md.ko.md");
const TEMPLATE_EN: &str = include_str!("../templates/claude-md.en.md");
// Immutable migration fixtures: the exact templates shipped before managed sections.
const LEGACY_KO: &str = include_str!("../templates/claude-md.v1.ko.md");
const LEGACY_EN: &str = include_str!("../templates/claude-md.v1.en.md");
const MANAGED_VERSION: u32 = 2;
const START: &str = "<!-- agentmon:instructions version=";
const END: &str = "<!-- /agentmon:instructions -->";

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

    fn heading(self) -> &'static str {
        self.legacy().lines().next().unwrap_or_default()
    }

    fn legacy(self) -> &'static str {
        match self {
            Self::Ko => LEGACY_KO,
            Self::En => LEGACY_EN,
        }
    }
}

/// Parse a language from the CLI / app, listing the alternatives on failure.
pub fn parse_claude_md_lang(value: &str) -> Result<ClaudeMdLang> {
    parse_instruction_lang(value, "--claude-md")
}

pub fn parse_agents_md_lang(value: &str) -> Result<ClaudeMdLang> {
    parse_instruction_lang(value, "--agents-md")
}

fn parse_instruction_lang(value: &str, flag: &str) -> Result<ClaudeMdLang> {
    match value.trim().to_ascii_lowercase().as_str() {
        "ko" => Ok(ClaudeMdLang::Ko),
        "en" => Ok(ClaudeMdLang::En),
        _ => Err(CoreError::InvalidValue {
            what: flag.to_string(),
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
    Updated,
    AlreadyPresent,
}

/// Write the agent instructions to `<location>/CLAUDE.md`. `location` is the folder
/// that holds the `AgentMonitoring` folder ([`Store::location`](crate::Store::location)),
/// not the data folder itself.
pub fn write_claude_md(location: &Path, lang: ClaudeMdLang) -> Result<(PathBuf, ClaudeMdOutcome)> {
    write_instructions(location, "CLAUDE.md", lang)
}

/// Write the same instructions for Codex and other AGENTS.md-compatible tools.
/// Existing content is preserved, with duplicate detection scoped to this file.
pub fn write_agents_md(location: &Path, lang: ClaudeMdLang) -> Result<(PathBuf, ClaudeMdOutcome)> {
    write_instructions(location, "AGENTS.md", lang)
}

fn write_instructions(
    location: &Path,
    filename: &str,
    lang: ClaudeMdLang,
) -> Result<(PathBuf, ClaudeMdOutcome)> {
    let path = location.join(filename);
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
        Some(text) => {
            if let Some((start, end, existing_lang)) = instruction_section(&path, &text)? {
                let old = &text[start..end];
                let newline = if old.contains("\r\n") { "\r\n" } else { "\n" };
                let replacement = existing_lang
                    .template()
                    .replace("\r\n", "\n")
                    .trim_end_matches('\n')
                    .replace('\n', newline);
                if old == replacement {
                    return Ok((path, ClaudeMdOutcome::AlreadyPresent));
                }
                let refreshed = format!("{}{}{}", &text[..start], replacement, &text[end..]);
                fsx::write_atomic(&path, &refreshed)?;
                return Ok((path, ClaudeMdOutcome::Updated));
            }
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

fn manual_merge(path: &Path, reason: &str) -> CoreError {
    CoreError::Conflict {
        what: format!("{}: {reason}; instructions were not changed", path.display()),
        fix: "set AGENTMON_REGISTRY_DIR to a temporary directory and create a temporary project with `agentmon init --dir <temporary-folder> --name instruction-template --claude-md ko --agents-md ko` (use en for English), then manually merge the AgentMonitoring section while keeping your custom rules; managed marker boundaries must stay paired and unmodified".into(),
    }
}

/// Byte offsets exclude the final newline, so prefix, suffix and newline style survive.
fn instruction_section(path: &Path, text: &str) -> Result<Option<(usize, usize, ClaudeMdLang)>> {
    let mut begins = Vec::new();
    let mut ends = Vec::new();
    let mut headings = Vec::new();
    let mut offset = 0;
    let mut fence: Option<(u8, usize)> = None;
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\r', '\n']);
        let (line, line_offset) = if offset == 0 && line.starts_with('\u{feff}') {
            (&line['\u{feff}'.len_utf8()..], '\u{feff}'.len_utf8())
        } else {
            (line, offset)
        };
        let trimmed = line.trim_start();
        if let Some(&marker @ (b'`' | b'~')) = trimmed.as_bytes().first() {
            let count = trimmed.bytes().take_while(|byte| *byte == marker).count();
            if count >= 3 {
                match fence {
                    None => fence = Some((marker, count)),
                    Some((open, length))
                        if open == marker
                            && count >= length
                            && trimmed[count..].trim().is_empty() =>
                    {
                        fence = None
                    }
                    _ => (),
                }
            }
        }
        if line.contains("agentmon:instructions") {
            if fence.is_some() {
                return Err(manual_merge(
                    path,
                    "AgentMonitoring markers occur inside a code example",
                ));
            }
            if line == END {
                ends.push((line_offset, line_offset + line.len()));
            } else if let Some(meta) = line
                .strip_prefix(START)
                .and_then(|s| s.strip_suffix(" -->"))
            {
                let (version, language) = meta
                    .split_once(" lang=")
                    .ok_or_else(|| manual_merge(path, "malformed AgentMonitoring marker"))?;
                let version = version
                    .parse::<u32>()
                    .map_err(|_| manual_merge(path, "malformed AgentMonitoring version"))?;
                if version == 0 || version > MANAGED_VERSION {
                    return Err(manual_merge(
                        path,
                        "unsupported AgentMonitoring instruction version",
                    ));
                }
                let language = match language {
                    "ko" => ClaudeMdLang::Ko,
                    "en" => ClaudeMdLang::En,
                    _ => return Err(manual_merge(path, "malformed AgentMonitoring language")),
                };
                begins.push((line_offset, language));
            } else {
                return Err(manual_merge(path, "malformed AgentMonitoring marker"));
            }
        }
        for language in [ClaudeMdLang::Ko, ClaudeMdLang::En] {
            if line == language.heading() {
                if fence.is_some() {
                    return Err(manual_merge(
                        path,
                        "legacy AgentMonitoring instructions occur inside a code example",
                    ));
                }
                headings.push((line_offset, language));
            }
        }
        offset += raw.len();
    }
    if fence.is_some() {
        return Err(manual_merge(
            path,
            "existing instructions have an unclosed code fence",
        ));
    }
    if !begins.is_empty() || !ends.is_empty() {
        if begins.len() != 1 || ends.len() != 1 || begins[0].0 >= ends[0].0 {
            return Err(manual_merge(
                path,
                "unpaired or duplicate AgentMonitoring markers",
            ));
        }
        let (start, language) = begins[0];
        let end = ends[0].1;
        if headings.iter().any(|(at, _)| *at < start || *at >= end) {
            return Err(manual_merge(
                path,
                "additional legacy AgentMonitoring section",
            ));
        }
        return Ok(Some((start, end, language)));
    }
    if headings.is_empty() {
        return Ok(None);
    }
    if headings.len() != 1 {
        return Err(manual_merge(
            path,
            "multiple legacy AgentMonitoring sections",
        ));
    }
    let (start, language) = headings[0];
    let canonical = language.legacy().replace("\r\n", "\n");
    for newline in ["\n", "\r\n"] {
        let legacy = canonical.trim_end_matches('\n').replace('\n', newline);
        if text[start..].starts_with(&legacy) {
            let end = start + legacy.len();
            if end == text.len() || text[end..].starts_with('\n') || text[end..].starts_with("\r\n")
            {
                return Ok(Some((start, end, language)));
            }
        }
    }
    Err(manual_merge(
        path,
        "legacy AgentMonitoring instructions contain custom edits",
    ))
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
            assert!(
                t.starts_with(START),
                "template must open with its version marker"
            );
            assert!(t.contains(lang.heading()));
            assert!(t.ends_with(&format!("{END}\n")));
            assert!(t.ends_with('\n'));
            for tool in [
                "log_work",
                "update_work",
                "report_bug",
                "resolve_bug",
                "note",
                "status",
            ] {
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
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            ClaudeMdLang::Ko.template()
        );

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
        assert!(joined.starts_with("# My repo\n\nRun `make dev`.\n\n<!-- agentmon:instructions"));
        assert!(joined.ends_with(ClaudeMdLang::En.template()));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lang_parses_the_two_words_and_refuses_the_rest() {
        assert_eq!(parse_claude_md_lang(" KO ").unwrap(), ClaudeMdLang::Ko);
        assert_eq!(parse_claude_md_lang("en").unwrap(), ClaudeMdLang::En);
        let err = parse_claude_md_lang("kr").unwrap_err();
        assert!(err.to_string().contains("ko, en"), "{err}");
        assert_eq!(parse_agents_md_lang(" KO ").unwrap(), ClaudeMdLang::Ko);
        assert!(parse_agents_md_lang("kr")
            .unwrap_err()
            .to_string()
            .contains("--agents-md"));
    }

    #[test]
    fn agents_instructions_preserve_existing_rules_and_coexist_with_claude() {
        let dir = tmp("both");
        let (claude_path, _) = write_claude_md(&dir, ClaudeMdLang::Ko).unwrap();
        let claude_before = fs::read(&claude_path).unwrap();
        let (agents_path, outcome) = write_agents_md(&dir, ClaudeMdLang::En).unwrap();
        assert_eq!(agents_path, dir.join("AGENTS.md"));
        assert_eq!(outcome, ClaudeMdOutcome::Created);
        assert_eq!(
            fs::read_to_string(&agents_path).unwrap(),
            ClaudeMdLang::En.template()
        );

        let theirs = "# Repository rules\r\n\r\nKeep the user's instructions.\r\n";
        fs::write(&agents_path, theirs).unwrap();
        assert_eq!(
            write_agents_md(&dir, ClaudeMdLang::Ko).unwrap().1,
            ClaudeMdOutcome::Appended
        );
        let appended = fs::read_to_string(&agents_path).unwrap();
        assert!(appended.starts_with(theirs));
        assert!(appended.ends_with(ClaudeMdLang::Ko.template()));
        for lang in [ClaudeMdLang::Ko, ClaudeMdLang::En] {
            assert_eq!(
                write_agents_md(&dir, lang).unwrap().1,
                ClaudeMdOutcome::AlreadyPresent
            );
            assert_eq!(fs::read_to_string(&agents_path).unwrap(), appended);
        }
        assert_eq!(fs::read(&claude_path).unwrap(), claude_before);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn migrates_exact_legacy_in_both_languages_and_newline_styles() {
        let dir = tmp("legacy");
        let path = dir.join("AGENTS.md");
        for lang in [ClaudeMdLang::Ko, ClaudeMdLang::En] {
            for newline in ["\n", "\r\n"] {
                for final_newline in [false, true] {
                    let legacy = lang
                        .legacy()
                        .replace("\r\n", "\n")
                        .trim_end_matches('\n')
                        .replace('\n', newline);
                    let before = format!(
                        "# 사용자 규칙\r\n\r\n{legacy}{}",
                        if final_newline { newline } else { "" }
                    );
                    fs::write(&path, &before).unwrap();
                    // Request another language: existing language stays unchanged.
                    let requested = if lang == ClaudeMdLang::Ko {
                        ClaudeMdLang::En
                    } else {
                        ClaudeMdLang::Ko
                    };
                    assert_eq!(
                        write_agents_md(&dir, requested).unwrap().1,
                        ClaudeMdOutcome::Updated
                    );
                    let expected = format!(
                        "# 사용자 규칙\r\n\r\n{}{}",
                        lang.template()
                            .replace("\r\n", "\n")
                            .trim_end_matches('\n')
                            .replace('\n', newline),
                        if final_newline { newline } else { "" }
                    );
                    assert_eq!(fs::read_to_string(&path).unwrap(), expected);
                    assert_eq!(
                        write_agents_md(&dir, requested).unwrap().1,
                        ClaudeMdOutcome::AlreadyPresent
                    );
                    assert_eq!(fs::read_to_string(&path).unwrap(), expected);
                }
            }
        }
        // Preserve custom text after an exact legacy section byte for byte too.
        let prefix = "# Before\r\n\r\n";
        let suffix = "\n\n# After\r\nCustom rules must stay.\r\n";
        fs::write(&path, format!("{prefix}{}{suffix}", LEGACY_EN.trim_end())).unwrap();
        assert_eq!(
            write_agents_md(&dir, ClaudeMdLang::Ko).unwrap().1,
            ClaudeMdOutcome::Updated
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("{prefix}{}{suffix}", TEMPLATE_EN.trim_end())
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refreshes_only_the_managed_section_and_preserves_its_language() {
        let dir = tmp("managed");
        let path = dir.join("CLAUDE.md");
        let prefix = "# Before\r\nUser wording\r\n\r\n";
        let suffix = "\r\n\r\n# After\r\nMore custom rules.\r\n";
        let old = format!("{START}1 lang=en -->\r\n# Work records — AgentMonitoring\r\nOlder managed instructions.\r\n{END}");
        fs::write(&path, format!("{prefix}{old}{suffix}")).unwrap();
        assert_eq!(
            write_claude_md(&dir, ClaudeMdLang::Ko).unwrap().1,
            ClaudeMdOutcome::Updated
        );
        let expected = format!(
            "{prefix}{}{suffix}",
            TEMPLATE_EN.trim_end().replace('\n', "\r\n")
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), expected);
        assert_eq!(
            write_claude_md(&dir, ClaudeMdLang::Ko).unwrap().1,
            ClaudeMdOutcome::AlreadyPresent
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), expected);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_edited_legacy_and_malformed_sections_without_writing() {
        let dir = tmp("refusals");
        let path = dir.join("AGENTS.md");
        for original in [
            LEGACY_KO.replace("한국어 존댓말", "한국어"),
            format!("{LEGACY_EN}\n{LEGACY_KO}"),
            TEMPLATE_EN.replace(END, ""),
            TEMPLATE_EN.replace("version=2", "version=99"),
            TEMPLATE_EN.replace("version=2", "version=oops"),
            TEMPLATE_EN.replace("lang=en", "lang=xx"),
            TEMPLATE_EN.replace("<!-- agentmon:", " <!-- agentmon:"),
            format!("{END}\n{TEMPLATE_EN}"),
            format!("{TEMPLATE_EN}{TEMPLATE_EN}"),
            format!("{TEMPLATE_EN}\n{LEGACY_EN}"),
            format!("{END}\n{START}2 lang=en -->\n"),
            format!("```markdown\n{TEMPLATE_EN}```\n"),
            format!("~~~markdown\n{LEGACY_EN}~~~\n"),
            "# Custom rules\n```markdown\nUnclosed example".to_string(),
        ] {
            fs::write(&path, &original).unwrap();
            let error = write_agents_md(&dir, ClaudeMdLang::En)
                .unwrap_err()
                .to_string();
            assert!(error.contains("manually merge"), "{error}");
            assert_eq!(fs::read_to_string(&path).unwrap(), original);
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn preserves_a_utf8_bom_during_migration_and_repeat() {
        let dir = tmp("bom");
        let path = dir.join("AGENTS.md");
        fs::write(&path, format!("\u{feff}{LEGACY_KO}")).unwrap();
        assert_eq!(
            write_agents_md(&dir, ClaudeMdLang::En).unwrap().1,
            ClaudeMdOutcome::Updated
        );
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("\u{feff}{TEMPLATE_KO}")
        );
        assert_eq!(
            write_agents_md(&dir, ClaudeMdLang::En).unwrap().1,
            ClaudeMdOutcome::AlreadyPresent
        );
        fs::remove_dir_all(&dir).unwrap();
    }
}
