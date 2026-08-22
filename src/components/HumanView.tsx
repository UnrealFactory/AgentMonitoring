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
 *     on the floor" — a page laid on the desk, one measure wide (`--human-measure`), set at
 *     `--text-read` rather than at the dense 14px the agent view is read at;
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
 */
import { useMemo } from "react";
import { CommandLine, RichText } from "./ui";
import { readHumanStory } from "../lib/human";
import { InlineMarkdown, Markdown } from "../lib/markdown";
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
 * Agent / Human, as the segmented control the rest of the app already uses for "the same
 * rows, read another way" (the bug board's tabs, the feedback board's kinds).
 *
 * Two real buttons, so the keyboard reaches them the way it reaches every other control in
 * this app and `:focus-visible` draws the ring from tokens.css. `data-value` is on each
 * segment for the same reason the board's tabs carry one: a gate that reached for the word
 * "Human" would only work in one of the two languages this app ships in.
 */
export function RecordViewToggle({
  view,
  onChange,
  hasHuman,
}: {
  view: RecordView;
  onChange: (next: RecordView) => void;
  /** Whether this record has a human area — the Human segment says so when it has not. */
  hasHuman: boolean;
}) {
  return (
    <div className="segmented view-toggle" role="tablist" aria-label={t("view.label")}>
      <button
        type="button"
        role="tab"
        data-value="agent"
        aria-selected={view === "agent"}
        className={`segment${view === "agent" ? " is-active" : ""}`}
        onClick={() => onChange("agent")}
        title={t("view.agentTip")}
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
        title={hasHuman ? t("view.humanTip") : t("view.humanNoneTip")}
      >
        <HumanGlyph />
        {t("view.human")}
        {/* A record with nothing to show under this segment says so before it is pressed,
            in the app's own quiet way of marking an empty count. */}
        {!hasHuman && (
          <span className="segment-count" aria-hidden="true">
            —
          </span>
        )}
      </button>
    </div>
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
  onShowAgent: () => void;
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
      <div className="human-empty-action">
        <button type="button" className="button button-sm" onClick={onShowAgent}>
          {t("view.emptyBack")}
        </button>
      </div>
    </div>
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
  onShowAgent: () => void;
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
