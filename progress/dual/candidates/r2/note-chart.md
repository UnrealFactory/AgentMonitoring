The activity charts draw several series at once — a series is one strand of data with
its own colour. One of them counts notes; the others count work started, work done, and
bugs. Nothing here was broken. What was wanted was confidence that the note colour, a pink
written in the standard six-character colour code as `#c9629b`, sits properly alongside
the rest.

**What was checked.** The pink was put through the dataviz palette validator — a check
that judges a set of chart colours together rather than one at a time. It was run against
the three colours the note series actually renders beside: work, done and bug. It passed
there.

Two other colours in the project were left out of that run: the purple used for fixes, and
the grey scale, the family of greys the charts also use. The pink has never been compared
against either of them.

**Why that matters.** Passing is not a property of a colour on its own — the validator
judges a colour against whatever is next to it. So this pink is only known to be sound in
the company it currently keeps. Place it beside fix-purple or a grey in some future chart
and the earlier pass says nothing about that pairing.

The record does not say why the other colours were skipped, so we cannot tell whether the
narrower run was a deliberate saving of effort or simply how the work went. It also gives
no numbers: only that the check ran against work, done and bug, with no score or margin
written down.

**What is different now.** The note series has a settled colour, named `--series-note` in
the code, and this record is the standing rule attached to it: anyone drawing a chart that
puts the note pink next to fix-purple or a grey must re-run the validator first. The
record names no automatic guard. Nothing will refuse such a chart, so the rule holds only
as long as the next person reads this.
