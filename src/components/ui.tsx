/**
 * Shared visual primitives. Status is always carried the same way everywhere in the app:
 * a small coloured dot plus a label, never a shouting block of colour.
 */
import { useState, type ReactNode } from "react";
import { nothingToRetry, vaultErrorMessage } from "../lib/api";
import { t } from "../lib/i18n";
import type { BugStatus, Severity, WorkStatus } from "../lib/types";
import { bugStatusLabel, severityAbbr, severityLabel, unassigned, workStatusLabel } from "../lib/words";

export function WorkStatusPill({ status }: { status: WorkStatus }) {
  return (
    <span className={`pill pill-work-${status}`}>
      <span className="dot" aria-hidden="true" />
      {workStatusLabel(status)}
    </span>
  );
}

export function BugStatusPill({ status }: { status: BugStatus }) {
  return (
    <span className={`pill pill-bug-${status}`}>
      <span className="dot" aria-hidden="true" />
      {bugStatusLabel(status)}
    </span>
  );
}

/**
 * Severity, as the same coloured pill everywhere it appears — board row, record header,
 * sidebar, related block.
 *
 * In a narrow row the word may give way to a short form, never to the dot alone: four hues
 * with nothing beside them is severity encoded in colour only, which a reader with
 * red-green colour blindness cannot separate and a printer cannot reproduce.
 *
 * **Whether there is a short form is the dictionary's answer, not this component's.**
 * {@link severityAbbr} returns C/H/M/L in English and null in Korean, where no one syllable
 * of 치명적 / 높음 / 보통 / 낮음 is a word (lib/words.ts). A pill with no short form renders
 * none, wears no `has-abbr`, and the board's container query — which is keyed on that class,
 * not on the width alone — leaves its word alone at every width.
 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const label = severityLabel(severity);
  const abbr = severityAbbr(severity);
  return (
    <span
      className={`pill pill-sev pill-sev-${severity}${abbr ? " has-abbr" : ""}`}
      title={t("ui.severityOf", label)}
    >
      <span className="dot" aria-hidden="true" />
      <span className="pill-text">{label}</span>
      {abbr ? (
        <span className="pill-abbr" aria-hidden="true">
          {abbr}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A record's headline: its title, with its id set after it the way a PR number follows a
 * PR title.
 *
 * The id is bound to the title's last word with a non-breaking space, which is the whole
 * trick. Left to itself the line breaker treats the id as an ordinary word, so any title
 * that fits the measure on its own but not with the id on the end pushed the id down to a
 * line of its own — a lone "BUG-0006" under a full-width heading, which reads as a stray
 * rather than as part of the title. Bound, the last word travels with it: the second line
 * is "…card BUG-0006", which is how a wrapped title is supposed to look.
 */
export function RecordTitle({ title, id }: { title: string; id: string }) {
  const text = title.trim();
  const cut = text.lastIndexOf(" ");
  const head = cut > 0 ? text.slice(0, cut + 1) : "";
  const tail = cut > 0 ? text.slice(cut + 1) : text;
  return (
    <h1 className="record-title">
      {head}
      <span className="record-title-tail">
        {tail}
        {"\u00a0"}
        <span className="record-id mono">{id}</span>
      </span>
    </h1>
  );
}

