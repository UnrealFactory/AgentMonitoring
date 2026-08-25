/**
 * The human half of a record, and the control that swaps to it.
 *
 * Every record speaks to two audiences (SPEC.md, "The human area"): the agent area is the
 * one the rest of these screens draw — What/Why/How, the thread, the resolution, the file
 * list — and the human area is the same events retold by the agent that did the work, for
 * somebody who was not there and does not program. This module is that second reading:
 * one toggle in the record's head, and one reading surface under it.
 *
 * ## What it is trying to be
 *
 * The bar is the `/eli5` explainer's *friendliness*, translated into this app's tokens (the
 * `eli5.png` baselines under progress/dual/baselines) — and, since the owner's 2026-08-25
 * decisions, carried on the **agent page's own skeleton** rather than a separate sheet:
 * two designs for one record was itself the confusing thing. The page is three matching
 * card families, in the order the work ran:
 *
 *   * the **Overview card** — the opening telling, "개요" and the record's start on its
 *     header strip, a short standfirst lifted above the numbers when the first paragraph
 *     is one (`standfirstFits`);
 *   * the **node cards** on the timeline rail — one `.update-card` per dated telling,
 *     chronological, its number and timestamp pairing it with the agent half's entry;
 *   * the **outcome card** — the ending's telling inside the same green-marked card the
 *     agent half closes on.
 *
 * Inside every card the reading treatment survives: `--text-read` (a step above the record
 * body, stepping at the same widths — tokens.css), beats numbered in the gutter and
 * restarting per telling, a telling without lead-ins promoted paragraph-by-paragraph to
 * numbered blocks (`numberParas` — nothing invented, nothing reordered), figures marked as
 * typography, and the accent-soft closing block only where no outcome card closes the page.
 *
 * No emoji, no confetti, no second font, no light panel: the friendliness is carried by
 * size, air and rhythm, which is all this design system will lend.
 *
 * ## And when there is none
 *
 * Most records written before this existed carry `human: null`. That is not an error and it
 * is not blank space: the box says what is missing, whose it is to add, and the exact
 * command — with this record's real id in it — that adds it.
 *
 * That box is a *screen's* answer, though, and one surface here is a board rather than a
 * screen per record. {@link BoardHumanNotice} is the same answer sized for N rows at once:
 * the absence stays marked in the row it belongs to, the instruction is said once over the
 * board. The reasoning is on that component.
 */
import { Fragment, useMemo } from "react";
import { CommandLine, RichText } from "./ui";
import { readHumanTellings } from "../lib/human";
import { formatDateTime, formatDateTimeUtc, formatRelative } from "../lib/format";
import { InlineMarkdown, Markdown } from "../lib/markdown";
import { tablistKeys } from "../lib/tablist";
import { t } from "../lib/i18n";
import type { RecordView } from "../lib/recordView";

/** Which kind of record is being retold — it decides the verb in the empty state. */
export type HumanKind = "work" | "bug" | "note" | "feedback";

/* --------------------------------------------------------------------------
   The toggle
   ----------------------------------------------------------------------- */

