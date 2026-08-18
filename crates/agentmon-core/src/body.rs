//! Markdown body parsing: split a record body into the `##` sections SPEC.md defines,
//! and split `## Updates` / `## Comments` into their `###` entries.
//!
//! Rules that matter:
//!   * headings inside fenced code blocks are not headings;
//!   * heading matching is case-insensitive and tolerates trailing punctuation;
//!   * unknown sections are never dropped — callers put them in `extra_sections`.

use crate::model::{BugComment, Section, WorkUpdate};

/// Split a full record file into (frontmatter, body). Returns `None` when the file has
/// no `---` frontmatter fence.
pub fn split_frontmatter(text: &str) -> Option<(&str, &str)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let rest = text
        .strip_prefix("---\r\n")
        .or_else(|| text.strip_prefix("---\n"))?;
    // Find the closing fence at the start of a line.
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let fm = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return Some((fm, body));
        }
        offset += line.len();
    }
    None
}

fn is_fence(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("```") || t.starts_with("~~~")
}

/// Heading level of a line (1..6), ignoring lines inside code fences.
fn heading(line: &str) -> Option<(usize, &str)> {
    let t = line.trim_end();
    if !t.starts_with('#') {
        return None;
    }
    let hashes = t.chars().take_while(|c| *c == '#').count();
    let rest = &t[hashes..];
    if !rest.starts_with(' ') && !rest.is_empty() {
        return None;
    }
    Some((hashes, rest.trim()))
}

/// Split a body into level-2 sections, in document order. Content before the first
/// `##` heading is returned as a section with an empty title.
pub fn sections(body: &str) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    let mut current = Section {
        title: String::new(),
        body: String::new(),
    };
    let mut in_fence = false;
    for line in body.lines() {
        if is_fence(line) {
            in_fence = !in_fence;
        }
        if !in_fence {
            if let Some((2, title)) = heading(line) {
                if !current.title.is_empty() || !current.body.trim().is_empty() {
                    current.body = current.body.trim().to_string();
                    out.push(current);
                }
                current = Section {
                    title: title.to_string(),
                    body: String::new(),
                };
                continue;
            }
        }
        current.body.push_str(line);
        current.body.push('\n');
    }
    if !current.title.is_empty() || !current.body.trim().is_empty() {
        current.body = current.body.trim().to_string();
        out.push(current);
    }
    out
}

/// Case-insensitive section lookup that tolerates `## What:` and `## what`.
pub fn take_section(sections: &mut Vec<Section>, name: &str) -> Option<String> {
    let want = name.to_ascii_lowercase();
    let idx = sections.iter().position(|s| {
        let t = s.title.trim().trim_end_matches(':').to_ascii_lowercase();
        t == want
    })?;
    let s = sections.remove(idx);
    Some(s.body)
}

/// Split a section body into `### <heading>` entries.
fn entries(body: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;
    let mut in_fence = false;
    for line in body.lines() {
        if is_fence(line) {
            in_fence = !in_fence;
        }
        if !in_fence {
            if let Some((3, title)) = heading(line) {
                if let Some((t, b)) = current.take() {
                    out.push((t, b.trim().to_string()));
                }
                current = Some((title.to_string(), String::new()));
                continue;
            }
        }
        if let Some((_, b)) = current.as_mut() {
            b.push_str(line);
            b.push('\n');
        }
    }
    if let Some((t, b)) = current.take() {
        out.push((t, b.trim().to_string()));
    }
    out
}

/// `## Updates` entries — the heading is the ISO8601 timestamp.
pub fn work_updates(section: &str) -> Vec<WorkUpdate> {
    entries(section)
        .into_iter()
        .map(|(ts, body)| WorkUpdate {
            ts: ts.trim().to_string(),
            body,
        })
        .collect()
}

/// `## Comments` entries — heading is `<ts> — <agent>` (em dash per SPEC, en dash and
/// plain hyphen accepted).
pub fn bug_comments(section: &str) -> Vec<BugComment> {
    entries(section)
        .into_iter()
        .map(|(head, body)| {
            let (ts, agent) = split_comment_heading(&head);
            BugComment { ts, agent, body }
        })
        .collect()
}

