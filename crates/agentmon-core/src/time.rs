//! Agent-supplied timestamps: parsing, normalizing, and the ordering rules that keep a
//! backdated record coherent.
//!
//! Agents routinely finish a piece of work *and then* write it down, so every mutation
//! takes an optional timestamp (`--started-at`, `--finished-at`, `--at`, `--created-at`).
//! Three rules make that safe:
//!
//!   1. **One shape on disk.** Whatever the agent types — an offset, a missing `Z`, a
//!      space instead of `T` — is normalized to `%Y-%m-%dT%H:%M:%SZ`, because every
//!      "last activity" comparison in the app is a string comparison on these.
//!   2. **Never the future.** A record describes work that already happened; a timestamp
//!      after now is a typo, and it would sit at the top of every feed forever.
//!   3. **Never before the state it follows.** An update cannot predate the start, a
//!      resolution cannot predate the claim. The error names both times.

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};

use crate::error::{CoreError, Result};

/// Clocks on two machines writing one vault are never identical; a minute of slack keeps
/// a legitimate `--at "$(date -u ...)"` from being rejected as "the future".
const FUTURE_SKEW_SECS: i64 = 60;

/// Forms accepted beyond RFC3339, all read as UTC.
const NAIVE_FORMATS: &[&str] = &[
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
];

/// What the error message lists when a timestamp will not parse.
pub const ACCEPTED_FORMS: &str = "UTC ISO8601 like 2026-08-18T09:12:00Z (also accepted: \
2026-08-18T09:12, \"2026-08-18 09:12:00\", 2026-08-18 for midnight UTC, or an offset form \
like 2026-08-18T11:12:00+02:00, which is converted to UTC)";

