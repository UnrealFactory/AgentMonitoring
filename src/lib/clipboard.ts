/**
 * Put text on the clipboard, and say honestly whether it landed.
 *
 * `navigator.clipboard` needs a secure context and a user gesture, and a webview can refuse
 * it for reasons the page cannot see. The old textarea trick still works where that happens,
 * so it is the fallback rather than the first choice — and it borrows the focus for one
 * synchronous moment, so it puts it back exactly where it found it (the context menu is in
 * the middle of handing the keyboard back to the row when this runs).
 *
 * Never throws: the caller shows one line either way, which is what makes a copy action
 * believable (src/components/ContextMenu.tsx).
 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  try {
    const active = document.activeElement;
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}