fn split_comment_heading(head: &str) -> (String, String) {
    for sep in ["—", "–", " - ", "|"] {
        if let Some((ts, agent)) = head.split_once(sep) {
            return (ts.trim().to_string(), agent.trim().to_string());
        }
    }
    (head.trim().to_string(), String::new())
}

// ---------------------------------------------------------------------------
// editing (the CLI's write path)
// ---------------------------------------------------------------------------

/// Render sections back to markdown: one blank line after each `##` heading, one blank
/// line between sections. Content inside a section is untouched, so code fences, lists
/// and tables survive a rewrite byte for byte.
pub fn render(sections: &[Section]) -> String {
    let mut out = String::new();
    for s in sections {
        if s.title.is_empty() {
            if s.body.trim().is_empty() {
                continue;
            }
            out.push_str(s.body.trim());
            out.push_str("\n\n");
        } else {
            out.push_str("## ");
            out.push_str(&s.title);
            out.push_str("\n\n");
            if !s.body.trim().is_empty() {
                out.push_str(s.body.trim());
                out.push_str("\n\n");
            }
        }
    }
    out
}

/// Index of a section by name (case-insensitive, tolerates a trailing colon).
fn find(sections: &[Section], name: &str) -> Option<usize> {
    let want = name.to_ascii_lowercase();
    sections
        .iter()
        .position(|s| s.title.trim().trim_end_matches(':').to_ascii_lowercase() == want)
}

/// Where a new section belongs: after the last of its predecessors in `order`, so a
/// record written by an older build still gets `## Outcome` in the right place.
fn insertion_point(sections: &[Section], name: &str, order: &[&str]) -> usize {
    let Some(rank) = order.iter().position(|o| o.eq_ignore_ascii_case(name)) else {
        return sections.len();
    };
    let mut at = 0;
    for (i, s) in sections.iter().enumerate() {
        let t = s.title.trim().trim_end_matches(':');
        let r = order.iter().position(|o| o.eq_ignore_ascii_case(t));
        match r {
            Some(r) if r < rank => at = i + 1,
            // Unknown sections stay where the author put them; they never push a known
            // section past their position.
            None if t.is_empty() => at = i + 1,
            _ => {}
        }
    }
    at
}

/// Set (replacing) a `## <name>` section, creating it in canonical position if absent.
pub fn upsert_section(sections: &mut Vec<Section>, name: &str, body: &str, order: &[&str]) {
    match find(sections, name) {
        Some(i) => {
            sections[i].title = name.to_string();
            sections[i].body = body.trim().to_string();
        }
        None => {
            let at = insertion_point(sections, name, order);
            sections.insert(
                at,
                Section {
                    title: name.to_string(),
                    body: body.trim().to_string(),
                },
            );
        }
    }
}

/// Append a `### <heading>` entry to a section (`## Updates`, `## Comments`), creating
/// the section if this is the first entry.
pub fn append_entry(
    sections: &mut Vec<Section>,
    name: &str,
    heading: &str,
    body: &str,
    order: &[&str],
) {
    let entry = format!("### {}\n\n{}", heading.trim(), body.trim());
    match find(sections, name) {
        Some(i) => {
            let existing = sections[i].body.trim().to_string();
            sections[i].body = if existing.is_empty() {
                entry
            } else {
                format!("{existing}\n\n{entry}")
            };
        }
        None => {
            let at = insertion_point(sections, name, order);
            sections.insert(
                at,
                Section {
                    title: name.to_string(),
                    body: entry,
                },
            );
        }
    }
}

/// Frontmatter lines for keys this build does not know about.
///
/// The CLI rewrites frontmatter from typed structs in the exact key order SPEC.md shows;
/// without this, a key written by a newer build would be silently dropped the first time
/// an older build touched the record. Multi-line values (block scalars, nested maps) are
/// carried across whole.
pub fn extra_frontmatter(frontmatter: &str, known: &[&str]) -> String {
    let mut out = String::new();
    let mut keeping = false;
    for line in frontmatter.lines() {
        let is_top_level_key = !line.starts_with([' ', '\t', '-']) && line.contains(':');
        if is_top_level_key {
            let key = line.split(':').next().unwrap_or("").trim();
            keeping = !key.is_empty() && !known.iter().any(|k| k.eq_ignore_ascii_case(key));
        } else if line.trim().is_empty() {
            keeping = false;
            continue;
        }
        if keeping {
            out.push_str(line.trim_end());
            out.push('\n');
        }
    }
    out
}