function AgentGlyph() {
  return (
    <svg className="view-glyph" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3.4 5 L6.2 8 L3.4 11 M8.2 11.4 h4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HumanGlyph() {
  return (
    <svg className="view-glyph" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="5.4" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.2 13.2 a4.8 4.8 0 0 1 9.6 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * How much retelling is under the Human segment, when the surface is a *board* rather than
 * one record. `has` of `of` items carry one; on a detail screen there is no such thing and
 * the prop is absent.
 */
export interface RetoldCount {
  has: number;
  of: number;
}

/**
 * Agent / Human, as the segmented control the rest of the app already uses for "the same
 * rows, read another way" (the bug board's tabs, the feedback board's kinds).
 *
 * Two real buttons, so the keyboard reaches them the way it reaches every other control in
 * this app and `:focus-visible` draws the ring from tokens.css. `data-value` is on each
 * segment for the same reason the board's tabs carry one: a gate that reached for the word
 * "Human" would only work in one of the two languages this app ships in.
 *
 * `role="tablist"` promises the arrows as well as Tab, and for a round none of this app's
 * six segmented controls delivered them. They all do now, through one handler
 * (lib/tablist.ts) rather than through a rule this one keeps and the other five do not.
 *
 * ## It says what surface it is on
 *
 * Three of the four surfaces that draw this are one record; the fourth is the app-feedback
 * board, which draws N of them and no record at all. For a round the control spoke
 * record-language on both: its accessible name was "Which half of **this record** to read"
 * over a board with no record on it, and on a board where nothing had been retold the Human
 * segment's tooltip said "**this record** has no plain-language retelling yet" — an inch
 * above a notice that got the same fact right in board words. `retold` is what tells the two
 * apart, and it is one source rather than two: counting how many rows carry a retelling is
 * a question only a board can answer, so the surface that passes a count *is* the board.
 */
export function RecordViewToggle({
  view,
  onChange,
  hasHuman,
  retold = null,
}: {
  view: RecordView;
  onChange: (next: RecordView) => void;
  /** Whether there is a retelling under the Human segment at all — it says so when not. */
  hasHuman: boolean;
  /**
   * On a board, how many of the rows carry one. A board where *some* do is the case a
   * single boolean cannot say out loud (SPEC allows a mixed board: an item filed before
   * this rule gains its human area through `app-feedback update`), and the reader deserves
   * to know it before pressing, not after the board has redrawn under them.
   */
  retold?: RetoldCount | null;
}) {
  const board = retold !== null;
  const mixed = board && retold.has > 0 && retold.has < retold.of;
  return (
    <div
      className="segmented view-toggle"
      role="tablist"
      aria-label={board ? t("view.boardLabel") : t("view.label")}
      onKeyDown={tablistKeys}
    >
      <button
        type="button"
        role="tab"
        data-value="agent"
        aria-selected={view === "agent"}
        className={`segment${view === "agent" ? " is-active" : ""}`}
        onClick={() => onChange("agent")}
        title={board ? t("view.boardAgentTip") : t("view.agentTip")}
      >
        <AgentGlyph />
        {t("view.agent")}
      </button>
      <button
        type="button"
        role="tab"
        data-value="human"
        aria-selected={view === "human"}
        className={`segment${view === "human" ? " is-active" : ""}${hasHuman ? "" : " is-thin"}`}
        onClick={() => onChange("human")}
        title={
          !hasHuman
            ? board
              ? t("view.boardHumanNoneTip")
              : t("view.humanNoneTip")
            : mixed
              ? t("view.humanSomeTip", retold.has, retold.of)
              : board
                ? t("view.boardHumanTip")
                : t("view.humanTip")
        }
      >
        <HumanGlyph />
        {t("view.human")}
        {/* A surface with nothing to show under this segment says so before it is pressed,
            in the app's own quiet way of marking an empty count — and a board where only
            some rows have one says how many, the way the tabs beside it print theirs. */}
        {!hasHuman ? (
          <span className="segment-count" aria-hidden="true">
            —
          </span>
        ) : (
          mixed && <span className="segment-count tabular">{retold.has}</span>
        )}
      </button>
    </div>
  );
}

/**
 * The line the agent area carries while it is being shown *instead of* the reader's choice.
 *
 * Drawn only when {@link useRecordView}'s `peekAgent` is up: the reader asked for the human
 * half, this record's answer was a box saying it has none (or a correction whose trail is
 * only on the other side), they took the offer, and the toggle now reads Agent while their
 * choice still reads Human. That disagreement is small and it is real, so it is said out
 * loud in one quiet line rather than left for the reader to discover two records later —
 * and what it says is the thing they would actually want to know: nothing about the next
 * record changed. Pressing Human on the toggle takes it back down, which is why this line
 * carries no button of its own; the control is a hand's width above it.
 */
export function AgentHereNote({ id }: { id: string }) {
  /* `status`, because this line only ever appears in answer to a press: it is the app
     telling the reader what their press did, which is what a live region is for, and it is
     polite — nothing here interrupts. */
  return (
    <p className="view-peek" role="status">
      <span className="view-peek-mark" aria-hidden="true">
        <HumanGlyph />
      </span>
      {/* The id is marked as an id, not spelled into the sentence: on a note it is a kebab
          slug, and a slug in the app's own proportional face inside the app's own Korean
          line is English words on a Korean screen — the reader's reading of it and
          scripts/check-i18n.mjs's are the same reading. */}
      <RichText text={t("view.peekNote", id)} />
    </p>
  );
}

/* --------------------------------------------------------------------------
   The reading surface
   ----------------------------------------------------------------------- */

/**
 * The exact command that would give this record its human area.
 *
 * Every one of these is an *update* verb, which SPEC allows to carry `--human` alone: the
 * retelling is added to the record that exists, and nothing else about it changes. The id is
 * this record's real one, so the line can be copied straight into a terminal.
 */
function addCommand(kind: HumanKind, id: string, agent: string): string {
  const who = agent.trim() || "<agent>";
  if (kind === "bug") return `agentmon bug comment ${id} --agent ${who} --human "…"`;
  if (kind === "note") return `agentmon note update ${id} --agent ${who} --human "…"`;
  if (kind === "feedback") return `agentmon app-feedback update ${id} --agent ${who} --human "…"`;
  return `agentmon work update ${id} --agent ${who} --human "…"`;
}

/**
 * A record whose human half was never written.
 *
 * Warm rather than apologetic, and useful rather than warm: it says what the missing half
 * is *for*, that an agent is the one who writes it (the app reads records; it never writes
 * one — SPEC), the command that adds it to **this** record, and where the rules for writing
 * one live. The way back to the half that does exist is a button, because an empty state
 * that strands the reader is a worse empty state than a blank one.
 *
 * That button's blast radius is **this record**, which is what its own label says and, for
 * a round, was not what it did: it called the session-wide setter, so pressing it inside the
 * box that exists to say "this record has none" silently threw away the reader's choice for
 * every record after it (D3 round 2 critic). It is `peekAgent` now — see lib/recordView.ts.
 */
export function HumanEmpty({
  kind,
  id,
  agent,
  onShowAgent,
}: {
  kind: HumanKind;
  id: string;
  /** The record's own agent — the handle the command should carry. */
  agent: string;
  /** Shows the agent area **for this record**, without touching the session choice. */
  onShowAgent?: () => void;
}) {
  return (
    <div className="human-empty">
      <span className="human-empty-mark" aria-hidden="true">
        <HumanGlyph />
      </span>
      <p className="human-empty-title">{t("view.emptyTitle")}</p>
      <p className="human-empty-text">{t("view.emptyText")}</p>
      <p className="human-empty-lead">{t("view.emptyCommand")}</p>
      <CommandLine text={addCommand(kind, id, agent)} />
      <p className="human-empty-foot">
        <RichText text={t("view.emptyStyle")} />
      </p>
      {onShowAgent && (
        <div className="human-empty-action">
          <button
            type="button"
            className="button button-sm"
            onClick={() => {
              onShowAgent();
              /* This button is about to stop existing, and a reader who pressed it from the
                 keyboard would be left holding nothing — focus on `<body>`, one Tab away
                 from the top of the document. The segment that now says what is on screen,
                 and that undoes this press, is where they are put instead. It is drawn a few
                 lines above in this same module, so the selector is not reaching into
                 somebody else's markup, and it is already mounted: focusing it before the
                 repaint is safe because React keeps that node. */
              document
                .querySelector<HTMLButtonElement>('.view-toggle [role="tab"][data-value="agent"]')
                ?.focus();
            }}
          >
            {t("view.emptyBack")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The same absence, said once, for a *board*.
 *
 * {@link HumanEmpty} is right where it is the whole content region: one record, one screen,
 * and the box is what the reader came to a page for. A board is not that. The app-feedback
 * board draws every item at once, and SPEC puts a mixed board in writing — "an item filed
 * before this change gains its human area through `app-feedback update`" — so the ordinary
 * state of it, from the first item any agent files, is *some* rows retold and the rest not.
 * Drawing the record box per row made four of five rows into the same four sentences: one
 * headline repeated, one paragraph repeated, four copies of a command that differ in seven
 * characters, and four buttons offering the same escape. The board grew two and a half times
 * taller and the instruction outweighed the titles it hung off about five to one — which is
 * boilerplate, not a designed empty state, and it stopped being scannable as a board.
 *
 * So the two halves of that box are split by who they belong to. The *absence* belongs to
 * the row and stays there, one quiet line (`.feedback-none`). Everything the reader would
 * DO about it — what the missing half is, whose it is to write, the command, where the rules
 * live — belongs to the board and is said here, once, above the rows.
 *
 * The command names a real id: the topmost row on the board that is missing one, so the line
 * can be copied and run as it stands, and the rows below it are the same line with their own
 * id — which each of them prints beside its title.
 */
export function BoardHumanNotice({
  kind,
  missing,
  total,
  sample,
}: {
  kind: HumanKind;
  /** How many rows on the board carry no retelling, and how many rows there are. */
  missing: number;
  total: number;
  /** The topmost row that is missing one — whose id and handle the command carries. */
  sample: { id: string; agent: string };
}) {
  return (
    <aside className="human-notice">
      <span className="human-notice-mark" aria-hidden="true">
        <HumanGlyph />
      </span>
      <div className="human-notice-body">
        <p className="human-notice-title">{t("view.boardMissingTitle", missing, total)}</p>
        <p className="human-notice-text">{t("view.boardMissingText")}</p>
        <CommandLine text={addCommand(kind, sample.id, sample.agent)} />
        <p className="human-notice-foot">
          <RichText text={t("view.boardMissingStyle")} />
        </p>
      </div>
    </aside>
  );
}

/**
 * The retelling itself — on the agent page's own skeleton (owner, 2026-08-25).
 *
 * `human` is the record's own markdown, rendered through the app's one renderer — so a
 * `WORK-0061` written into a sentence is still a chip, `[[note-name]]` is still a link to
 * that note, and a code span is still code. The page is built from the agent view's parts,
 * so the two halves are one design: an "Overview" section (the opening), the timeline rail
 * with one `.update-card` per dated node — chronological, like the agent trail is now —
 * and the ending's telling inside the same `.outcome-card` the agent half closes on. Only
 * the *inside* of each block keeps the reading treatment this view exists for: the
 * standfirst, the numbered beats with their scenes, the accent-marked closing line.
 *
 * The ending is the dated node stamped exactly when the record closed (`finished` /
 * `resolved`) — that is the stamp `work done` and `bug resolve` append their telling
 * under. An open record has no such node and no outcome card, exactly like the agent half.
 */
export function HumanStoryView({
  human,
  agent,
  kind,
  started = null,
  finished = null,
}: {
  human: string;
  agent: string;
  kind: HumanKind;
  /** When the record began — `started` on a work log, `created` on a bug. */
  started?: string | null;
  /** When the record closed — `finished` on a work log, `resolved` on a bug. */
  finished?: string | null;
}) {
  /* Parsed once per record, like the resolution's parts next door (RecordBody.tsx): the
     whole window repaints when the language changes, and the record's own words are not
     one of the things that changed. */
  const tellings = useMemo(() => readHumanTellings(human), [human]);
  /* The standfirst is for a standfirst: one short scene-setting paragraph, blown up to
     the page's largest type. An opening that arrives as one long wall — records exist
     that open on 500 characters with no paragraph break — must not be blown up whole:
     the owner met one and the page read as a punishment. The ceiling is the closing
     line's (lib/human.ts, MAX_TAKEAWAY) plus room for a two-sentence opening. */
  const standfirstFits = (lede: string): boolean => {
    const text = lede.replace(/\s+$/, "");
    const cut = text.indexOf("\n\n");
    const first = (cut < 0 ? text : text.slice(0, cut))
      .split("\n")
      .map((line) => line.trim())
      .join(" ");
    return first.length <= 220;
  };
  const opening = tellings.filter((tell) => !tell.ts);
  const dated = tellings.filter((tell) => tell.ts);
  /* The ending is the node stamped exactly when the record closed — wherever it sits: a
     correction posted after the close is a later node, and the outcome card still stands
     last, the same way the agent half's outcome card stands below a trail that may hold
     a correction newer than it. */
  const ending = (finished && dated.find((tell) => tell.ts === finished)) || null;
  const nodes = ending ? dated.filter((tell) => tell !== ending) : dated;
  /* One distinctive closer per page, never two. On a closed record the green outcome
     card IS the page's last word, and an accent slab inside it was two closers in two
     colours fighting inside one box (the owner saw it and said so) — there the closing
     line is one more numbered block. Only a page with no outcome card — a record still
     open, or a legacy one-blob page — puts the accent block on its last telling. Every
     earlier telling keeps its closing sentence as plain prose where its author put it. */
  const lastTell = ending ?? nodes[nodes.length - 1] ?? opening[opening.length - 1] ?? null;
  const accentOn = (tell: (typeof tellings)[number]) => tell === lastTell && tell !== ending;

  /* A telling's paragraphs, split the way markdown splits them — on blank lines, with a
     fence held open counting as one block, so a pasted example cannot be cut in half. */
  const paragraphsOf = (source: string): string[] => {
    const out: string[] = [];
    let buf: string[] = [];
    let fence: string | null = null;
    for (const line of source.split("\n")) {
      if (!fence && !line.trim() && buf.length) {
        out.push(buf.join("\n"));
        buf = [];
        continue;
      }
      if (line.trim() || fence) buf.push(line);
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence && open && open[1][0] === fence) fence = null;
      else if (!fence && open) fence = open[1][0];
    }
    if (buf.length) out.push(buf.join("\n"));
    return out;
  };

  /* One telling's blocks — the opening's drawn bare on the sheet, a dated node's inside
     its card. Shared so the two cannot drift. `first` marks the page's opening run, the
     only paragraph that gets the standfirst size.

     The beat numbers restart at 1 inside every telling (owner, 2026-08-25): each node is
     its own little story, read on its own, and "beat 7" inside a card whose story has
     three beats is a number the reader has to chase across the page to cash out.

     `numberParas` is the card mode (owner, same day, third round of the same feedback):
     inside a node or the outcome card, a telling that arrived without bold lead-ins is
     not left as one dense run — each of its paragraphs is promoted to a numbered block,
     so every card reads as 1·2·3 whatever shape its author typed. Nothing is reworded
     and nothing is reordered; the numbers are enumeration, not headings. */
  const storyBlocks = (tell: (typeof tellings)[number], first: boolean, numberParas = false) => {
    if (numberParas && tell.story.beats.length === 0 && tell.story.lede) {
      const paras = paragraphsOf(tell.story.lede);
      // Inside the Overview card the standfirst stays a standfirst — the intro above the
      // numbers, not item 1 — when the opening's first paragraph is short enough to be
      // one (`standfirstFits`). Node and outcome cards have no standfirst to lift.
      const intro = first && paras.length > 1 && standfirstFits(tell.story.lede) ? paras[0] : null;
      const numbered = intro ? paras.slice(1) : paras;
      // A closing line joins the numbered items unless this telling carries the page's
      // accent block, which then stands below the numbers.
      const items =
        tell.story.takeaway && !accentOn(tell) ? [...numbered, tell.story.takeaway] : numbered;
      return (
        <>
          {intro && <Markdown className="human-lede" source={intro} figures />}
          {items.map((para, pi) => (
            <section className="human-beat is-plain" key={`para-${pi}`}>
              <span className="human-beat-num tabular" aria-hidden="true">
                {pi + 1}
              </span>
              <Markdown className="human-beat-body" source={para} figures />
            </section>
          ))}
          {tell.story.takeaway && accentOn(tell) && (
            <p className="human-takeaway">
              <InlineMarkdown source={tell.story.takeaway} />
            </p>
          )}
        </>
      );
    }
    return (
      <>
      {tell.story.lede && (
        <Markdown
          className={
            first && standfirstFits(tell.story.lede) ? "human-lede" : "human-lede is-later"
          }
          source={tell.story.lede}
          figures
        />
      )}

      {tell.story.beats.map((beat, bi) => {
        const beatNo = bi + 1;
        return (
          <section className="human-beat" key={`${beatNo}-${beat.lead}`}>
            <span className="human-beat-num tabular" aria-hidden="true">
              {beatNo}
            </span>
            <h2 className="human-beat-lead">
              <InlineMarkdown source={beat.lead} />
              {beat.trailer && (
                <span className="human-beat-trailer">
                  <InlineMarkdown source={beat.trailer} />
                </span>
              )}
            </h2>
            {/* The beat's scene, where the style contract puts it: above the words,
                under the lead-in it belongs to (docs/HUMAN_STYLE.md, "The scene goes
                inside the beat"). It is the author's own `![…](assets/…)` line, drawn
                by the app's one renderer — same path lock, same blob URL, same visible
                refusal when the file cannot be read (lib/markdown.tsx) — so a picture
                here and a picture anywhere else in the retelling are the same picture,
                differing only in where they sit. */}
            {beat.figure && <Markdown className="human-beat-figure" source={beat.figure} />}
            {beat.body.trim() && (
              <Markdown className="human-beat-body" source={beat.body} figures />
            )}
          </section>
        );
      })}

      {/* The closing line: the accent block on the page's last telling, plain prose —
          same words, same place — on every telling before it. */}
      {tell.story.takeaway &&
        (accentOn(tell) ? (
          <p className="human-takeaway">
            <InlineMarkdown source={tell.story.takeaway} />
          </p>
        ) : (
          <Markdown source={tell.story.takeaway} />
        ))}
      </>
    );
  };

  return (
    <>
      {/* The opening, in the same card family as everything below it (owner, 2026-08-25:
          bare prose above a page of cards read as the unfinished part). The header carries
          "개요" where a node card carries its number, and the record's own start on the
          right where a node carries its stamp — so the page is three matching boxes:
          overview card, node cards, outcome card. One title, not three: the opening is
          What/Why/How retold as one story, and a blob cannot be split back into them. */}
      {opening.length > 0 && (
        <section className="record-section">
          <div className="update-card human-overview-card">
            <header className="update-head">
              <span className="update-verb">{t("view.overview")}</span>
              {started && (
                <time
                  className="update-ts tabular"
                  dateTime={started}
                  title={formatDateTimeUtc(started)}
                >
                  {formatDateTime(started)} · {formatRelative(started)}
                </time>
              )}
            </header>
            <div className="update-body human-telling-body">
              {opening.map((tell, ti) => (
                <Fragment key={`opening-${ti}`}>{storyBlocks(tell, ti === 0, true)}</Fragment>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* The dated nodes, on the agent trail's own rail: one `.update-card` per node,
          chronological, each header pairing the node's number with its moment — the same
          timestamp its `## Updates` twin carries on the other half. */}
      {nodes.length > 0 && (
        <section className="record-section">
          <h2 className="section-title">
            {kind === "bug" ? t("bd.thread") : t("wd.updates")}
            <span className="section-count tabular">{nodes.length}</span>
          </h2>
          <ol className="timeline-rail">
            {nodes.map((tell, ni) => (
              <li className="trail-node" key={`${tell.ts}-${ni}`}>
                <span className="trail-dot" aria-hidden="true" />
                <article className="update-card">
                  <header className="update-head">
                    <span className="update-verb">{t("view.tellingN", ni + 1)}</span>
                    <time
                      className="update-ts tabular"
                      dateTime={tell.ts ?? undefined}
                      title={formatDateTimeUtc(tell.ts)}
                    >
                      {formatDateTime(tell.ts)} · {formatRelative(tell.ts)}
                    </time>
                  </header>
                  <div className="update-body human-telling-body">
                    {storyBlocks(tell, false, true)}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* The ending, inside the same outcome card the agent half closes on — the check
          mark, the title, the moment — with the telling `work done` / `bug resolve`
          appended as its body. Last on the page, because it happened last. */}
      {ending && (
        <section className="record-section">
          <div className="outcome-card">
            <header className="outcome-head">
              <span className="outcome-mark" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="11" height="11">
                  <path
                    d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h2 className="outcome-title">
                {kind === "bug" ? t("bd.resolution") : t("wd.outcome")}
              </h2>
              <span className="outcome-when">
                <time dateTime={ending.ts ?? undefined} title={formatDateTimeUtc(ending.ts)}>
                  {formatDateTime(ending.ts)} · {formatRelative(ending.ts)}
                </time>
              </span>
            </header>
            <div className="outcome-body human-telling-body">{storyBlocks(ending, false, true)}</div>
          </div>
        </section>
      )}

      {/* Who is talking. The agent area's byline is in the record's head and stays there;
          this line answers the question the retelling itself raises — a plain-language page
          about a machine's work, written by whom? — and names the same handle. */}
      <p className="human-foot">{t("view.retoldBy", agent)}</p>
    </>
  );
}

/**
 * The human area of a record, or the designed absence of one. Every detail screen draws
 * exactly this between its head and its Related rail.
 */
export function HumanArea({
  human,
  kind,
  id,
  agent,
  started = null,
  finished = null,
  onShowAgent,
}: {
  human: string | null;
  kind: HumanKind;
  id: string;
  agent: string;
  /** When the record began — the stamp on the overview card's header. */
  started?: string | null;
  /** When the record closed (`finished` / `resolved`) — what marks the ending's node. */
  finished?: string | null;
  /**
   * The empty box's way out — required wherever the box can appear, which is every detail
   * screen. The app-feedback board answers its own absences one line at a time and never
   * draws the box, so it passes nothing and the button is not built.
   */
  onShowAgent?: () => void;
}) {
  return (
    /* A div, not a `record-section`: the story view inside draws the agent page's own
       section blocks now, and a section holding sections is a heading level lie. No `id`
       either: the app-feedback board draws one per row, and an anchor repeated down a
       page is not an anchor — the contents rail belongs to the agent view. */
    <div className="human-view" aria-label={t("view.human")} role="region">
      {human && human.trim() ? (
        <HumanStoryView
          human={human}
          agent={agent}
          kind={kind}
          started={started}
          finished={finished}
        />
      ) : (
        <HumanEmpty kind={kind} id={id} agent={agent} onShowAgent={onShowAgent} />
      )}
    </div>
  );
}
