/**
 * A filter control that belongs to this app rather than to the operating system.
 *
 * A native `<select>` can be styled down to the last pixel and still open a white Windows
 * list box in the middle of a dark toolbar — which is the one moment a careful screen
 * gives itself away. This is the same control drawn by the app: a button that states the
 * current choice, and a popover that behaves the way a menu is expected to.
 *
 *   ↑ ↓  move        ↵  choose        esc / click outside / tab  close
 *
 * Options carry an optional `hint` (a count, a status dot) shown on the right, and an
 * optional `dot` class for the coloured marker used by severity and status menus.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  hint?: ReactNode;
}

export function Select({
  value,
  options,
  onChange,
  label,
  width,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name, e.g. "Filter by severity". */
  label: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const current = options.find((o) => o.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  // Opening starts on the current choice, not at the top: ↓ then ↵ moves one step.
  useEffect(() => {
    if (open) setCursor(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // A menu that survives scrolling under the mouse is a menu that has come loose.
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(".select-option.is-cursor")?.scrollIntoView({
      block: "nearest",
    });
  }, [open, cursor]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (open) e.stopPropagation(); // the list's own Escape handler clears its search
      setOpen(false);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(options.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setCursor(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[cursor];
      if (opt) choose(opt.value);
    }
  };

  return (
    <div className="select-root" ref={rootRef} style={width ? { width } : undefined}>
      <button
        type="button"
        className={`select-button${open ? " is-open" : ""}${current?.value !== options[0]?.value ? " is-set" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{current?.label ?? ""}</span>
        <svg className="select-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3 4.5 L6 7.5 L9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          className="select-menu"
          role="listbox"
          id={id}
          aria-label={label}
          ref={listRef}
          tabIndex={-1}
        >
          {options.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`select-option${i === cursor ? " is-cursor" : ""}${
                  o.value === value ? " is-selected" : ""
                }`}
                onClick={() => choose(o.value)}
                onMouseEnter={() => setCursor(i)}
              >
                <span className="select-check" aria-hidden="true">
                  {o.value === value ? (
                    <svg viewBox="0 0 12 12" width="10" height="10">
                      <path
                        d="M2.5 6.2 L4.8 8.5 L9.5 3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
                <span className="select-option-label">{o.label}</span>
                {o.hint !== undefined && <span className="select-option-hint tabular">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
