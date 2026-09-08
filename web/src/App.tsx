import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Worktree } from "./api";
import { CommitList, type Selection } from "./history/CommitList";
import { WorktreeSwitcher } from "./history/WorktreeSwitcher";

export default function App() {
  const repo = useQuery({ queryKey: ["repo"], queryFn: api.repo, refetchInterval: 5000 });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: Infinity });

  const [wtPath, setWtPath] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const worktrees = repo.data?.worktrees ?? [];
  const current: Worktree | undefined =
    worktrees.find((w) => w.path === wtPath) ?? worktrees.find((w) => w.current) ?? worktrees[0];

  const switchWorktree = (path: string) => {
    setWtPath(path);
    setSelection(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>void</h1>
        {repo.data && current && (
          <WorktreeSwitcher worktrees={worktrees} value={current.path} onChange={switchWorktree} />
        )}
        <span className="spacer" />
        {repo.data && <span className="repo-root" title={repo.data.root}>{repo.data.root}</span>}
        {health.data && <span className="version">v{health.data.version}</span>}
      </header>
      {repo.isPending && <p role="status">Connecting…</p>}
      {repo.isError && (
        <p role="alert" className="error">
          Could not reach the void server: {repo.error.message}
        </p>
      )}
      {repo.data && current && (
        <div className="app-body">
          <aside className="sidebar">
            <CommitList key={current.path} worktree={current} selection={selection} onSelect={setSelection} />
          </aside>
          <main className="content">
            {selection === null && <p className="empty">Select a commit or the working tree to see its changes.</p>}
            {selection?.kind === "commit" && (
              <p className="empty">
                Commit <code>{selection.sha.slice(0, 7)}</code> selected. Changeset view arrives in M2.
              </p>
            )}
            {selection?.kind === "worktree" && <p className="empty">Working tree selected. Changeset view arrives in M2.</p>}
          </main>
        </div>
      )}
    </div>
  );
}
