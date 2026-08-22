//! The human area: the reserved `## For humans` section every record carries.
//!
//! SPEC.md, "The human area — every record speaks to two audiences": each record has an
//! **agent area** (What/Why/How, Report/Comments/Resolution, the note body) and a **human
//! area** — the same events retold by the agent that did the work, for a reader who was
//! not there and does not program. On disk it is the *last* body section, under a heading
//! no agent-supplied text may contain.
//!
//! The rules this module owns:
//!
//! * **Reading is lenient.** A file written before the human area existed parses fine and
//!   reports `human: null`; so does one whose section is present but blank.
//! * **Writing is not.** [`require`] refuses an empty, placeholder or section-breaking
//!   human area, and the refusal *is* the delivery mechanism of the style contract: it
//!   names the flag, prints the compact rules (extracted from docs/HUMAN_STYLE.md at build
//!   time — see build.rs) and says where the full contract is.
//! * **The heading is reserved.** Agent-supplied prose that contains `## For humans`
//!   is refused ([`reject_reserved`]) rather than silently becoming the human area of a
//!   record whose author meant it as a body section.
//! * **It is always last** ([`attach`]), **and it is always readable back.** Both halves
//!   matter: the heading is appended after the agent area, so an agent area that leaves a
//!   code fence open would swallow it — the record would be saved with the human area the
//!   CLI just demanded folded into a code block, `human: null` everywhere, and every
//!   repair appending one more swallowed heading. [`check_agent_text`] refuses such prose
//!   at the door and [`render_body`]/[`compose`] re-read what they just rendered and
//!   refuse to hand back a body whose human area did not survive the round trip.

use crate::body;
use crate::error::{CoreError, HumanRejection, Result};
use crate::model::Section;

/// The reserved heading, without its `## `.
pub const HEADING: &str = "For humans";

/// The full style contract, embedded so `agentmon human-style` works from any directory
/// and the installed binary carries it with no file to lose.
pub const STYLE: &str = include_str!("../../../docs/HUMAN_STYLE.md");

/// The few lines every rejection prints, cut out of [`STYLE`] between its
/// `<!-- compact-rules -->` markers by build.rs.
pub const COMPACT_RULES: &str = include_str!(concat!(env!("OUT_DIR"), "/human_compact.md"));

/// Minimum meaningful characters. Low enough that one honest sentence in any language
/// passes, high enough that "ok" and "fixed" do not.
const MIN_HUMAN: usize = 12;

/// The two flags every verb that takes a human area offers, for error messages.
pub const FLAGS: &str = "--human \"<text>\" or --human-file <path> (--human-file - reads stdin)";

/// Is this section title the reserved one, *as a reader would see it drawn*?
///
/// Not a string comparison, because the app draws the heading and the guard has to refuse
/// everything the app would draw as `For humans`. `## For\u{a0}humans` is one no-break
/// space away from the reserved heading in the bytes and zero pixels away from it on the
/// screen, so it is the reserved heading here: whitespace of any kind collapses to one
/// space, an ATX closing hash run and a trailing colon come off, and case is folded.
fn is_heading_title(title: &str) -> bool {
    normalize_title(title) == HEADING.to_ascii_lowercase()
}

