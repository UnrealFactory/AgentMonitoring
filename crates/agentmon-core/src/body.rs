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

/// One space character, for every parser in this crate and its Node twin.
///
/// It exists because `str::trim` and JavaScript's `String.prototype.trim` are *not* the
/// same function, and this crate's guard against a smuggled `## For humans` is only as
/// wide as the narrower of the two. `U+FEFF` (the byte-order mark) was dropped from
/// Unicode's `White_Space` property in 4.0.1, so Rust does not trim it and JavaScript
/// (whose spec still lists `<ZWNBSP>`) does: `\u{feff}## For humans` in a `--body` was not
/// a heading to Rust, sailed through the guard, and then came back out of
/// scripts/project-fs.mjs as a reserved-titled section in the agent-area payload — the one
/// thing SPEC.md says that payload never contains. `U+0085` splits them the other way.
/// Both sides trim the **union**, so both sides see the same headings.
pub(crate) fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// A code point that paints **nothing at all** — no glyph, no gap.
///
/// Unicode's `Default_Ignorable_Code_Point` set (the zero-width space and its family, the
/// bidi marks, the soft hyphen, the variation selectors, the tag characters) plus the rest
/// of general category `Cf`. Written out as ranges because this crate has no Unicode
/// database dependency and these ranges do not move: a code point that is ignorable is
/// ignorable forever, and new ones only ever add to the list.
///
/// It is not [`is_space`], and the difference is the whole point. A space *is* ink of a
/// kind — it separates two words, and both trims and every `\s` in the app agree it is
/// there. `U+200B` is not: it separates nothing, no renderer draws it, and no `trim` on
/// either side of this codebase removes it. That made it the perfect smuggler's byte —
/// `## For humans\u{200b}` is drawn by src/lib/markdown-parse.ts as a level-2 heading whose
/// visible text is exactly `For humans`, while a title comparison that only collapsed
/// whitespace read it as a *different* title and let it through `--body`. Titles are
/// compared with these removed ([`crate::human`]), so a character the reader cannot see
/// cannot make two identical-looking headings different.
///
/// Only *comparisons* drop these. Nothing that is stored does — `U+200D` (zero-width
/// joiner) and `U+FE0F` (the variation selector that makes an emoji an emoji) are load
/// bearing inside a real string, so [`heading`] and [`sections`] keep every byte an author
/// wrote.
pub(crate) fn is_ignorable(c: char) -> bool {
    matches!(c as u32,
        0x00ad                    // soft hyphen — drawn only at a line break
        | 0x034f                  // combining grapheme joiner
        | 0x061c                  // arabic letter mark
        | 0x115f..=0x1160         // hangul choseong/jungseong fillers
        | 0x17b4..=0x17b5         // khmer inherent vowels
        | 0x180b..=0x180f         // mongolian variation selectors and separators
        | 0x200b..=0x200f         // zero width space, non-joiner, joiner, LRM, RLM
        | 0x202a..=0x202e         // bidi embedding and override controls
        | 0x2060..=0x206f         // word joiner, invisible operators, deprecated formats
        | 0x3164                  // hangul filler
        | 0xfe00..=0xfe0f         // variation selectors
        | 0xfeff                  // zero width no-break space (the byte-order mark)
        | 0xffa0                  // halfwidth hangul filler
        | 0xfff0..=0xfff8         // unassigned-but-reserved format range
        | 0x1bca0..=0x1bca3       // shorthand format controls
        | 0x1d173..=0x1d17a       // musical formatting controls
        | 0xe0000..=0xe0fff       // tags and the variation selectors supplement
        // …and the format characters that are not default-ignorable but still draw
        // nothing on their own: the Arabic and Kaithi prefixed-format signs.
        | 0x0600..=0x0605 | 0x06dd | 0x070f | 0x0890..=0x0891 | 0x08e2
        | 0x110bd | 0x110cd | 0x13430..=0x1343f
        // …and one Unicode does not call ignorable at all: the empty braille cell, six
        // dots with none of them raised. It is a letter to Unicode and nothing to every
        // font that draws it, which is why it is the character people paste when they want
        // to send a message that looks empty.
        | 0x2800
    )
}

pub(crate) fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}

pub(crate) fn trim_end(s: &str) -> &str {
    s.trim_end_matches(is_space)
}

