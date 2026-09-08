import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, changesetApi, type ChangesetSelector, type Commit, type Worktree, type WorktreeMode } from "../api";
import type { Selection } from "../history/CommitList";
import { relativeTime } from "../lib/time";
import { FileList, type FileView } from "./FileList";
import { StatsBanner } from "./StatsBanner";
import { languageBreakdown } from "./summary";

interface Props {
  worktree: Worktree;
  selection: NonNullable<Selection>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
}

const MODES: { value: WorktreeMode; label: string }[] = [
  { value: "all", label: "All uncommitted" },
  { value: "staged", label: "Staged" },
  { value: "unstaged", label: "Unstaged" },
  { value: "untracked", label: "Untracked" },
];

const VIEW_KEY = "void.fileView";
function loadView(): FileView {
  try {
    return localStorage.getItem(VIEW_KEY) === "flat" ? "flat" : "tree";
  } catch {
    return "tree";
  }
}

export function ChangesetView({ worktree, selection, selectedPath, onSelectPath }: Props) {
  const [mode, setMode] = useState<WorktreeMode>("all");
  const [view, setView] = useState<FileView>(loadView);
  const changeView = (v: FileView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable; view is still applied for this session
    }
  };

  const selector: ChangesetSelector = selection.kind === "commit" ? { commit: selection.sha } : { worktree: mode };
  const changeset = useQuery({
    queryKey: ["changeset", worktree.path, selector],
    queryFn: () => changesetApi.changeset(worktree.path, selector),
    refetchInterval: selection.kind === "worktree" ? 3000 : false,
  });
  const commit = useQuery({
    queryKey: ["commit", worktree.path, selection.kind === "commit" ? selection.sha : ""],
    queryFn: () => api.log({ wt: worktree.path, ref: selection.kind === "commit" ? selection.sha : "", limit: 1 }),
    enabled: selection.kind === "commit",
    select: (page) => page.commits[0],
    staleTime: Infinity,
  });

  return (
    <div className="changeset">
      {selection.kind === "commit" ? (
        <CommitHeader commit={commit.data} sha={selection.sha} />
      ) : (
        <header className="changeset-header">
          <h2>Working tree</h2>
          <div className="segmented" role="radiogroup" aria-label="Uncommitted changes">
            {MODES.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} className={mode === m.value ? "on" : ""} onClick={() => setMode(m.value)}>
                {m.label}
                {worktree.status && m.value !== "all" && <span className="count">{worktree.status[m.value]}</span>}
              </button>
            ))}
          </div>
        </header>
      )}
      {changeset.isPending && <p role="status">Loading changes…</p>}
      {changeset.isError && (
        <p role="alert" className="error">
          Could not load changes: {changeset.error.message}
        </p>
      )}
      {changeset.data && (
        <>
          <StatsBanner totals={changeset.data.totals} languages={languageBreakdown(changeset.data.files)} />
          <FileList files={changeset.data.files} selectedPath={selectedPath} onSelect={onSelectPath} view={view} onViewChange={changeView} />
        </>
      )}
    </div>
  );
}

function CommitHeader({ commit, sha }: { commit: Commit | undefined; sha: string }) {
  return (
    <header className="changeset-header commit-header">
      <h2>{commit?.subject ?? <code>{sha.slice(0, 7)}</code>}</h2>
      {commit && (
        <p className="commit-header-meta">
          <span>{commit.author.name}</span>
          <time dateTime={new Date(commit.author.time * 1000).toISOString()} title={new Date(commit.author.time * 1000).toLocaleString()}>
            {relativeTime(commit.author.time)}
          </time>
          <code title={commit.sha}>{commit.sha.slice(0, 7)}</code>
          {commit.parents.length > 1 && <span className="badge badge-merge">merge · vs first parent</span>}
        </p>
      )}
      {commit?.body && <pre className="commit-body">{commit.body}</pre>}
    </header>
  );
}