/// The title as a reader sees it: what paints nothing is gone, what paints the same shape
/// is the same letter, whitespace is one space, case is folded.
///
/// Each step closed a hole where the *bytes* differed and the *pixels* did not, and the
/// last two are the ones that shipped:
///
/// * **Invisible characters are removed.** `## For humans\u{200b}` — a zero-width space
///   after the title — normalised to `for humans\u{200b}`, which is not `for humans`, so
///   the guard passed it through `--body` while src/lib/markdown-parse.ts
///   (`/^(#{1,6})\s+(.*)$/`, and `\s` matches none of these) drew a level-2 heading whose
///   visible text was exactly `For humans`. U+00AD, U+2060, U+200E and U+FE0F did the same
///   thing, at either end or between the two words.
/// * **Letters drawn alike are one letter.** `## Fоr humans` with a Cyrillic `о` is the
///   same eight glyphs on the screen and eight different bytes on disk.
///
/// The one thing that is *not* dropped is the handful of characters that are blank and a
/// whole cell wide — the Hangul fillers, the empty braille cell. Those are read as a space,
/// because that is what they are drawn as.
fn normalize_title(title: &str) -> String {
    let seen: String = title
        .chars()
        .filter_map(|c| match c {
            // Blank, but a whole cell wide. The Hangul fillers and the empty braille cell
            // are drawn the way a space is drawn, so between two words they *are* a space:
            // `## For\u{3164}humans` reads as two words on the screen. Dropping them (they
            // are ignorable to Unicode) would have spelled `forhumans` and let it through.
            '\u{115f}' | '\u{1160}' | '\u{3164}' | '\u{ffa0}' | '\u{2800}' => Some(' '),
            c if body::is_ignorable(c) => None,
            c => Some(fold_confusable(c)),
        })
        .collect();
    let t = body::trim(&seen);
    // `## For humans ##` — CommonMark's closing sequence, which is furniture, not title.
    let t = body::trim(t.trim_end_matches('#'));
    let t = body::trim(t.trim_end_matches(':'));
    t.split(body::is_space)
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

/// The ASCII letter this character is *drawn as*, or the character itself.
///
/// Deliberately narrow. Two rules pick what is in here, and everything else is out:
///
/// * **Only the nine letters of the reserved title** — `f o r h u m a n s`. A fold for `q`
///   could never turn a title into `for humans`, so it would be decoration in a guard, and
///   a guard nobody can check the edges of is a guard nobody trusts.
/// * **Only characters drawn with the same shape**, not merely related ones: Cyrillic `о`
///   and Greek `ο` are here, Cyrillic `н` (which reads as `n` to nobody) is not.
///
/// The two block ranges are arithmetic rather than a list because they are laid out that
/// way: fullwidth Latin sits exactly `0xFEE0` above ASCII, and the mathematical alphabets
/// are thirteen styled copies of `A..Z a..z` back to back, so `𝐅𝐨𝐫 𝐡𝐮𝐦𝐚𝐧𝐬` is one
/// remainder away from the letters it is drawn as.
///
/// Written as `\u{…}` escapes on purpose: a source line full of homoglyphs is a source line
/// no reviewer can check, which is the very trick this function exists to refuse.
fn fold_confusable(c: char) -> char {
    if c.is_ascii() {
        return c;
    }
    let n = c as u32;
    if (0xff21..=0xff3a).contains(&n) || (0xff41..=0xff5a).contains(&n) {
        return char::from_u32(n - 0xfee0).unwrap_or(c);
    }
    if (0x1d400..=0x1d6a3).contains(&n) {
        let off = (n - 0x1d400) % 52;
        let base = if off < 26 { 'A' as u32 + off } else { 'a' as u32 + off - 26 };
        return char::from_u32(base).unwrap_or(c);
    }
    match c {
        // a — Cyrillic А а, Greek Α α, Latin ɑ
        '\u{0410}' | '\u{0430}' | '\u{0391}' | '\u{03b1}' | '\u{0251}' => 'a',
        // f — Greek digamma Ϝ ϝ, the hooked ƒ, script ℱ
        '\u{03dc}' | '\u{03dd}' | '\u{0192}' | '\u{2131}' => 'f',
        // h — Cyrillic Н Һ һ, Greek Η, Armenian հ, letterlike ℋ ℌ ℍ ℎ
        '\u{041d}' | '\u{04ba}' | '\u{04bb}' | '\u{0397}' | '\u{0570}' | '\u{210b}'
        | '\u{210c}' | '\u{210d}' | '\u{210e}' => 'h',
        // m — Cyrillic М, Greek Μ, script ℳ, roman numeral Ⅿ ⅿ
        '\u{041c}' | '\u{039c}' | '\u{2133}' | '\u{216f}' | '\u{217f}' => 'm',
        // n — Greek Ν, Armenian ո, double-struck ℕ
        '\u{039d}' | '\u{0578}' | '\u{2115}' => 'n',
        // o — Cyrillic О о, Greek Ο ο, Armenian Օ օ, Coptic Ⲟ ⲟ, script ℴ
        '\u{041e}' | '\u{043e}' | '\u{039f}' | '\u{03bf}' | '\u{0555}' | '\u{0585}'
        | '\u{2c9e}' | '\u{2c9f}' | '\u{2134}' => 'o',
        // r — Armenian ր, letterlike ℛ ℜ ℝ
        '\u{0580}' | '\u{211b}' | '\u{211c}' | '\u{211d}' => 'r',
        // s — Cyrillic Ѕ ѕ
        '\u{0405}' | '\u{0455}' => 's',
        // u — Greek υ, Armenian Ս ս
        '\u{03c5}' | '\u{054d}' | '\u{057d}' => 'u',
        _ => c,
    }
}

/// Does this text paint nothing? — whitespace, invisible characters, or neither present.
///
/// The test [`split`] and [`require`] use for "is there a human area here at all", and it
/// is not `trim().is_empty()` because the two runtimes disagree about what `trim` removes.
/// A `--human` of two dozen byte-order marks was stored as a human area by this crate
/// (Rust's `trim` leaves U+FEFF) and read back as `human: null` by scripts/project-fs.mjs
/// (JavaScript's strips it): one record, two answers to "does it have one", depending on
/// which of the app's two transports you asked.
pub fn is_blank(text: &str) -> bool {
    text.chars().all(|c| body::is_space(c) || body::is_ignorable(c))
}

/// The stored human area of a record, or `None` when what is stored paints nothing.
pub fn visible(text: &str) -> Option<&str> {
    let text = body::trim(text);
    (!is_blank(text)).then_some(text)
}

/// Byte offsets of the last `## For humans` heading in `md`: (start of the heading line,
/// start of the line after it). Code fences are respected exactly as [`body::sections`]
/// does, so a heading inside a ``` block is not a heading.
fn find_heading(md: &str) -> Option<(usize, usize)> {
    let mut fences = body::Fences::default();
    let mut offset = 0usize;
    let mut found = None;
    for line in md.split_inclusive('\n') {
        let text = line.trim_end_matches(['\r', '\n']);
        if !fences.feed(text) {
            if let Some((2, title)) = body::heading(text) {
                if is_heading_title(title) {
                    found = Some((offset, offset + line.len()));
                }
            }
        }
        offset += line.len();
    }
    found
}

/// Split a record body into (agent area, human area).
///
/// The human area is everything after the last `## For humans` heading — "the last body
/// section" of SPEC.md, taken literally, so a hand-edited file that wrote something after
/// it keeps that text with the human area rather than losing it. A section that is present
/// but blank reads as no human area at all: the app shows its empty state and the next
/// mutation asks for one.
/// Both edges are trimmed with [`body::is_space`] — the union of what Rust's `trim` and
/// JavaScript's take off — and blankness is [`is_blank`], so this function and its twin in
/// scripts/project-fs.mjs cannot disagree about where the human area starts or whether the
/// record has one.
pub fn split(md: &str) -> (String, Option<String>) {
    match find_heading(md) {
        None => (md.to_string(), None),
        Some((start, after)) => (
            body::trim_end(&md[..start]).to_string(),
            visible(&md[after..]).map(str::to_string),
        ),
    }
}

/// Does this agent-supplied prose carry the reserved heading?
pub fn contains_heading(text: &str) -> bool {
    find_heading(text).is_some()
}

/// Does this body end inside a code fence? — the state in which no human area can be
/// stored, because the heading appended after it reads as code. `agentmon doctor` reports
/// the records in it: they are the ones `--human` alone cannot repair.
pub fn has_open_fence(text: &str) -> bool {
    body::open_fence_line(text).is_some()
}

/// Put the human area back, always as the last section.
pub fn attach(sections: &mut Vec<Section>, human: Option<&str>) {
    sections.retain(|s| !is_heading_title(&s.title));
    if let Some(text) = human.and_then(visible) {
        sections.push(Section {
            title: HEADING.to_string(),
            body: text.to_string(),
        });
    }
}

/// Render a body that is only a human area — used by record kinds whose agent area is
/// free-form text rather than a section list (notes, app feedback).
pub fn render_section(human: &str) -> String {
    format!("## {HEADING}\n\n{}\n", body::trim(human))
}

/// Attach the human area and render the body of a section-shaped record (work log, bug),
/// **proving the section can be read back**.
///
/// The proof is the point. `attach` puts the heading last, but "last" is not the same as
/// "found": a section above it that leaves a code fence open makes [`find_heading`] read
/// the heading as fenced text, so the record saves with `human: null` and the text the
/// caller was required to write buried inside a code block. Re-reading here turns that
/// silent corruption into a refusal, on every write path there is.
pub fn render_body(sections: &mut Vec<Section>, human: &str, subject: &str) -> Result<String> {
    let human = body::trim(human);
    attach(sections, Some(human));
    let text = body::render(sections);
    verify(&text, human, subject)?;
    Ok(text)
}

/// The same guarantee for the free-form kinds (notes, app feedback): the agent's prose,
/// then the reserved section, then the proof that the section survived.
pub fn compose(agent_body: &str, human: &str, subject: &str) -> Result<String> {
    let human = body::trim(human);
    let agent = body::trim(agent_body);
    let text = if agent.is_empty() {
        render_section(human)
    } else {
        format!("{agent}\n\n{}", render_section(human))
    };
    verify(&text, human, subject)?;
    Ok(text)
}

/// Read the rendered body back and refuse it if the human area is not what we just wrote.
fn verify(rendered: &str, human: &str, subject: &str) -> Result<()> {
    if split(rendered).1.as_deref() == Some(human) {
        return Ok(());
    }
    let where_ = match body::open_fence_line(rendered) {
        Some(line) => format!(
            " — a code fence opened on line {line} of the body is never closed, so \
             everything below it, including that heading, reads as code"
        ),
        None => String::new(),
    };
    Err(structural(
        format!(
            "the human area of {subject} cannot be stored: the `## {HEADING}` section this \
             write would append cannot be read back out of the record{where_}"
        ),
        "close the fence in the record file (or in the text you passed) so every ``` has a \
         partner, then re-run — nothing was written",
    ))
}

fn reject(problem: impl Into<String>, fix: impl Into<String>) -> CoreError {
    CoreError::MissingHuman(Box::new(HumanRejection {
        problem: problem.into(),
        fix: fix.into(),
        rules: COMPACT_RULES,
    }))
}

/// A refusal about the *shape* of the record rather than the quality of the retelling.
///
/// Same variant (same exit code 2, same "the write did not happen" contract), but no style
/// rules: an agent that left a ``` open is not being taught how to write for a reader, and
/// twenty lines of style contract in front of a one-character typo buries the fix.
fn structural(problem: impl Into<String>, fix: impl Into<String>) -> CoreError {
    CoreError::MissingHuman(Box::new(HumanRejection {
        problem: problem.into(),
        fix: fix.into(),
        rules: "",
    }))
}

/// The refusal a mutation gives when no human area was supplied at all.
///
/// `subject` is what the text would have been about ("this work log", "BUG-0004"), and
/// `flag` names the flags of the verb that was run, so the next attempt is a copy-paste.
pub fn missing(subject: &str, why: &str) -> CoreError {
    reject(
        format!("no human area for {subject}: {why}"),
        format!("pass {FLAGS}"),
    )
}

/// Validate supplied human text. Returns the trimmed text.
pub fn require(raw: &str, subject: &str) -> Result<String> {
    let text = body::trim(raw);
    if text.is_empty() {
        // Deliberately not "the text supplied is empty": the core is handed a string, and
        // the empty one arrives both from `--human ""` and from a verb where the flag was
        // never passed at all. One sentence that is true of both.
        return Err(missing(subject, "none was supplied"));
    }
    // Characters, but no ink. Its own refusal rather than "none was supplied", because
    // something *was* supplied and the agent needs to know why it did not count — and its
    // own refusal rather than silence, because [`split`] would call this record's human
    // area blank the moment it was read back.
    if is_blank(text) {
        return Err(reject(
            format!(
                "the human area for {subject} is {} characters that draw nothing on a screen \
                 (a zero-width space, a soft hyphen or the like)",
                text.chars().count()
            ),
            format!("write the real retelling and pass it with {FLAGS}"),
        ));
    }
    if is_placeholder(text) {
        return Err(reject(
            format!("the human area for {subject} says only {text:?}"),
            format!("write the real retelling and pass it with {FLAGS}"),
        ));
    }
    if meaningful_len(text) < MIN_HUMAN {
        return Err(reject(
            format!(
                "the human area for {subject} has {} characters of content; write at least \
                 {MIN_HUMAN}",
                meaningful_len(text)
            ),
            format!("say what happened and what is different now, then pass it with {FLAGS}"),
        ));
    }
    // The text lands *inside* `## For humans`; a `##` in it would end that section and
    // leave the record with an empty human area followed by loose sections.
    let titles: Vec<String> = body::sections(text)
        .into_iter()
        .filter(|s| !s.title.is_empty())
        .map(|s| s.title)
        .collect();
    if let Some(first) = titles.first() {
        return Err(reject(
            format!(
                "the human area for {subject} contains the level-2 heading `## {first}` — a \
                 `##` heading would end the human section and break the record"
            ),
            format!("write the label as `**{first}.**` or demote it to `###`, then pass it with {FLAGS}"),
        ));
    }
    // The same unclosed-fence typo, on this side of the record: the human area is the last
    // section, so nothing after it is lost — but every reader (the app, `agentmon view`,
    // any markdown renderer) would draw the rest of the retelling as code.
    if let Some(line) = body::open_fence_line(text) {
        return Err(structural(
            format!(
                "the human area for {subject} opens a code fence on line {line} and never \
                 closes it, so the rest of the retelling would render as code"
            ),
            format!("close it with a line of ``` on its own, then pass it with {FLAGS}"),
        ));
    }
    Ok(text.to_string())
}

/// Every check agent-supplied prose must pass before it can be stored next to a human
/// area: it may not carry the reserved heading, and it may not leave a code fence open.
///
/// One function so every write path gets both — the two ways a body can destroy the human
/// area of the record it is written into. `what` names the flags the text could have come
/// from (`--body/--body-file`, `--outcome/--outcome-file`), so both messages name the
/// argument to fix. Both, because the core is handed the *text*: it cannot know whether
/// the caller typed it inline or pointed at a file, and naming only the inline flag sent
/// an agent that had passed `--body-file` to fix a flag it never used.
pub fn check_agent_text(text: &str, what: &str) -> Result<()> {
    reject_reserved(text, what)?;
    reject_open_fence(text, what)
}

/// Refuse agent-area prose that ends inside a code fence.
///
/// The heading agentmon appends after this text is only a heading outside a fence
/// ([`find_heading`], [`body::sections`]), so prose that opens ``` and never closes it
/// swallows the human area whole: the write succeeds, `human` is `null` in every payload,
/// and the next `--human` "repair" appends a second heading that is swallowed too. A
/// missing backtick is a typo; losing the record's human area to it is not recoverable, so
/// it is refused here, before anything is written.
pub fn reject_open_fence(text: &str, what: &str) -> Result<()> {
    let Some(line) = body::open_fence_line(text) else {
        return Ok(());
    };
    Err(structural(
        format!(
            "{what} opens a code fence on line {line} and never closes it — everything after \
             that line reads as code, including the `## {HEADING}` section agentmon appends \
             last, so the record would be saved with no human area at all"
        ),
        format!(
            "close it with a line of ``` on its own in {what} (line {line} is the one that \
             opened it), then re-run"
        ),
    ))
}

/// Refuse agent-area prose that carries the reserved heading.
///
/// `what` is the flag whose text this is (`--body`, `--outcome`, `--message`), so the
/// message can say exactly which argument to move the text out of.
///
/// The supplied text is checked **and so are the bytes it renders to**. Section-shaped
/// bodies are stored as `render(sections(text))`, not as the caller typed them, and a
/// guard that reads only the input trusts a round trip it has not watched: the indented
/// `  ## For humans` that shipped in round 2 was invisible to [`contains_heading`] and
/// promoted to a real column-0 section by [`body::render`]. [`body::heading`] no longer
/// has that blind spot, so this second look should never be the one that fires — it is
/// here because "the guard sees what will be written" is the property worth holding, and
/// holding it costs one parse of a string we are about to parse anyway.
pub fn reject_reserved(text: &str, what: &str) -> Result<()> {
    if !contains_heading(text) && !contains_heading(&body::render(&body::sections(text))) {
        return Ok(());
    }
    Err(reject(
        format!(
            "`## {HEADING}` is a reserved section and cannot be written through {what} — it is \
             the record's human area, and agentmon owns where it goes"
        ),
        format!("take that section out of {what} and pass its text as {FLAGS}"),
    ))
}

/// Content that is present but says nothing (the same list `validate` refuses).
fn is_placeholder(text: &str) -> bool {
    const PLACEHOLDERS: &[&str] = &[
        "todo", "tbd", "n/a", "na", "none", "-", "--", "...", "wip", "fixed", "done", "x", "?",
        "later", "see above", "same", "lorem ipsum", "placeholder", "asdf", "test", "ok",
    ];
    let flat = text
        .trim()
        .trim_end_matches(['.', '!', ','])
        .to_ascii_lowercase();
    PLACEHOLDERS.iter().any(|p| flat == *p)
}

/// How much of this text a reader can actually read: whitespace collapsed, and the
/// characters that paint nothing dropped before counting, so twelve zero-width spaces
/// glued to `ok` do not buy their way past the minimum.
fn meaningful_len(text: &str) -> usize {
    text.chars()
        .filter(|c| !body::is_ignorable(*c))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_last_section_off_and_leaves_legacy_bodies_alone() {
        let legacy = "## What\n\nSomething.\n\n## Why\n\nBecause.\n";
        let (agent, human) = split(legacy);
        assert_eq!(agent, legacy, "a legacy body is returned untouched");
        assert!(human.is_none());

        let with = "## What\n\nSomething.\n\n## For humans\n\nWe made the app faster.\n";
        let (agent, human) = split(with);
        assert_eq!(agent, "## What\n\nSomething.");
        assert_eq!(human.as_deref(), Some("We made the app faster."));

        // present but blank reads as absent
        let blank = "## What\n\nx\n\n## For humans\n\n";
        assert!(split(blank).1.is_none());
    }

    #[test]
    fn a_heading_inside_a_code_fence_is_not_the_section() {
        let md = "## What\n\n```md\n## For humans\nnot a section\n```\n\nStill what.\n";
        let (agent, human) = split(md);
        assert!(human.is_none(), "{human:?}");
        assert!(agent.contains("## For humans"));
        assert!(!contains_heading(md), "a fenced example is not the reserved heading");
        assert!(contains_heading("## For humans\n\nreal one"));
        // …and a trailing colon or different case still counts
        assert!(contains_heading("## for humans:\n\nreal one"));
        // a level-3 heading does not break the section, so it is not reserved
        assert!(!contains_heading("### For humans\n\nfine"));
    }

    #[test]
    fn attach_always_lands_last() {
        let mut secs = body::sections("## For humans\n\nold\n\n## What\n\nx\n");
        attach(&mut secs, Some("new text"));
        assert_eq!(secs.last().unwrap().title, HEADING);
        assert_eq!(secs.last().unwrap().body, "new text");
        assert_eq!(secs.len(), 2, "the old copy was replaced, not duplicated");
        attach(&mut secs, None);
        assert_eq!(secs.len(), 1, "None removes it");
    }

    #[test]
    fn require_refuses_blank_placeholder_and_section_breakers() {
        assert!(require("", "this work log").is_err());
        assert!(require("   ", "this work log").is_err());
        assert!(require("TODO", "this work log").is_err());
        assert!(require("ok", "this work log").is_err());
        let err = require("## Root cause\n\nThe watcher fired twice per save.", "BUG-0001")
            .unwrap_err()
            .to_string();
        assert!(err.contains("`## Root cause`"), "{err}");
        assert!(require("We made the search box find things it used to miss.", "x").is_ok());
    }

    #[test]
    fn every_rejection_carries_the_rules_and_the_way_to_the_full_contract() {
        let err = require("", "this work log").unwrap_err();
        assert_eq!(err.kind(), "invalid_argument");
        let text = err.to_string();
        assert!(text.contains("--human"), "{text}");
        assert!(text.contains("agentmon human-style"), "{text}");
        assert!(!COMPACT_RULES.trim().is_empty());
        let first_rule = COMPACT_RULES.lines().next().unwrap().trim();
        assert!(text.contains(first_rule), "the compact rules are printed:\n{text}");
        // …and the pointer at the full contract is added only when the rules lack one, so
        // no rejection ever says it twice.
        assert_eq!(
            text.trim_end().ends_with("The full contract: agentmon human-style"),
            !COMPACT_RULES.contains("agentmon human-style"),
            "{text}"
        );
    }

    /// The hole this module shipped with once: an agent pastes a stack trace, forgets the
    /// closing ```, and the `## For humans` section appended after it is read back as code
    /// — `human: null`, the text leaked into `body`, and every "repair" appending another
    /// swallowed heading. Both halves of the fix are asserted here: the door, and the proof.
    #[test]
    fn an_unclosed_fence_can_neither_be_supplied_nor_rendered() {
        let body = "## What\n\nx\n\n## How\n\n```\nthread main panicked\n";
        // …the door: the prose is refused, by flag name, before anything is written.
        let err = check_agent_text(body, "--body").unwrap_err();
        assert_eq!(err.kind(), "invalid_argument");
        let text = err.to_string();
        assert!(text.contains("--body"), "{text}");
        assert!(text.contains("line 7"), "names the line that opened it: {text}");
        assert!(text.contains("no human area"), "{text}");
        // a structural refusal does not bury the fix under the style contract
        assert!(!text.contains(COMPACT_RULES.lines().next().unwrap()), "{text}");
        assert!(check_agent_text("## What\n\n```\nclosed\n```\n", "--body").is_ok());

        // …and the proof: rendering a body whose agent area is already broken (a legacy
        // file, hand-edited) fails instead of writing a record with a swallowed heading.
        let mut sections = body::sections(body);
        let err = render_body(&mut sections, "A real retelling of what happened here.", "WORK-0001")
            .unwrap_err()
            .to_string();
        assert!(err.contains("WORK-0001"), "{err}");
        assert!(err.contains("cannot be read back"), "{err}");
        assert!(err.contains("nothing was written"), "{err}");

        // The healthy path still returns a body whose human area reads back exactly.
        let mut ok_sections = body::sections("## What\n\nSomething real.\n");
        let rendered = render_body(&mut ok_sections, "  A real retelling.  ", "WORK-0002").unwrap();
        assert_eq!(split(&rendered).1.as_deref(), Some("A real retelling."));

        // Free-form kinds (notes, app feedback) get the same two guarantees.
        assert_eq!(
            split(&compose("A note body.", "The retelling.", "note").unwrap()).1.as_deref(),
            Some("The retelling."),
        );
        assert!(compose("```\nopen fence in a note body\n", "The retelling.", "n").is_err());
        // An empty agent area is legal (app feedback: the title can carry the whole wish).
        assert_eq!(
            split(&compose("", "The retelling.", "FB-0001").unwrap()).1.as_deref(),
            Some("The retelling."),
        );
    }

    #[test]
    fn a_human_area_that_leaves_a_fence_open_is_refused_too() {
        let err = require(
            "It broke like this:\n\n```\nsome log line the reader will never need\n",
            "WORK-0001",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("code fence"), "{err}");
        assert!(err.contains("--human"), "{err}");
        assert!(
            require("It broke like this:\n\n```\nlog\n```\n\nAnd now it does not.", "x").is_ok(),
            "a closed fence in a human area is fine",
        );
    }

    #[test]
    fn reserved_heading_in_agent_prose_is_refused_by_name() {
        let err = reject_reserved("## Report\n\nx\n\n## For humans\n\ny", "--body")
            .unwrap_err()
            .to_string();
        assert!(err.contains("reserved"), "{err}");
        assert!(err.contains("--body"), "{err}");
        assert!(err.contains("--human"), "{err}");
        assert!(reject_reserved("## Report\n\nplain body", "--body").is_ok());
    }

    /// Indenting the reserved heading used to walk it straight past the guard.
    ///
    /// `heading` anchored at column 0, so `  ## For humans` was not a heading to
    /// [`find_heading`] — but [`body::sections`] trims a section body, which stripped the
    /// indent off its first line, and [`body::render`] wrote the heading back at column 0.
    /// The guard cleared text the renderer then promoted. Both halves are asserted: the
    /// heading rule sees the indent now, and the guard is additionally shown the bytes the
    /// write would actually store.
    #[test]
    fn an_indented_reserved_heading_is_refused_at_every_indent() {
        for indent in ["", " ", "  ", "   ", "    ", "\t", " \t "] {
            let body = format!(
                "## What\n\n{indent}## For humans\n\n{indent}Not the record's human area.\n\n\
                 ## Why\n\nA reason.\n\n## How\n\nAn approach.\n"
            );
            assert!(contains_heading(&body), "indent {indent:?} hides the heading");
            let err = reject_reserved(&body, "--body")
                .expect_err(&format!("indent {indent:?} walked through the guard"))
                .to_string();
            assert!(err.contains("reserved"), "{err}");
            assert!(err.contains("--body"), "{err}");
            // The guard and the renderer agree: whatever `render` would store carries no
            // second reserved heading either.
            assert!(
                contains_heading(&body::render(&body::sections(&body))),
                "indent {indent:?}",
            );
        }
        // The indent does not make a *fenced* example reserved, and a `###` is still fine.
        assert!(!contains_heading("## What\n\n  ```md\n  ## For humans\n  ```\n"));
        assert!(!contains_heading("  ### For humans\n\nfine"));
    }

    /// Everything the app would **draw** as `## For humans` is the reserved heading.
    ///
    /// Round 3 shipped a guard narrower than its own readers, and all three holes were the
    /// same hole: this crate compared bytes where the app renders pixels.
    ///
    /// * `##\tFor humans` — a tab closes the hash run for src/lib/markdown-parse.ts
    ///   (`/^(#{1,6})\s+(.*)$/`) and did not close it for [`body::heading`], so a `--body`
    ///   carrying it was written and the Agent view drew the reserved heading over prose
    ///   that said it was not one.
    /// * `\u{feff}## For humans` — JavaScript's `trim` strips the byte-order mark and
    ///   Rust's does not, so the *two transports disagreed*: scripts/project-fs.mjs served
    ///   `extraSections: [{ title: "For humans" }]` where src-tauri served none.
    /// * `## For\u{a0}humans` — one no-break space from the reserved title in the bytes,
    ///   zero pixels from it on the screen.
    #[test]
    fn every_spelling_the_app_draws_as_the_reserved_heading_is_refused() {
        let smuggled = |line: &str| {
            format!(
                "## What\n\n{line}\n\nThis is NOT the record's human area.\n\n\
                 ## Why\n\nA reason.\n\n## How\n\nAn approach.\n"
            )
        };
        for line in [
            "##\tFor humans",
            "##\u{a0}For humans",
            "\u{feff}## For humans",
            "\u{feff}##\tFor humans",
            "## For\u{a0}humans",
            "## For\thumans",
            "## For  humans",
            "## For humans ##",
            "## For humans\u{feff}",
            "\t##\tfor humans:",
        ] {
            let body = smuggled(line);
            assert!(contains_heading(&body), "{line:?} hid from the guard");
            let err = reject_reserved(&body, "--body")
                .expect_err(&format!("{line:?} walked through the guard"))
                .to_string();
            assert!(err.contains("reserved"), "{line:?}: {err}");
            // …and reading agrees with refusing: were the line already on disk, `split`
            // would hand that text to the human area rather than to the agent payload.
            assert!(split(&body).1.is_some(), "{line:?} is not read as the section");
        }

        // Not the reserved heading, and none of them become it: a level-3 heading, a
        // hash run glued to the word, and the title with a word in the middle.
        for line in ["### For humans", "##For humans", "## For the humans", "## Fine humans"] {
            assert!(!contains_heading(&smuggled(line)), "{line:?} was refused");
        }
    }

    /// A character with no pixels cannot make two identical-looking headings different.
    ///
    /// The hole that shipped three rounds running. `normalize_title` folded case and
    /// collapsed whitespace, and U+200B is neither: `## For humans\u{200b}` normalised to
    /// `for humans\u{200b}`, which is not the reserved title, so `--body` carrying it was
    /// written at exit 0 — while src/lib/markdown-parse.ts (`/^(#{1,6})\s+(.*)$/`, and
    /// `\s` matches none of these characters) drew a level-2 heading whose visible text was
    /// exactly `For humans`, over prose saying it was not the record's human area. The
    /// browser transport served it as `extraSections: [{ title: "For humans" }]`, which
    /// SPEC.md says the agent-area payload never holds.
    ///
    /// The same rule, one script over: a letter drawn with the same shape is the same
    /// letter. `## Fоr humans` with a Cyrillic `о` is eight identical glyphs.
    #[test]
    fn a_character_that_paints_nothing_cannot_spell_a_different_heading() {
        let smuggled = |line: &str| format!("## What\n\nx\n\n{line}\n\nNot the human area.\n");
        for (line, what) in [
            ("## For humans\u{200b}", "a zero-width space after the title"),
            ("## \u{200b}For humans", "…and in front of it"),
            ("## For \u{200b}humans", "…and inside it, word space intact"),
            ("## For hu\u{ad}mans", "a soft hyphen mid-word"),
            ("## For humans\u{2060}", "a word joiner"),
            ("## For humans\u{200e}", "a left-to-right mark"),
            ("## For humans\u{fe0f}", "a variation selector"),
            ("## For humans\u{200b}\u{feff}\u{ad}", "all three at once"),
            ("## F\u{43e}r humans", "a Cyrillic o"),
            ("## F\u{3bf}r humans", "a Greek omicron"),
            ("## For hum\u{430}ns", "a Cyrillic a"),
            ("## \u{ff26}or humans", "fullwidth F"),
            ("## \u{1d405}or humans", "mathematical bold F"),
            ("## For h\u{57d}mans", "an Armenian seh, drawn as u"),
            ("## For hu\u{217f}ans", "the roman numeral for a thousand, drawn as m"),
            ("## For\u{3164}humans", "a hangul filler where the space was"),
            ("## For\u{2800}humans", "an empty braille cell where the space was"),
            ("## For humans\u{2800}", "…and one after the title"),
        ] {
            let body = smuggled(line);
            assert!(contains_heading(&body), "{what}: {line:?} hid from the guard");
            let err = reject_reserved(&body, "--body")
                .expect_err(&format!("{what}: {line:?} walked through"))
                .to_string();
            assert!(err.contains("reserved"), "{what}: {err}");
            // …and reading agrees with refusing: on disk this line starts the human area.
            assert_eq!(split(&body).1.as_deref(), Some("Not the human area."), "{what}");
        }

        // Near misses, each for its own reason. A zero-width space *before* the hashes is
        // not a heading to anyone — the app's regex is anchored at `#` and so is ours — and
        // one where the word space was is a heading that reads "Forhumans".
        for (line, what) in [
            ("\u{200b}## For humans", "the hashes no longer open the line"),
            ("## For\u{200b}humans", "drawn as one word"),
            ("## F\u{43e}r the humans", "a homoglyph in a different title"),
            ("## Fine humans", "a different title"),
        ] {
            assert!(!contains_heading(&smuggled(line)), "{what}: {line:?} was refused");
        }
    }

    /// A human area of characters that draw nothing is no human area.
    ///
    /// `--human` of two dozen byte-order marks was stored at exit 0 (Rust's `trim` leaves
    /// U+FEFF where JavaScript's takes it off), so `work view --json` reported a human area
    /// and scripts/project-fs.mjs reported `null` — one record, two answers to "does it
    /// have one". The edges are trimmed with the union of the two trims now, and blankness
    /// is measured in ink rather than in bytes.
    #[test]
    fn a_retelling_with_no_ink_in_it_is_not_a_retelling() {
        for blank in ["\u{feff}".repeat(24), "\u{200b}".repeat(24), " \u{ad}\t\u{2060}\n".into()] {
            let err = require(&blank, "WORK-0001").unwrap_err();
            assert_eq!(err.kind(), "invalid_argument", "{blank:?}");
            assert!(err.to_string().contains("--human"), "{blank:?}");
            assert!(is_blank(&blank), "{blank:?}");
            // …and were it already on disk, both readers would call the section empty.
            assert!(split(&format!("## What\n\nx\n\n## For humans\n\n{blank}\n")).1.is_none());
        }

        // A file saved by Notepad or PowerShell arrives with a byte-order mark in front of
        // the first word. It is furniture, not the first character of the retelling: it
        // comes off, so the desktop and the browser store and report the same string.
        let bom = "\u{feff}The search box now finds records by the words inside them.";
        assert_eq!(require(bom, "WORK-0001").unwrap(), &bom[3..]);
        let mut sections = body::sections("## What\n\nSomething real.\n");
        let rendered = render_body(&mut sections, bom, "WORK-0001").unwrap();
        assert_eq!(split(&rendered).1.as_deref(), Some(&bom[3..]));
        assert!(!rendered.contains('\u{feff}'), "no mark survives into the record");

        // Ink is counted in what a reader can read: padding a two-letter answer out to the
        // minimum with invisible characters does not reach it.
        assert!(require(&format!("ok{}", "\u{200b}".repeat(30)), "WORK-0001").is_err());
        assert!(require("We made the search box find things it used to miss.", "x").is_ok());
    }

    /// The fence rule that hides the heading has to be the app's fence rule.
    ///
    /// A ``` block holds a ~~~ as content in src/lib/markdown-parse.ts and closed one in
    /// the old toggle here, so this body ended balanced with the heading "inside a fence"
    /// — refused by nothing, drawn by the app as a heading reading "For humans".
    #[test]
    fn a_tilde_inside_a_backtick_block_cannot_hide_the_heading() {
        let body = "## What\n\n```\na\n~~~\nb\n```\n\n## For humans\n\nSmuggled.\n\n~~~\nc\n~~~\n";
        assert!(contains_heading(body), "the heading is outside the ``` block");
        assert!(reject_reserved(body, "--body").is_err());
        // A genuinely fenced example is still an example, in either marker.
        assert!(!contains_heading("## What\n\n~~~md\n## For humans\n~~~\n"));
        assert!(!contains_heading("## What\n\n```md\n## For humans\n```\n"));
    }
}