fn trim_start(s: &str) -> &str {
    s.trim_start_matches(is_space)
}

/// The marker char of a fence line — `` ` `` or `~`, or `None` for an ordinary line.
fn fence_marker(line: &str) -> Option<char> {
    let t = trim_start(line);
    if t.starts_with("```") {
        Some('`')
    } else if t.starts_with("~~~") {
        Some('~')
    } else {
        None
    }
}

/// A closing fence: three or more of the *opening* marker and nothing else on the line.
fn closes_fence(line: &str, marker: char) -> bool {
    let t = trim(line);
    t.chars().count() >= 3 && t.chars().all(|c| c == marker)
}

/// Which lines are inside a fenced code block, by the rule the app's own renderer uses
/// (src/lib/markdown-parse.ts: a block opened with ``` closes on a line of 3+ backticks
/// and nothing else).
///
/// The naive version — one boolean toggled by any fence line — disagreed with that
/// renderer, and the disagreement was a hole in the reserved-heading guard rather than a
/// curiosity. Take a body whose lines are, in order: a backtick fence, `a`, a *tilde*
/// fence, `b`, a backtick fence, `## For humans`, `x`, a tilde fence. The toggle flips
/// four times and ends balanced, with the heading counted *inside* a fence, so nothing
/// refused it — while `parseBlocks` closes the backtick block at the second backtick fence
/// and draws a level-2 heading reading "For humans" over the agent's own words. Matching
/// the marker char makes the two agree.
#[derive(Default)]
pub(crate) struct Fences {
    open: Option<char>,
}

impl Fences {
    /// Feed one line, in document order. `true` means the line is code — both fence lines
    /// included, neither of which can be a heading anyway.
    pub(crate) fn feed(&mut self, line: &str) -> bool {
        match self.open {
            None => match fence_marker(line) {
                Some(marker) => {
                    self.open = Some(marker);
                    true
                }
                None => false,
            },
            Some(marker) => {
                if closes_fence(line, marker) {
                    self.open = None;
                }
                true
            }
        }
    }

    fn is_open(&self) -> bool {
        self.open.is_some()
    }
}

/// 1-based number of the fence line that `text` never closes, if there is one.
///
/// Text that ends *inside* a fence swallows every heading written after it. That is only a
/// curiosity while the record is being read; it is a data loss while one is being written,
/// because the reserved `## For humans` section is appended last — an agent that pastes a
/// stack trace and forgets the closing ``` would get a record whose human area is code, and
/// every repair would append another swallowed heading. [`crate::human`] turns this into a
/// refusal before anything is written.
pub(crate) fn open_fence_line(text: &str) -> Option<usize> {
    let mut fences = Fences::default();
    let mut opened_at: Option<usize> = None;
    for (i, line) in text.lines().enumerate() {
        let was_open = fences.is_open();
        fences.feed(line);
        match (was_open, fences.is_open()) {
            (false, true) => opened_at = Some(i + 1),
            (true, false) => opened_at = None,
            _ => {}
        }
    }
    opened_at
}

/// Heading level of a line (1..6), ignoring lines inside code fences.
///
/// `pub(crate)` for [`crate::human`], which has to find the reserved `## For humans`
/// heading by exactly the rules this module splits sections by.
///
/// Two rules, and both of them are the same rule: **this function must call a heading
/// everything any reader downstream of it calls a heading**, because the reserved-heading
/// guard is built on it and a reader it does not know about is a hole.
///
/// * **Leading whitespace is ignored**, exactly as a fence's is. They disagreed once:
///   `heading` anchored at column 0, so `  ## For humans` inside `--body` was not a heading
///   to [`crate::human::contains_heading`] and the write was allowed — but [`sections`]
///   trims each section body, which strips the indent off its *first* line, so [`render`]
///   then wrote that very heading back at column 0.
/// * **The hash run is closed by any space, not by `' '` alone.** CommonMark says a space
///   or a tab; the app's renderer (src/lib/markdown-parse.ts) says `\s`, which is both of
///   those plus the no-break space. `##\tFor humans` and `##\u{a0}For humans` were
///   therefore headings to the app and plain text here, and a `--body` carrying either was
///   written without complaint — leaving the Agent view drawing a heading that reads "For
///   humans" over prose saying it is not the record's human area.
///
/// Anything ambiguous is a heading here: this function only ever *refuses* a write, so
/// seeing one heading too many costs an agent a reworded line, and seeing one too few
/// costs the record its human area.
pub(crate) fn heading(line: &str) -> Option<(usize, &str)> {
    let t = trim(line);
    if !t.starts_with('#') {
        return None;
    }
    let hashes = t.chars().take_while(|c| *c == '#').count();
    let rest = &t[hashes..];
    if !rest.is_empty() && !rest.starts_with(is_space) {
        return None;
    }
    Some((hashes, trim(rest)))
}

