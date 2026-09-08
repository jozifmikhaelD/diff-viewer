import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Worktree } from "./api";
import { ChangesetView } from "./changeset/ChangesetView";
import { CommitList, type Selection } from "./history/CommitList";
import { WorktreeSwitcher } from "./history/WorktreeSwitcher";

export default function App() {
  const repo = useQuery({ queryKey: ["repo"], queryFn: api.repo, refetchInterval: 5000 });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: Infinity });

  const [wtPath, setWtPath] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const worktrees = repo.data?.worktrees ?? [];
  const current: Worktree | undefined =
    worktrees.find((w) => w.path === wtPath) ?? worktrees.find((w) => w.current) ?? worktrees[0];

  const switchWorktree = (path: string) => {
    setWtPath(path);
    setSelection(null);
    setSelectedPath(null);
  };
  const select = (sel: Selection) => {
    setSelection(sel);
    setSelectedPath(null);
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
            <CommitList key={current.path} worktree={current} selection={selection} onSelect={select} />
          </aside>
          <main className="content">
            {selection === null ? (
              <p className="empty">Select a commit or the working tree to see its changes.</p>
            ) : (
              <ChangesetView
                key={`${current.path}:${selection.kind === "commit" ? selection.sha : "worktree"}`}
                worktree={current}
                selection={selection}
                selectedPath={selectedPath}
                onSelectPath={setSelectedPath}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
