# The human area — style contract

Read this while you write a record's human area, and only then. You are retelling your own work to someone who was not there and does not program, and they must
finish able to retell it to a third person with the hard part still in it. Two tests: nothing important is missing, and every phrase is one they could say back
in their own words. The second is the one people fail — usually by handing over more names than a reader can hold, each one honestly explained.

<!-- compact-rules -->
The human area retells this record for someone who was not there and does not program.
Write it in the record's own language, and never make "the record" the subject — say "nobody wrote down why". Markdown sparingly; a `##` heading is refused.
Name the thing this record is about — its id, file, setting name, colour code, the tool that ran — say plainly what that tool is for, and what goes wrong for a person when a check of that kind comes back no.
Tell the chase in beats, in the order it happened, one short paragraph each. Cover all five:
1. The problem or the want: what someone saw, or what had to be decided. Never open on an absence. A scene is no wider than the record's own count — a record that names two rows gives you rows like these, never every row — and no deeper than its words: not what the thing is drawn as, not the wanting or the choosing that came before it. Where the record shows you no scene, open on the sentence it does give.
2. What you actually did — the real change, not a category.
3. What was tricky: the wrong guess you chased, what fooled you, what you tried and dropped.
4. How you know: who or what looked, the check that would have caught this, its number, what its passing rules out.
5. What is different now for the people who use this, and what is still broken or unchecked.
Not a fixed bug? The five still hold and some collapse to a sentence. A decision or a note: open on what was settled and when — somebody settled this and wrote it down, so state the decision with its date; item 4 is whatever evidence exists, sometimes only "we looked"; short, few names, every one cashed out; never supply the pick or the all-clear the record does not state. The marked analogy, the stating bold lead-ins and the closing rule of thumb are not the bug shape — they hold here too.
Read the draft back as that stranger, pointing at every noun. Each name you keep gets its kind and its job in the same sentence, in words they already own — shop words (agent, hook, state, served, fixture, renderer), commands, scripts, paths, and an id that says what it was.
A gloss is a claim. Take a thing's kind and job from this record's words, or the plain reading of its name, or — for a tool — what that kind of tool is for, with the question it settles taken from what the record ran it against. Never its shape, its parts, or what it sits beside. A gloss that only re-spells the name it glosses is not a gloss.
Count the names as well as the words: one per fact, about one per fifty words — a budget the facts spend, not a target to undershoot. Every fact's actor is named; an anonymous actor ("a script", "one of the three") is a missing name, not a simpler sentence, and costs the reader more re-described at each mention than one name cashed out once. What the count forbids is a second name for a fact one name already fixes, never the first — that is what makes a fully glossed page feel like work. Spend a long name once — after its glossed first mention it is "that file", "the same script".
Then read it back a second time and mark every phrase that stranger could repeat but not restate — your own shorthand and your squeezed noun-phrases too, not only the names on the list. Each gets plain words in the same sentence, or the fact goes.
Claim only what this record claims, of the thing and in the place it says it. No invented example, no stand-in number, no step nobody recorded. Before writing that nothing does X, reread to its end the sentence X came from: it often names the thing that does.
One everyday analogy, marked as one ("it is like…"), on the central mechanism, carrying no number or cause of its own.
Short sentences, one fact each, most under 20 words. Say who did what, in plain verbs — "I watched one send", not "what was watched was one send". Five sentences end a paragraph; a hard mechanism is two short paragraphs, never one wall.
Open each beat after the first with a bold lead-in that states something — "**The stored number is wrong twice a year.**" — not a label ("**The stored offset.**"), never a stage of an essay ("**How we know.**").
Count last, and over either count cut in this order: first a name carrying no fact of its own, then a whole fact — never a gloss. 150 words thin, 300 for most, 450 where the mechanism is genuinely hard. A ceiling bounds one telling, never a record's total: a record that shipped several separate things — wherever it names them, its title, its What, or a list further down — covers every one, one short beat-block each after the shared opening. Never write to a ceiling — stop when the facts are spent.
Close on one sentence the reader could repeat tomorrow. No selling, no fake excitement, no emoji.
<!-- /compact-rules -->

## Cash out every name — and take every gloss from this record

Name the thing this record is about, one name per thing, then pay for each name you keep: kind, then job, half a clause as the noun arrives — "the queue — the list of
jobs waiting their turn — emptied in four seconds". A shouting `RETRY_LIMIT` you pay for on sight; what goes out bare is the vocabulary you stopped hearing years ago,
because to you it is the room you work in. None of this is a reason to gloss less — a gloss costs four words, a bare name costs the fact — and every reason to *name*
less: a page where all twelve are glossed is still a page holding twelve new nouns. Keep the names that carry a fact of their own; the rest go before any fact does.

