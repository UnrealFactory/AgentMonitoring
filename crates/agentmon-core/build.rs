//! Extract the compact style rules out of `docs/HUMAN_STYLE.md` at build time.
//!
//! The full contract is one document (`agentmon human-style` prints it). The *compact*
//! rules — the few lines every rejection has to carry, because that error is the only
//! moment an agent is guaranteed to read them — are the block between the
//! `<!-- compact-rules -->` markers in that same file. Extracting them here keeps one
//! source of truth: the doc is edited, the binary picks the change up on the next build,
//! and there is no second copy in Rust to drift.
//!
//! A missing marker is a build failure on purpose: shipping a rejection with an empty
//! rules block would silently remove the whole teaching mechanism.

use std::path::PathBuf;

const OPEN: &str = "<!-- compact-rules -->";
const CLOSE: &str = "<!-- /compact-rules -->";

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let doc = manifest.join("..").join("..").join("docs").join("HUMAN_STYLE.md");
    println!("cargo:rerun-if-changed={}", doc.display());
    println!("cargo:rerun-if-changed=build.rs");

    let text = std::fs::read_to_string(&doc)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", doc.display()));

    let start = text.find(OPEN).unwrap_or_else(|| {
        panic!(
            "{} has no {OPEN} marker — the compact rules every rejection prints are \
             extracted from between {OPEN} and {CLOSE}",
            doc.display()
        )
    }) + OPEN.len();
    let end = text[start..]
        .find(CLOSE)
        .unwrap_or_else(|| {
            panic!(
                "{} opens {OPEN} but never closes it with {CLOSE}",
                doc.display()
            )
        })
        + start;

    let rules = text[start..end].trim();
    if rules.is_empty() {
        panic!(
            "{} has an empty compact-rules block — a rejection with no rules teaches nothing",
            doc.display()
        );
    }

    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("human_compact.md");
    std::fs::write(&out, rules).unwrap_or_else(|e| panic!("cannot write {}: {e}", out.display()));
}