/// Split a body into level-2 sections, in document order. Content before the first
/// `##` heading is returned as a section with an empty title.
pub fn sections(body: &str) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    let mut current = Section {
        title: String::new(),
        body: String::new(),
    };
    let mut fences = Fences::default();
    for line in body.lines() {
        if !fences.feed(line) {
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

/// Split a section body into `### <heading>` entries. `is_entry` decides whether a `###`
/// heading opens a new entry; one that does not is an agent's own subheading inside its
/// message, and stays in the body of the entry it was written under.
fn entries(body: &str, is_entry: impl Fn(&str) -> bool) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;
    let mut fences = Fences::default();
    for line in body.lines() {
        if !fences.feed(line) {
            if let Some((3, title)) = heading(line) {
                if is_entry(title) {
                    if let Some((t, b)) = current.take() {
                        out.push((t, b.trim().to_string()));
                    }
                    current = Some((title.to_string(), String::new()));
                    continue;
                }
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

/// Does a heading open with a date (`2026-08-21…`), the way every `### <timestamp>` entry
/// the CLI writes does? The gate that keeps an agent's own `### R7 builder — …` subheading
/// inside its message: without it, that line became an entry whose "timestamp" was a
/// sentence — drawn as "—" in the app, and string-`>` than every real ISO stamp, so it
/// poisoned lastActivity and the record's sort position too.
pub(crate) fn starts_with_date(text: &str) -> bool {
    let b = text.trim_start().as_bytes();
    b.len() >= 10
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// `## Updates` entries — the heading is the ISO8601 timestamp.
pub fn work_updates(section: &str) -> Vec<WorkUpdate> {
    entries(section, starts_with_date)
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
    entries(section, starts_with_date)
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

/// The timestamp part of a `### <ts>` / `### <ts> — <agent>` entry heading — what the
/// entries of `## Updates` and `## Comments` sort by.
fn entry_stamp(heading: &str) -> String {
    split_comment_heading(heading).0
}

/// Insert a `### <heading>` entry into a section **at its place in the timeline** rather
/// than at the end — before the first existing entry whose timestamp is later, after
/// everything at the same second or earlier.
///
/// [`append_entry`] is the normal write: a new note is the newest thing on the record, so
/// the end *is* its place, and the ordering guards keep that true. This exists for the one
/// sanctioned exception — a **replay** (SPEC.md, "Backdating"), reconstructing a record
/// whose original was lost to a sync collision — where the honest time of a note is in the
/// middle of a timeline that already continued past it. Timestamps the CLI writes share
/// one normalized shape, so the comparison is the same string comparison every reader
/// sorts by. Entry headings are found by the grammar the parser splits on (a level-3
/// heading opening with a date, outside code fences); everything else in the section stays
/// exactly where the author put it.
pub fn insert_entry_by_time(
    sections: &mut Vec<Section>,
    name: &str,
    heading_text: &str,
    body_text: &str,
    order: &[&str],
) {
    let Some(i) = find(sections, name) else {
        // First entry ever: creation and placement are the same act.
        append_entry(sections, name, heading_text, body_text, order);
        return;
    };
    let new_stamp = entry_stamp(heading_text);
    let raw = sections[i].body.clone();
    let mut fences = Fences::default();
    let mut insert_at: Option<usize> = None;
    let mut offset = 0usize;
    for line in raw.split_inclusive('\n') {
        if !fences.feed(line) {
            if let Some((3, title)) = heading(line) {
                if starts_with_date(title) && entry_stamp(title) > new_stamp {
                    insert_at = Some(offset);
                    break;
                }
            }
        }
        offset += line.len();
    }
    let entry = format!("### {}\n\n{}", heading_text.trim(), body_text.trim());
    sections[i].body = match insert_at {
        None => {
            let existing = raw.trim();
            if existing.is_empty() {
                entry
            } else {
                format!("{existing}\n\n{entry}")
            }
        }
        Some(pos) => {
            let before = raw[..pos].trim_end();
            let after = raw[pos..].trim_end();
            if before.is_empty() {
                format!("{entry}\n\n{after}")
            } else {
                format!("{before}\n\n{entry}\n\n{after}")
            }
        }
    };
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

/// Everything a reader can read in a record, flattened to one line for searching: the
/// section bodies with their inline markdown removed and their whitespace collapsed.
///
/// Section *headings* are deliberately left out. `## Report` is the app's furniture rather
/// than the author's words, and a board where typing "report" matches every bug is a board
/// whose search is useless.
pub fn search_text(parts: &[&str]) -> String {
    let mut out = String::new();
    for part in parts {
        for word in strip_inline(part).split_whitespace() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(word);
        }
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

    /// An indented `##` is a heading, and `render(sections(x))` is stable.
    ///
    /// The pair is the bug: `heading` used to anchor at column 0 while `sections` trimmed
    /// each section body, so `  ## For humans` survived every guard as ordinary text and
    /// then came back out of `render` as a real column-0 section — a record with two human
    /// areas, an empty `## What`, and `doctor` failing the file the CLI had just accepted.
    #[test]
    fn an_indented_heading_is_a_heading_and_a_rendered_body_reparses_the_same() {
        for indent in ["  ", "   ", "    ", "\t"] {
            let secs = sections(&format!("## What\n\n{indent}## For humans\n\nSmuggled.\n"));
            assert_eq!(secs.len(), 2, "{indent:?} -> {secs:?}");
            assert_eq!(secs[1].title, "For humans", "{indent:?}");
        }
        // …and the round trip no longer promotes anything: parse, render, parse again
        // gives the same sections, which is what makes checking the rendered bytes sound.
        let src = "## What\n\n  ## For humans\n\nSmuggled.\n\n## Why\n\nBecause.\n";
        let once = render(&sections(src));
        assert_eq!(render(&sections(&once)), once, "render(sections(x)) is a fixed point");
        // An indented fence still hides an indented heading, exactly as a flush one does.
        let fenced = sections("## What\n\n  ```md\n  ## For humans\n  ```\n");
        assert_eq!(fenced.len(), 1, "{fenced:?}");
        assert!(fenced[0].body.contains("## For humans"));
    }

    /// The hash run is closed by **any** space, not by `' '` alone.
    ///
    /// `##\tFor humans` was not a heading here and was one to the app's own renderer
    /// (src/lib/markdown-parse.ts, `/^(#{1,6})\s+(.*)$/`), so a `--body` carrying it was
    /// written without complaint and the Agent view drew a level-2 heading reading "For
    /// humans" over the agent's prose. `\u{a0}` (no-break space) split them the same way,
    /// and `\u{feff}` split the two *transports*: JavaScript's `trim` strips it and Rust's
    /// does not, so the browser reader saw a section the desktop reader did not.
    #[test]
    fn any_space_closes_the_hash_run_and_bom_never_hides_one() {
        for gap in [" ", "\t", "\u{a0}", "\u{2003}", "  ", " \t"] {
            assert_eq!(
                heading(&format!("##{gap}For humans")),
                Some((2, "For humans")),
                "gap {gap:?} did not close the hash run",
            );
        }
        // …and the byte-order mark is space to this crate too, wherever it sits.
        assert_eq!(heading("\u{feff}## For humans"), Some((2, "For humans")));
        assert_eq!(heading("## For humans\u{feff}"), Some((2, "For humans")));
        assert_eq!(heading("##\u{feff}For humans"), Some((2, "For humans")));
        assert_eq!(sections("## What\n\n\u{feff}## Why\n\nx\n").len(), 2);
        // A hash run with nothing after it is still a heading; one glued to a word is not.
        assert_eq!(heading("##"), Some((2, "")));
        assert_eq!(heading("##For humans"), None);
        assert_eq!(heading("plain text"), None);
        // A BOM does not turn an ordinary line into a fence either.
        assert_eq!(open_fence_line("\u{feff}```\nstill open\n"), Some(1));
    }

    /// A fence closes on its own marker, the way src/lib/markdown-parse.ts closes one.
    ///
    /// The naive toggle (any fence line flips a boolean) let a heading hide from this file
    /// while staying visible to the app: in ```` ```/a/~~~/b/```/## For humans/x/~~~ ````
    /// the toggle ends balanced with the heading inside a fence, so nothing refused it,
    /// while `parseBlocks` closed the block at the second ``` and drew the heading.
    #[test]
    fn a_fence_closes_only_on_its_own_marker() {
        let smuggled = "```\na\n~~~\nb\n```\n## For humans\nx\n~~~\n";
        assert_eq!(open_fence_line(smuggled), Some(8), "the ~~~ on line 8 is the open one");
        let secs = sections(smuggled);
        assert!(
            secs.iter().any(|s| s.title == "For humans"),
            "the heading is outside the ``` block, exactly as the app reads it: {secs:?}",
        );
        // A tilde block holds a ``` as content, and vice versa.
        assert_eq!(open_fence_line("~~~\n```\n~~~\n"), None);
        assert_eq!(sections("## What\n\n~~~\n## Why\n~~~\n").len(), 1);
        // An info string opens but never closes: ```` ```rust ```` is not a closing fence.
        assert_eq!(open_fence_line("```\na\n```rust\n"), Some(1));
    }

    #[test]
    fn comment_headings_split_on_em_dash() {
        let comments = bug_comments("### 2026-08-18T10:00:00Z — ui-builder\nReproduced.\n");
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].agent, "ui-builder");
        assert_eq!(comments[0].ts, "2026-08-18T10:00:00Z");
    }

    /// A `###` an agent writes *inside* its message (ElmwoodOnline's WORK-0007: "### R7
    /// 빌더 — …") is that update's own subheading, not a new entry — as an entry it had
    /// no timestamp to print ("—" in the app) and, being string-greater than any ISO
    /// stamp, hijacked lastActivity.
    #[test]
    fn a_subheading_inside_a_message_does_not_open_an_entry() {
        let section = "### 2026-08-21T10:07:40Z\n\n### R7 빌더 — 정정 셋\n\nDetails.\n\n\
                       ### 2026-08-21T11:00:00Z\n\nNext round.\n";
        let updates = work_updates(section);
        assert_eq!(updates.len(), 2, "{updates:?}");
        assert_eq!(updates[0].ts, "2026-08-21T10:07:40Z");
        assert!(updates[0].body.contains("### R7 빌더 — 정정 셋"));
        assert!(updates[0].body.contains("Details."));
        assert_eq!(updates[1].ts, "2026-08-21T11:00:00Z");

        let comments =
            bug_comments("### 2026-08-18T10:00:00Z — ui-builder\n\n### repro steps\n\n1. run\n");
        assert_eq!(comments.len(), 1);
        assert!(comments[0].body.contains("### repro steps"));

        // A date is a date even without a clock; a sentence starting with digits is not.
        assert!(starts_with_date("2026-08-18"));
        assert!(!starts_with_date("R7 빌더 — 정정"));
        assert!(!starts_with_date("2026년 8월 21일"));
    }

    /// The replay write path: an entry lands at its place in the timeline, not at the end.
    #[test]
    fn insert_entry_by_time_lands_between_its_neighbours() {
        let src = "## Updates\n\n### 2026-08-18T09:00:00Z\n\nFirst.\n\n### 2026-08-18T12:00:00Z\n\nThird.\n";
        let mut secs = sections(src);
        insert_entry_by_time(
            &mut secs,
            "Updates",
            "2026-08-18T10:30:00Z",
            "Replayed middle.",
            &["What", "Why", "How", "Updates", "Outcome"],
        );
        let updates = work_updates(&take_section(&mut secs.clone(), "Updates").unwrap());
        let stamps: Vec<&str> = updates.iter().map(|u| u.ts.as_str()).collect();
        assert_eq!(
            stamps,
            ["2026-08-18T09:00:00Z", "2026-08-18T10:30:00Z", "2026-08-18T12:00:00Z"],
            "{updates:?}"
        );
        assert_eq!(updates[1].body, "Replayed middle.");

        // Later than everything (or an empty/missing section) appends, same as append_entry.
        insert_entry_by_time(
            &mut secs,
            "Updates",
            "2026-08-18T13:00:00Z",
            "Last.",
            &["What", "Why", "How", "Updates", "Outcome"],
        );
        let mut fresh: Vec<Section> = Vec::new();
        insert_entry_by_time(&mut fresh, "Updates", "2026-08-18T09:00:00Z", "Only.", &["Updates"]);
        assert_eq!(fresh.len(), 1);
        assert!(fresh[0].body.starts_with("### 2026-08-18T09:00:00Z"));
        let updates = work_updates(&take_section(&mut secs, "Updates").unwrap());
        assert_eq!(updates.last().unwrap().body, "Last.");

        // Equal stamps insert *after* the existing one: stable, like the normal append.
        let mut equal = sections("## Updates\n\n### 2026-08-18T09:00:00Z\n\nOriginal.\n");
        insert_entry_by_time(&mut equal, "Updates", "2026-08-18T09:00:00Z", "Same second.", &["Updates"]);
        let updates = work_updates(&take_section(&mut equal, "Updates").unwrap());
        assert_eq!(updates[0].body, "Original.");
        assert_eq!(updates[1].body, "Same second.");
    }

    /// A `### <date>` inside a code fence, or an agent's own dated subheading in a message,
    /// must not become an insertion point — the same grammar `entries()` splits by.
    #[test]
    fn insert_entry_by_time_ignores_fenced_and_comment_headings_split_on_their_stamp() {
        let src = "## Updates\n\n### 2026-08-18T09:00:00Z\n\nLog:\n\n```\n### 2026-08-18T09:30:00Z\n```\n\n### 2026-08-18T12:00:00Z\n\nLater.\n";
        let mut secs = sections(src);
        insert_entry_by_time(&mut secs, "Updates", "2026-08-18T10:00:00Z", "Middle.", &["Updates"]);
        let body = &secs[find(&secs, "Updates").unwrap()].body;
        let fenced = body.find("```\n### 2026-08-18T09:30:00Z").expect("fence intact");
        let inserted = body.find("### 2026-08-18T10:00:00Z").expect("inserted");
        assert!(inserted > fenced, "inserted after the fenced pseudo-heading: {body}");

        // Comment headings compare on the timestamp before the separator, not the agent.
        let mut comments = sections("## Comments\n\n### 2026-08-18T09:00:00Z — zed\n\nFirst.\n");
        insert_entry_by_time(
            &mut comments,
            "Comments",
            "2026-08-18T08:00:00Z — abel",
            "Replayed earlier.",
            &["Report", "Comments", "Resolution"],
        );
        let parsed = bug_comments(&take_section(&mut comments, "Comments").unwrap());
        assert_eq!(parsed[0].agent, "abel");
        assert_eq!(parsed[1].agent, "zed");
    }

    #[test]
    fn an_unclosed_fence_is_found_by_line_number() {
        assert_eq!(open_fence_line("## How\n\n```\nthread main panicked\n"), Some(3));
        assert_eq!(open_fence_line("## How\n\n```\nfine\n```\n"), None);
        assert_eq!(open_fence_line("no fences here at all"), None);
        // three fences: the third is the one left hanging
        assert_eq!(open_fence_line("```\na\n```\ntext\n```rust\nb\n"), Some(5));
        // …and an indented fence counts, exactly as `sections` counts it
        assert_eq!(open_fence_line("  ```\nstill open\n"), Some(1));
    }

    #[test]
    fn excerpt_collapses_and_clips() {
        assert_eq!(excerpt("one two\nthree\n\nnext para", 100), "one two three");
        assert!(excerpt(&"word ".repeat(80), 40).ends_with('…'));
    }

    #[test]
    fn search_text_flattens_every_part_and_keeps_identifiers() {
        let flat = search_text(&[
            "Connections leak.\n\n    SELECT state FROM `pg_stat_activity`;",
            "",
            "Fixed by **closing** the pool.",
        ]);
        assert_eq!(
            flat,
            "Connections leak. SELECT state FROM pg_stat_activity; Fixed by closing the pool."
        );
        // the parts are joined, so a phrase never spans two of them by accident
        assert!(!search_text(&["one", "two"]).contains("onetwo"));
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