- **A gloss is a claim, and it is read as one.** Take a thing's kind and job from this record's own words or the plain reading of its name, never from your picture of
  it. A name this record does not explain gets its kind and no more: not its shape, its parts, what it is drawn as, what it sits beside. "`RETRY_LIMIT`, a setting the
  code reads" is a gloss; "the counter it ticks down after each failure" is a guess in a gloss's clothes, and nothing on the page says which you handed the reader.
- **What a tool is FOR is the one thing you may take from outside this record — and it is not optional.** A purpose is a claim about that kind of tool, not about this
  record: state it plainly, and take the question it settles from what the record ran it against. "`tz-audit`, the script that checks each saved clock against the real
  rules for its region" is owed even where the record says only that it ran and what it answered; what it *found* comes from this record alone. If neither the name nor
  the run tells you the question, say what it was run on and what it answered and stop — but never leave it unnamed: an unnamed check is a rumour.
- **A purpose is finished when the reader knows who a "no" would have saved.** A check exists because something goes wrong for somebody, and that somebody is the half
  writers leave out: a saved clock drifting from its region's rules sends the nightly mail an hour late, *to people whose morning it lands in*. One clause, as what a
  tool of that kind guards against — never as a scene from this record, and never with a number or a person you supplied.
- **An id you keep says what it was**: not a bare `TASK-410` but "`TASK-410`, the week of work that added the export button" — still a pointer, now a fact.
- **A long pattern** — a regex, a glob, a snippet — goes in once and is said in the same breath, "`^\d{4}-\d{2}$`, meaning a year and a month with a dash between", or
  it stays out. A state or a flag says what turns it on and what changes when it does, or its fact goes whole.
- **Spend a long name once.** A path, a script, a command arrives with its kind and job the first time; after that it is "that file", "the same script". Reprinting it
  adds no precision, only a noun to hold. The exception is the one thing this record is about: its id or its colour code may come back, because that is the name the
  reader is meant to leave holding.
- **Write in the record's own language**: a Korean record gets a Korean retelling, every name spelled as the code spells it.

## The second read: could they repeat it, or restate it?

The first read catches the names you left bare; the second catches the ones you glossed where the reader still cannot use what you handed them. Mark every phrase that
stranger could repeat to you word for word but not say again in their own — that is a sound, not a fact. Each gets plain words in the same sentence, or its fact goes.
Three kinds survive the first read:

- **The gloss that only re-spells its name.** "the checker that passes or fails a clock", "the watcher that watches for changes" — six unusable words instead of one.
- **Your own shorthand, which is on no list.** *fixture*, *renderer*, *the served copy*, *state*, *inert*, *green*, *the transform*. Nobody thinks to gloss these,
  because they are not jargon to you — they are how you talk. A word you would not say to a neighbour gets four plain words beside it, or gets replaced.
- **The fact squeezed into a noun-phrase.** "the backfill sat inert", "asking for them on a repeat", "what was watched was one send". Unsqueeze it: who did what, in a
  plain verb — "the backfill changed nothing", "the app asks again every few seconds", "I watched one send".

## The shape a reader can follow

- **Tell the chase in beats**, opening on what the reader could have witnessed — a wrong email, a blank screen, a question someone had to settle, never a definition —
  then the wrong guess, the real cause, the fix, the proof, what is still open. A scene is no wider than the record's own count — a record that names two rows gives you
  rows like these, never every row — and no deeper than its words: not what the thing is drawn as, not the wanting or the choosing that came before it. Where the record
  shows you no scene, open on the sentence it does give.
- **A lead-in states something; it does not label the paragraph.** Every beat after the opening starts with one short bold sentence about a thing in this record: "**We
  threw away the name that knows the rule.**" A reader carries a claim and skips a label — "**The stored offset.**" is a label, "**How we know.**" is a stage of an
  essay and is a form. A thin record gets no lead-ins at all.
- **Five sentences end a paragraph.** Nobody gives up on a long text; they give up on a long sentence and a nine-sentence block. The mechanism beat is where they are
  lost: give it the shortest sentences, the analogy — *like a key cut to open every door in the building, including the one you meant to lock* — and a second lead-in
  rather than one wall.