/** The mark a correction carries, wherever one is drawn: a struck-through line. */
export function CorrectionMark() {
  return (
    <svg className="correction-mark" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3 5.5 h10 M3 10.5 h10 M12.5 3 L3.5 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * "1 correction to this record — see Updates", at the top of a record that has one.
 *
 * The record body is never rewritten (the vault is append-only), so a sentence that turned
 * out to be false stays on the page and the repair arrives later, in a note far below it.
 * This is the one line that reaches the reader before the sentence does: it does not say
 * what was corrected — only the author's note does that, and it is a link away — it says
 * that this record has been corrected, at the altitude where the reader still has time to
 * read the rest of it with that in mind.
 *
 * Counted, never inferred: a note is a correction because its author opened it with
 * `Correction:` (src/lib/updates.ts).
 */
export function CorrectionNotice({ count, href, where }: { count: number; href: string; where: string }) {
  if (count < 1) return null;
  return (
    <a className="correction-notice" href={href}>
      <span className="correction-notice-mark" aria-hidden="true">
        <CorrectionMark />
      </span>
      <span>
        <RichText text={t("rec.corrections", count, where)} />
      </span>
    </a>
  );
}

/** Status without the label: the list rows carry it as a dot in front of the id. */
export function WorkStatusDot({ status }: { status: WorkStatus }) {
  return (
    <span
      className={`sdot sdot-${status}`}
      title={workStatusLabel(status)}
      aria-label={workStatusLabel(status)}
      role="img"
    />
  );
}

export function BugStatusDot({ status }: { status: BugStatus }) {
  return (
    <span
      className={`sdot sdot-bug-${status}`}
      title={bugStatusLabel(status)}
      aria-label={bugStatusLabel(status)}
      role="img"
    />
  );
}

/** Either kind of record, for lists that mix them (the Related block). */
export function RecordStatusDot({
  status,
  kind,
}: {
  status: WorkStatus | BugStatus;
  kind: "work" | "bug";
}) {
  return kind === "bug" ? (
    <BugStatusDot status={status as BugStatus} />
  ) : (
    <WorkStatusDot status={status as WorkStatus} />
  );
}

/** A count of comments, quiet when there are none. */
export function CommentCount({ count }: { count: number }) {
  if (!count) return <span className="comment-count is-empty" aria-hidden="true" />;
  return (
    <span className="comment-count tabular" title={t("bd.comments", count)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      {count}
    </span>
  );
}

/**
 * Who found it and who owns it, in one glyph pair — the handoff is the fact a triage
 * board is read for.
 */
export function Handoff({ from, to }: { from: string; to: string | null }) {
  return (
    <span
      className="handoff"
      title={to ? t("ui.handoff", from, to) : t("ui.handoffNone", from, unassigned())}
    >
      <AgentChip name={from} hideName />
      <span className="handoff-arrow" aria-hidden="true">
        →
      </span>
      {to ? (
        <AgentChip name={to} />
      ) : (
        <span className="handoff-none">
          <span className="handoff-empty" aria-hidden="true" />
          {unassigned()}
        </span>
      )}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

/**
 * A command a reader is meant to run, with a button that puts it on the clipboard.
 *
 * Onboarding that prints a command nobody can copy is onboarding that gets mistyped. The
 * text is selectable either way, and the button falls back quietly on a webview that
 * refuses clipboard access rather than pretending it worked.
 */
export function CommandLine({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="command-line">
      <code className="command-text">{text}</code>
      <button
        className="command-copy"
        type="button"
        title={t("app.copyToClipboard")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState("copied");
          } catch {
            setState("failed");
          }
          setTimeout(() => setState("idle"), 1600);
        }}
      >
        {state === "copied" ? t("app.copied") : state === "failed" ? t("app.selectIt") : t("app.copy")}
      </button>
    </span>
  );
}

/**
 * Agent identity. `md` is the byline size (the record's author, as on a PR page);
 * `sm` is the in-a-row size. `hideName` keeps the avatar and moves the name into the
 * tooltip — for narrow rows, where a name would push the title out instead.
 */
export function AgentChip({
  name,
  size = "sm",
  hideName = false,
}: {
  name: string;
  size?: "sm" | "md";
  hideName?: boolean;
}) {
  const initials = name
    .split(/[-_\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={`agent${size === "md" ? " agent-md" : ""}${hideName ? " agent-compact" : ""}`}
      title={name}
    >
      <span className="agent-avatar" aria-hidden="true">
        {initials || "?"}
      </span>
      <span className="agent-name">{name}</span>
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `card ${className}` : "card"}>
      {(title || action) && (
        <header className="card-head">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  hint,
  icon = "·",
  action,
}: {
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label={t("app.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton" style={{ width: `${28 + ((i * 17) % 40)}%` }} />
          <span className="skeleton skeleton-sm" style={{ width: `${12 + ((i * 11) % 22)}%` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * The record on screen stopped being re-readable while somebody was reading it.
 *
 * A background refresh that fails leaves the last good copy on the page, which is right —
 * nobody asked for their reading to be replaced by an error. But a *deleted* record has no
 * tell at all without this: the board drops the row and the open detail tab goes on
 * rendering the record in full, indefinitely, so two windows on the same vault disagree and
 * neither says why. Same amber bar as the shell's, one page down.
 */
export function StaleRecordBar({
  id,
  message,
  status,
  onRetry,
  action,
}: {
  id: string;
  message: string;
  status?: number;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  const [headline] = message.split(" — ");
  /* Which of the two sentences this is comes off the message, not the status: the desktop
     app has no status to give (src/lib/api.ts), and a record deleted under an open page said
     "could not re-read it" there while browser mode said "no longer in this vault". */
  const gone = nothingToRetry(message, status);
  return (
    <div className="vault-alert vault-alert-inline" role="status">
      <span className="vault-alert-dot" aria-hidden="true" />
      <span className="vault-alert-text">
        <strong>{gone ? t("rec.staleGone", id) : t("rec.staleUnread", id)}</strong>{" "}
        {t("rec.staleBody")}{" "}
        <span className="vault-alert-detail" title={message}>
          <InlineCode text={headline} />
        </span>
      </span>
      {onRetry && (
        <button className="button button-sm" onClick={onRetry}>
          {t("app.retry")}
        </button>
      )}
      {action}
    </div>
  );
}

/**
 * Backticked spans in a backend message, rendered as code rather than printed as backticks.
 *
 * The CLI and the dev server write their errors for a human to act on, and the actionable
 * half is always a command: `agentmon init --vault "…"`. Those messages are shared with the
 * terminal, where the backticks are the convention — so the app renders them instead of
 * leaking the markup onto the screen.
 */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i}>{part}</code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/**
 * The same sentence for a place that cannot hold marks — a `title` attribute.
 *
 * `InlineCode` and `RichText` turn the dictionary's backticks and asterisks into elements;
 * a tooltip is a string, and printing the marks raw there leaks the notation onto the
 * screen. Same text, marks dropped rather than rendered.
 */
export const plainMarks = (text: string): string => text.replace(/\*\*/g, "").replace(/`/g, "");

/**
 * A failure, said in the reader's terms first and the backend's second.
 *
 * The headline used to be "Could not read the vault" for every failure, which is a
 * different sentence from the truth on the most common one: a link to `BUG-9999` in a
 * project that has nine bugs is not a vault this app cannot read, it is a record that is
 * not there — and telling somebody their data store is broken when it isn't sends them
 * looking in the wrong place. Callers that know which one it is pass the title.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  action,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Where to go instead — a list to return to, usually. */
  action?: ReactNode;
}) {
  return (
    <div className="error-state" role="alert">
      <p className="error-title">{title ?? t("vault.readFailed")}</p>
      {/* The headline is the app's sentence; this is the backend's, said in the reader's
          language when it is one of the dozen sentences this repository writes. */}
      <p className="error-message">
        <InlineCode text={vaultErrorMessage(message)} />
      </p>
      {(onRetry || action) && (
        <div className="error-actions">
          {onRetry && (
            <button className="button" onClick={onRetry}>
              {t("app.retry")}
            </button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * A line of the app's own chrome that carries two marks: `code` and **strong**.
 *
 * Onboarding steps, empty-state hints and the correction notice are sentences with a
 * command or a button name inside them. Written as JSX they had to be cut into fragments at
 * the call site — and a sentence cut into fragments cannot be translated, because the
 * pieces land in a different order in another language. So the whole sentence lives in the
 * dictionary, in the two marks a terminal reader and a Markdown writer both already know,
 * and this renders them. Nothing else is interpreted; the text is still text.
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

