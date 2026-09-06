/** A note may start with work-/bug-; only numeric suffixes identify records. */
export function recordKind(id: string): "work" | "bug" | "note" {
  if (/^WORK-\d+$/i.test(id)) return "work";
  if (/^BUG-\d+$/i.test(id)) return "bug";
  return "note";
}

/** The same classification serves related links, prose links and record menus. */
export function recordPath(projectId: string, id: string): string {
  const kind = recordKind(id);
  const page = kind === "work" ? "work" : kind === "bug" ? "bugs" : "notes";
  return `/p/${projectId}/${page}/${id}`;
}