- **Count the names as well as the words, and count the names first.** Words: 150 thin, 300 for most, 450 at the densest — a well-built 450 reads easier than a squeezed 300.
  Names: about one per fifty words, one per fact — nine or ten in a long piece, two or three in a short one. That second number is a budget the facts spend, not a target
  to undershoot: every fact's actor is named, and an anonymous actor — "a script", "one of the three" — is a missing name, not a simpler sentence, because a nameless
  thing re-described at each mention costs more to hold than one name cashed out once. What the count forbids is a second name for a fact one name already fixes, never
  the first; that second name is what decides whether a page feels like work, and glossing does not buy it back: the reader still holds every noun you introduced while
  you use them. Over either count, cut in the order under *Coverage* below.
- **A ceiling bounds one telling, not one record, and is never a target.** A record that shipped several separate things — wherever it names them: the title, the *What*, or a
  list further down, an "Alongside:" under *How* — owes each one: after the shared opening, one short beat-block per thing, bounded on its own. Three deliverables are three
  tellings, not one 450-word squeeze that drops two of them whole and takes their facts with them. `agentmon doctor` counts it that way too — the longest run between your bold
  lead-ins, never the record's total. And never write up to a ceiling: stop when that thing's facts are spent, and let a thin thing stay thin.
- **Close on a rule of thumb, not a summary**: *a backup you have never restored is not a backup*.

## Stay inside the record

- **Never make the record the subject.** Not "the record does not say how it was measured" but "nobody wrote down how" — better still, what that costs them: "so nobody
  knows if it holds on a slow phone."
- **A negative is a claim, and it is the one nobody verifies.** "Nobody measured X", "nothing automatic guards this", "no test would catch it" — none of these is in the
  record unless the record says it. Before writing one, reread *to its end* the sentence you took the subject from: a clause saying a thing still holds usually names
  what keeps it holding, and that named thing is what you were about to deny — a fact you owe the reader, not an absence. Find nothing, and write what you did check
  instead: "I checked this one by hand" is a fact, "nothing automatic guards this" is a survey you never ran.
- **Do not stage the missing beat.** "They blamed the old server" is what is written; "so they restarted it, and it did not help" is a scene you supplied — the easiest
  invention to make and the hardest to catch, because your own experience finishes the story and the page shows no seam. A fact keeps the place and the count the record
  gave it: one run reported with a limit on it is one event, and a true fact moved into a scene this record does not put it in is an invention with an honest surface.
- **Claim no more than the record claims, and announce only the win the check measured.** One probe of what a program handed back is not "it works again for everybody";
  "deliberately skipped", where it says "was not measured", invents an intent. Never stage a demonstration: no invented example, no stand-in value, no number that is
  not in the record.
- **A drop names a noun the reader has already met**: "Left out: the option we turned down. It does not change what you see." A drop needing a fresh explanation of its
  own goes in silence — unplaceable names are the dearest noise.

## Coverage, selection, and records that are not fixed bugs

Fourteen facts squeezed in become fourteen sentences with no subject. Select, do not compress: keep every beat of the chase, then attach each surviving detail to its
beat. A thin record works the other way — 150 honest words beat 300 padded ones.

- **Cut in this order.** *First, a name carrying no fact of its own* — an id whose work the sentence beside it already describes, a second path for a fact the first
  path already fixes, a second command that starts the same thing, a screenshot's filename where "I opened it and looked" is the fact. The fact stays; only the label
  goes, and no fact is cut while one of these is still on the page. Then a fact stated twice, then background you brought yourself, then a fact whose nouns would each
  need a sentence of setup, then verification down to the check that would have caught this and its number. Never a gloss, never a name that is carrying a fact by
  itself, never the last name that tells two facts apart — if that is all that is left to cut, the piece has too many beats, not too many words. Item 3 is never cut in
  silence, item 5 never stops at good news.
- **Say what a check measures, not what shape it has; name what did the measuring, and what its number rules out** — "`node check-offsets.mjs`, the script that feeds
  prepared dates through and compares each answer with the hour we wrote down". "The pieces fit" is not evidence; "everything passes" does not survive.
- **Never keep a finding and cut what found it.** If a person opened it and looked with their own eyes, say so: a result with its source removed reads as though nobody
  checked. And the path that tells two facts apart is carrying one of them — that is the path to keep when the others go.

**Not a fixed bug?** The five still hold, some collapse to a sentence, and a limit goes beside the thing it limits.

