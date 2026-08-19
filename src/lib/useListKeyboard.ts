/**
 * Keyboard driving for the two record lists (work, bugs). One implementation, so the two
 * screens cannot drift into having different keys — which is the sort of difference a
 * reader feels as "this app was built by two people".
 *
 *   ↑ ↓ / j k   move the cursor        ↵   open the row under it
 *   /  ⌘F ⌃F    focus the search box   esc clear the query and drop focus
 *
 * Arrow keys are handed back to a focused <select>, and letters are handed back to any
 * text field, so typing "j" into search types a j. And the whole thing stands down while a
 * modal is open: this handler is on `window`, so without that check the command palette's
 * arrows moved *this* cursor behind the scrim and ↵ navigated the page under it.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { isModalOpen } from "./modal";

export function useListKeyboard<T>(opts: {
  /** Rows in the order they appear on screen. */
  items: T[];
  /** Where ↵ goes for a row. */
  href: (item: T) => string;
  searchRef: RefObject<HTMLInputElement>;
  query: string;
  onClearQuery: () => void;
  /** Any change to this value invalidates the cursor (the result set moved under it). */
  resetKey: unknown;
}) {
  const { items, href, searchRef, query, onClearQuery, resetKey } = opts;
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(-1);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // A new result set invalidates the old cursor position.
  useEffect(() => setCursor(-1), [resetKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // A control that has already acted on this key owns it: an open filter menu moves
      // its own cursor with the arrows, and the list must not move too. A modal owns every
      // key while it is up — including Escape, which is how it gets closed.
      if (e.defaultPrevented || isModalOpen() || el?.closest?.(".select-root")) return;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

      if (e.key === "Escape") {
        if (query) onClearQuery();
        el?.blur();
        return;
      }
      if (!typing && (e.key === "/" || (e.key === "f" && (e.metaKey || e.ctrlKey)))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      // Arrows belong to a <select> when one has focus; everywhere else they drive the list.
      if (el?.tagName === "SELECT") return;
      if (typing && e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (!items.length) return;

      const move = (delta: number) => {
        e.preventDefault();
        setCursor((c) => {
          const next = Math.min(items.length - 1, Math.max(0, c < 0 ? 0 : c + delta));
          rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      };
      if (e.key === "ArrowDown" || (!typing && e.key === "j")) move(1);
      else if (e.key === "ArrowUp" || (!typing && e.key === "k")) move(-1);
      else if (e.key === "Enter" && cursor >= 0 && items[cursor]) {
        e.preventDefault();
        navigate(href(items[cursor]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cursor, navigate, href, query, onClearQuery, searchRef]);

  return { cursor, setCursor, rowRefs };
}
