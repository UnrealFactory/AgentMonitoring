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
 * `eli5.png` baselines under progress/dual/baselines). What that page gets right is not its
 * colour — it is
 * a light poster and this is a dark tool — but its shape: a surface that announces itself as
 * something to read rather than to scan, beats you can see the edges of, the numbers a claim
 * rests on made glanceable, and a last line that lands. All four are available in the
 * vocabulary this app already has:
 *
 *   * the sheet is `--bg-surface` inside `--bg-app`, the app's own way of saying "a thing,
 *     on the floor" — a page laid on the desk, filling the same column the agent half fills,
 *     with one measure (`--human-measure`) of text centred in it and its own type ramp on
 *     top of `--text-read`. That ramp is defined against the record body rather than as a
 *     number, because the body is not one number: this app steps `.prose` 14 → 15 → 16px
 *     across two window widths, so "the reading size" is 15 → 16 → 17 and the beat headings
 *     are 18 → 19 → 20 (tokens.css). A round of this module claimed the agent view was read
 *     "at the dense 14px" and set one fixed 15 against it, which came out identical to the
 *     agent half at 1600 and a size smaller at 1900;
 *   * a beat is the author's own bold lead-in promoted to a heading, numbered in the gutter
 *     (lib/human.ts finds them; nothing is invented and nothing is reordered);
 *   * the figures are marked the way the resolution's verification block already marks them
 *     — `Markdown figures`, which is typography and nothing else: every character stays
 *     where the author put it, and no number is extracted, paired or recomputed;
 *   * the closing line gets the one accent-soft block on the page.
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
import { useMemo } from "react";
import { CommandLine, RichText } from "./ui";
import { readHumanStory } from "../lib/human";
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
 * The retelling itself.
 *
 * `human` is the record's own markdown, rendered through the app's one renderer — so a
 * `WORK-0061` written into a sentence is still a chip, `[[note-name]]` is still a link to
 * that note, and a code span is still code. The only thing this component adds is the shape
 * the text already has (lib/human.ts).
 */
export function HumanStoryView({ human, agent }: { human: string; agent: string }) {
  /* Parsed once per record, like the resolution's parts next door (RecordBody.tsx): the
     whole window repaints when the language changes, and the record's own words are not
     one of the things that changed. */
  const story = useMemo(() => readHumanStory(human), [human]);
  return (
    <div className="human-sheet">
      {story.lede && <Markdown className="human-lede" source={story.lede} figures />}

      {story.beats.map((beat, i) => (
        <section className="human-beat" key={`${i}-${beat.lead}`}>
          <span className="human-beat-num tabular" aria-hidden="true">
            {i + 1}
          </span>
          <h2 className="human-beat-lead">
            <InlineMarkdown source={beat.lead} />
            {beat.trailer && (
              <span className="human-beat-trailer">
                <InlineMarkdown source={beat.trailer} />
              </span>
            )}
          </h2>
          {beat.body.trim() && <Markdown className="human-beat-body" source={beat.body} figures />}
        </section>
      ))}

      {story.takeaway && (
        <p className="human-takeaway">
          <InlineMarkdown source={story.takeaway} />
        </p>
      )}

      {/* Who is talking. The agent area's byline is in the record's head and stays there;
          this line answers the question the retelling itself raises — a plain-language page
          about a machine's work, written by whom? — and names the same handle. */}
      <p className="human-foot">{t("view.retoldBy", agent)}</p>
    </div>
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
  onShowAgent,
}: {
  human: string | null;
  kind: HumanKind;
  id: string;
  agent: string;
  /**
   * The empty box's way out — required wherever the box can appear, which is every detail
   * screen. The app-feedback board answers its own absences one line at a time and never
   * draws the box, so it passes nothing and the button is not built.
   */
  onShowAgent?: () => void;
}) {
  return (
    /* No `id` on this section: the app-feedback board draws one per row, and an anchor
       repeated down a page is not an anchor. Nothing links here — the contents rail belongs
       to the agent view. */
    <section className="record-section human-view" aria-label={t("view.human")}>
      {human && human.trim() ? (
        <HumanStoryView human={human} agent={agent} />
      ) : (
        <HumanEmpty kind={kind} id={id} agent={agent} onShowAgent={onShowAgent} />
      )}
    </section>
  );
}