- **Work just started**: open on what is missing today for the people who will use it, then how far you got and what looks hard; "nothing is checked yet" belongs at
  item 4, and a plan is never written as a result. **Abandoned work**: open on what was wanted, give item 3 most of the text, and let item 5 be what did not ship and
  what the next person should not repeat.
- **A decision or a note**: open on what was settled, and name the thing it governs on sight — its colour code, its setting name, its file — glossed no further than the
  record explains it, though what the tool that judged it is for, and what it guards against, are still yours to state plainly. Item 4 is whatever evidence exists,
  sometimes only "we looked". A note is short and carries few names: cash out every one. Besides its subject it holds one fact — that somebody settled this and wrote it
  down, and when — so state the decision with its date, rather than leaving the thing it governs standing loose in time. Say why it was worth settling in the record's own
  words — if it does not say, say what was settled and stop; never supply the pick, the ordering or the all-clear that came before or after it.
- **A handoff**: open on where the work stands and what the next person walks into; the traps are item 3, item 5 is what to do first. **A release**: open on what is in
  people's hands, then what they will notice.

## One worked example

**Agent area (excerpt)** — a bug from another project, holding more than one human area can carry:

```md
## Report
Nightly reminder mail fires at 10:00 for ~1,100 Europe/London users instead of 09:00, since 29 Mar — the night the clocks went forward. 23 support tickets. It
fires at the exact UTC instant asked for; the instant is wrong.
## Resolution
**Root cause.** Signup stores the user's UTC offset (+00:00), not their IANA zone id (Europe/London): an offset is a fixed number, a zone is the rule saying when
it changes. Stored that way since TASK-410, the signup rewrite.
**Fix.** Store the zone id, resolve the offset per send. Backfilled 41,208 rows; 612 ambiguous rows left stale, flagged for support. Dropped: a "confirm your time
zone" mail to everyone. **What fooled us.** CI runs in UTC, where offset and zone never disagree — eleven months green; a March-dated test fails it.
**Verified.** 6 zones x 4 dates around both transitions, green; node check-offsets.mjs 1,204 green; replayed the 29 Mar send — all 1,100 land at 09:00 local. Not
covered: those 612 rows, until support touches them.
```

**Human area** — seven beats, six opening on a lead-in that states something, one analogy, one closing line, no paragraph over four sentences: 401 words and three names,
`TASK-410`, `Europe/London`, `node check-offsets.mjs`. Numbers are facts, not names: 41,208 and 612 cost the reader nothing to hold. Every gloss traces to a line above or
to what that kind of tool is for — `TASK-410` is the signup rewrite because the record says so; `check-offsets.mjs` compares answers against hours written down because
that is what a check of that kind does, and the beat says what its failing would have looked like. What either holds inside is never described: nobody wrote it down.

```md
Every night we send a reminder email. For about 1,100 people in Britain it started arriving at ten in the morning, not nine. It began the night the clocks went
forward. Our support team has 23 tickets about it.

**We saved a number, not a place.** At signup we save how far your clock sits from ours. Just the number. We have saved it that way since `TASK-410`, the rewrite
of our signup form. But Britain's number is not fixed: it changes twice a year.

**We threw away the name that knows the rule.** What knows it is not a number but a place name — `Europe/London`, the way a computer spells one region's clock
rules. We saved the number and kept no name. So when the clocks moved, every saved number was wrong, and we sent an hour late.

It is like noting that a friend is two hours behind you, then moving abroad and trusting the note.

**Every check passed for eleven months.** Our automatic checks run on a machine whose clock never shifts, so there the number and the name always agree. The code
was wrong that whole time and every one of those checks said it was fine. A test pinned to a March date fails the old code at once. Nobody had written one.

**We now save the name and work the number out as we send.** We converted the 41,208 accounts we already held. For 612 of them the name was not there, so those
are marked for the support team to fix by hand.

**I ran that bad night again.** I replayed the 29 March send against the new code, and all 1,100 emails land at nine in the morning, local time. A stale number
would have shown up there as a wrong hour; none did. New tests cover six regions across both clock changes, and `node check-offsets.mjs` — the script that feeds
prepared dates through the sender and compares every answer against the hour we wrote down — passes all 1,204 of its checks.

**612 accounts still hold the old number.** They keep it until a person gets to them, and no test covers them meanwhile. Left out here: an extra mail we thought
about sending everyone and decided against. It does not change when yours comes.

A saved number the world can change out from under you is not a saved fact.
```

Learn the shape, not the wording. Most records are thinner than this one — match yours, and never fill a ceiling.
