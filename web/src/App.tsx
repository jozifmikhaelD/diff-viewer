import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Worktree } from "./api";
import { ChangesetView } from "./changeset/ChangesetView";
import { CommitList, type Selection } from "./history/CommitList";
import { useLiveUpdates } from "./live";
import { WorktreeSwitcher } from "./history/WorktreeSwitcher";

function selectionKey(sel: NonNullable<Selection>): string {
  switch (sel.kind) {
    case "commit":
      return sel.sha;
    case "range":
      return `${sel.from}..${sel.to}`;
    default:
      return "worktree";
  }
}

export default function App() {
  const repo = useQuery({ queryKey: ["repo"], queryFn: api.repo, refetchInterval: 30000 });
  useLiveUpdates();
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
  const defaultBranch = repo.data?.defaultBranch ?? "";
  const canCompareBase = Boolean(current && defaultBranch && !current.detached && current.branch !== defaultBranch);
  const compareBase = () => select({ kind: "range", from: defaultBranch, to: "HEAD", mergeBase: true });
  const comparingBase = selection?.kind === "range" && selection.from === defaultBranch && selection.to === "HEAD";

  return (
    <div className="app">
      <header className="app-header">
        <h1>void</h1>
        {repo.data && current && (
          <WorktreeSwitcher worktrees={worktrees} value={current.path} onChange={switchWorktree} />
        )}
        {canCompareBase && (
          <button type="button" className={`ghost${comparingBase ? " on" : ""}`} onClick={compareBase} title={`Changes on ${current?.branch} since it diverged from ${defaultBranch}`}>
            {current?.branch} vs {defaultBranch}
          </button>
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
                key={`${current.path}:${selectionKey(selection)}`}
                worktree={current}
                selection={selection}
                selectedPath={selectedPath}
                onSelectPath={setSelectedPath}
                onSelectionChange={select}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
