export type Selection =
  | { kind: "commit"; sha: string }
  | { kind: "worktree" }
  | { kind: "range"; from: string; to: string; mergeBase: boolean }
  | null;

/**
 * Builds a range from an anchor and a shift-clicked commit. Commits are in
 * newest-first order, so the one further down the list is the older `from`.
 * Returns null when either end is not in the loaded list.
 */
export function rangeFromClick(anchor: string, clicked: string, order: readonly string[]): Selection {
  const a = order.indexOf(anchor);
  const b = order.indexOf(clicked);
  if (a === -1 || b === -1 || a === b) return null;
  const [newer, older] = a < b ? [anchor, clicked] : [clicked, anchor];
  return { kind: "range", from: older, to: newer, mergeBase: false };
}

/** The sha a shift-click extends from: the selected commit, or a range's newer end. */
export function anchorOf(sel: Selection): string | null {
  if (sel?.kind === "commit") return sel.sha;
  if (sel?.kind === "range") return sel.to;
  return null;
}