/// `[label](href)` starting at `open` — returns the label and the index just past `)`.
fn link_at(chars: &[char], open: usize) -> Option<(String, usize)> {
    let close = chars[open + 1..].iter().position(|c| *c == ']')? + open + 1;
    if chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let end = chars[close + 2..].iter().position(|c| *c == ')')? + close + 2;
    let label: String = chars[open + 1..close].iter().filter(|c| **c != '`').collect();
    Some((label, end + 1))
}

/// Drop the inline markdown that reads as noise in a one-line preview: `code` spans,
/// `**bold**` markers and `[label](href)` links.
///
/// Single `*` and `_` are deliberately left alone — in these records they occur inside
/// identifiers (`resolved_by`, `*mut`) far more often than as emphasis, and mangling an
/// identifier is worse than showing one stray asterisk.
fn strip_inline(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '`' {
            i += 1;
            continue;
        }
        if c == '*' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            continue;
        }
        if c == '[' {
            if let Some((label, next)) = link_at(&chars, i) {
                out.push_str(&label);
                i = next;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// First paragraph of a section, collapsed to one line and clipped — used for list previews.
pub fn excerpt(text: &str, max_chars: usize) -> String {
    let para = text
        .split("\n\n")
        .map(str::trim)
        .find(|p| !p.is_empty() && !p.starts_with("```"))
        .unwrap_or("");
    let flat = strip_inline(para)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if flat.chars().count() <= max_chars {
        return flat;
    }
    let mut cut: String = flat.chars().take(max_chars).collect();
    if let Some(idx) = cut.rfind(' ') {
        cut.truncate(idx);
    }
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = "---\nid: WORK-0001\n---\n## What\nBuilt the parser.\n\nSecond para.\n\n## Why\nBecause.\n\n## Updates\n### 2026-08-18T10:00:00Z\nProgress note.\n\n### 2026-08-18T12:00:00Z\nMore.\n\n## Outcome\nShipped.\n";

    #[test]
    fn splits_frontmatter_and_sections() {
        let (fm, body) = split_frontmatter(DOC).expect("has frontmatter");
        assert_eq!(fm.trim(), "id: WORK-0001");
        let mut secs = sections(body);
        assert_eq!(take_section(&mut secs, "What").unwrap().lines().count(), 3);
        assert_eq!(take_section(&mut secs, "why").unwrap(), "Because.");
        let updates = work_updates(&take_section(&mut secs, "Updates").unwrap());
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[1].ts, "2026-08-18T12:00:00Z");
        assert_eq!(updates[0].body, "Progress note.");
        assert_eq!(take_section(&mut secs, "Outcome").unwrap(), "Shipped.");
        assert!(secs.is_empty(), "no leftovers: {secs:?}");
    }

    #[test]
    fn headings_inside_code_fences_are_not_headings() {
        let body = "## What\n```md\n## Why\n```\nstill what\n";
        let secs = sections(body);
        assert_eq!(secs.len(), 1);
        assert!(secs[0].body.contains("## Why"));
    }

    #[test]
    fn comment_headings_split_on_em_dash() {
        let comments = bug_comments("### 2026-08-18T10:00:00Z — ui-builder\nReproduced.\n");
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].agent, "ui-builder");
        assert_eq!(comments[0].ts, "2026-08-18T10:00:00Z");
    }

    #[test]
    fn excerpt_collapses_and_clips() {
        assert_eq!(excerpt("one two\nthree\n\nnext para", 100), "one two three");
        assert!(excerpt(&"word ".repeat(80), 40).ends_with('…'));
    }

    #[test]
    fn excerpt_drops_inline_markdown_but_keeps_identifiers() {
        assert_eq!(
            excerpt("A workspace with `src-tauri` and **three** members.", 200),
            "A workspace with src-tauri and three members."
        );
        assert_eq!(
            excerpt("See [the spec](https://example.com/spec.md) first.", 200),
            "See the spec first."
        );
        // snake_case and pointer syntax survive untouched
        assert_eq!(
            excerpt("resolved_by is written as &mut *ptr", 200),
            "resolved_by is written as &mut *ptr"
        );
    }
}
