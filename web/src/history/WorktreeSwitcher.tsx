import type { Worktree } from "../api";

interface Props {
  worktrees: Worktree[];
  value: string;
  onChange: (path: string) => void;
}

function label(wt: Worktree): string {
  const name = wt.path.split("/").filter(Boolean).pop() ?? wt.path;
  const ref = wt.bare ? "bare" : wt.detached ? `detached @ ${wt.head.slice(0, 7)}` : wt.branch;
  return `${name} · ${ref}${wt.main ? " (main worktree)" : ""}`;
}

export function WorktreeSwitcher({ worktrees, value, onChange }: Props) {
  if (worktrees.length <= 1) {
    const only = worktrees[0];
    return only ? <span className="worktree-single" title={only.path}>{label(only)}</span> : null;
  }
  return (
    <label className="worktree-switcher">
      <span className="visually-hidden">Worktree</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} title="Switch worktree">
        {worktrees.map((wt) => (
          <option key={wt.path} value={wt.path} disabled={wt.prunable}>
            {label(wt)}
          </option>
        ))}
      </select>
    </label>
  );
}
