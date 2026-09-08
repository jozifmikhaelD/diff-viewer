import type { Worktree } from "../api";
import { ROW_HEIGHT } from "./lanes";

interface Props {
  worktree: Worktree;
  selected: boolean;
  onSelect: () => void;
}

/** Pinned row above the history representing uncommitted changes. */
export function WorkingTreeRow({ worktree, selected, onSelect }: Props) {
  const st = worktree.status;
  const clean = !st || (st.staged === 0 && st.unstaged === 0 && st.untracked === 0 && st.conflicts === 0);
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`commit-row working-tree${selected ? " selected" : ""}`}
      style={{ height: ROW_HEIGHT }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <span className="working-tree-dot" aria-hidden="true" />
      <span className="commit-subject">Working tree</span>
      <span className="commit-meta">
        {worktree.statusError && <span className="badge badge-error" title={worktree.statusError}>error</span>}
        {clean && !worktree.statusError && <span className="badge badge-clean">clean</span>}
        {st && st.conflicts > 0 && <span className="badge badge-conflict">{st.conflicts} conflict{st.conflicts === 1 ? "" : "s"}</span>}
        {st && st.staged > 0 && <span className="badge badge-staged">{st.staged} staged</span>}
        {st && st.unstaged > 0 && <span className="badge badge-unstaged">{st.unstaged} unstaged</span>}
        {st && st.untracked > 0 && <span className="badge badge-untracked">{st.untracked} untracked</span>}
      </span>
    </div>
  );
}