fn render(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Read a vault timestamp back into an instant, for comparisons. `None` when a
/// hand-written record holds something that is not a timestamp at all.
pub fn instant(ts: &str) -> Option<DateTime<Utc>> {
    let t = ts.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(t) {
        return Some(dt.with_timezone(&Utc));
    }
    let bare = t.strip_suffix('Z').or_else(|| t.strip_suffix('z')).unwrap_or(t);
    for f in NAIVE_FORMATS {
        if let Ok(n) = NaiveDateTime::parse_from_str(bare, f) {
            return Some(Utc.from_utc_datetime(&n));
        }
    }
    NaiveDate::parse_from_str(bare, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|n| Utc.from_utc_datetime(&n))
}

/// Chronological order of two vault timestamps. Falls back to string order when one of
/// them is unparseable, which is what the rest of the app does anyway.
fn is_before(a: &str, b: &str) -> bool {
    match (instant(a), instant(b)) {
        (Some(x), Some(y)) => x < y,
        _ => a < b,
    }
}

fn invalid(flag: &str, value: &str, expected: impl Into<String>) -> CoreError {
    CoreError::InvalidValue {
        what: flag.to_string(),
        value: value.trim().to_string(),
        expected: expected.into(),
    }
}

/// Parse an agent-supplied timestamp into the one shape the vault stores.
pub fn parse(raw: &str, flag: &str) -> Result<String> {
    match instant(raw) {
        Some(dt) => Ok(render(dt)),
        None => Err(invalid(flag, raw, ACCEPTED_FORMS)),
    }
}

/// The timestamp a mutation should carry: the flag value (normalized, and refused if it
/// is in the future), or now when the agent passed nothing.
pub fn stamp(explicit: Option<&str>, flag: &str) -> Result<String> {
    let Some(raw) = explicit else {
        return Ok(crate::now_iso8601());
    };
    let ts = parse(raw, flag)?;
    let now = Utc::now();
    if let Some(dt) = instant(&ts) {
        if (dt - now).num_seconds() > FUTURE_SKEW_SECS {
            return Err(invalid(
                flag,
                raw,
                format!(
                    "a time at or before now ({}) — a record documents work that already \
                     happened, and a future timestamp would sit at the top of every feed \
                     until the clock caught up",
                    render(now)
                ),
            ));
        }
    }
    Ok(ts)
}

/// Refuse a timestamp that would land before the state it follows (an update before the
/// work started, a resolution before the claim).
///
/// `floor_label` names the earlier thing in a way that tells the agent what to change,
/// e.g. "started" or "the previous comment".
pub fn require_at_or_after(ts: &str, flag: &str, floor: &str, floor_label: &str) -> Result<()> {
    if floor.trim().is_empty() {
        return Ok(());
    }
    if is_before(ts, floor) {
        return Err(invalid(
            flag,
            ts,
            format!(
                "a time at or after {floor_label} ({floor}) — timelines are rendered in \
                 order, so an out-of-order timestamp would show the work happening backwards"
            ),
        ));
    }
    Ok(())
}

/// The mirror image: refuse a timestamp that would land after something that already
/// follows it (a corrected start after the first progress note).
pub fn require_at_or_before(ts: &str, flag: &str, ceiling: &str, ceiling_label: &str) -> Result<()> {
    if ceiling.trim().is_empty() {
        return Ok(());
    }
    if is_before(ceiling, ts) {
        return Err(invalid(
            flag,
            ts,
            format!("a time at or before {ceiling_label} ({ceiling})"),
        ));
    }
    Ok(())
}

/// `a <= b`, or an error naming both. Used where two flags arrive together
/// (`--started-at` with `--finished-at`).
pub fn require_order(
    earlier: &str,
    earlier_flag: &str,
    later: &str,
    later_flag: &str,
) -> Result<()> {
    if is_before(later, earlier) {
        return Err(invalid(
            later_flag,
            later,
            format!("a time at or after {earlier_flag} ({earlier})"),
        ));
    }
    Ok(())
}

/// The latest of a set of timestamps, ignoring empties — the floor a new entry must clear.
pub fn latest<'a>(candidates: impl IntoIterator<Item = &'a str>) -> String {
    let mut best = String::new();
    for c in candidates {
        let c = c.trim();
        if c.is_empty() {
            continue;
        }
        if best.is_empty() || is_before(&best, c) {
            best = c.to_string();
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_every_accepted_form_to_one_shape() {
        for input in [
            "2026-08-18T09:12:00Z",
            "2026-08-18T09:12:00z",
            "2026-08-18T09:12:00.750Z",
            "2026-08-18T11:12:00+02:00",
            "2026-08-18T09:12:00",
            "2026-08-18T09:12",
            "2026-08-18 09:12:00",
            " 2026-08-18T09:12:00Z ",
        ] {
            assert_eq!(
                parse(input, "--started-at").unwrap(),
                "2026-08-18T09:12:00Z",
                "{input}"
            );
        }
        assert_eq!(
            parse("2026-08-18", "--started-at").unwrap(),
            "2026-08-18T00:00:00Z"
        );
    }

    #[test]
    fn rejects_junk_and_names_the_flag_and_the_forms() {
        for bad in ["yesterday", "18/08/2026", "2026-13-01T00:00:00Z", ""] {
            let err = parse(bad, "--finished-at").unwrap_err();
            let text = err.to_string();
            assert!(text.contains("--finished-at"), "{text}");
            assert!(text.contains("2026-08-18T09:12:00Z"), "{text}");
        }
    }

    #[test]
    fn rejects_the_future_but_tolerates_clock_skew() {
        let soon = Utc::now() + chrono::Duration::seconds(30);
        assert!(stamp(Some(&render(soon)), "--at").is_ok(), "30s of skew is fine");

        let later = Utc::now() + chrono::Duration::hours(2);
        let err = stamp(Some(&render(later)), "--finished-at").unwrap_err();
        assert_eq!(err.kind(), "invalid_argument");
        assert!(err.to_string().contains("at or before now"), "{err}");
    }

    #[test]
    fn no_flag_means_now() {
        let ts = stamp(None, "--at").unwrap();
        assert_eq!(ts.len(), 20, "{ts}");
        assert!(ts.ends_with('Z'), "{ts}");
    }

    #[test]
    fn ordering_errors_name_both_times() {
        let err = require_at_or_after(
            "2026-08-18T08:00:00Z",
            "--at",
            "2026-08-18T09:12:00Z",
            "started",
        )
        .unwrap_err();
        let text = err.to_string();
        assert!(text.contains("at or after started"), "{text}");
        assert!(text.contains("2026-08-18T09:12:00Z"), "{text}");
        // equal is allowed: two things can happen in the same second
        require_at_or_after(
            "2026-08-18T09:12:00Z",
            "--at",
            "2026-08-18T09:12:00Z",
            "started",
        )
        .unwrap();
        require_at_or_after("2026-08-18T09:12:00Z", "--at", "", "started").unwrap();
    }

    #[test]
    fn latest_picks_the_newest_and_ignores_empties() {
        assert_eq!(
            latest(["2026-08-18T09:00:00Z", "", "2026-08-18T11:30:00Z", "2026-08-18T10:00:00Z"]),
            "2026-08-18T11:30:00Z"
        );
        assert_eq!(latest([""; 0]), "");
    }
}
