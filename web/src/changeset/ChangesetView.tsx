import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, changesetApi, type ChangesetSelector, type Commit, type Worktree, type WorktreeMode } from "../api";
import { DiffView, type DiffMode } from "../diff/DiffView";
import { DepsMap } from "../map/DepsMap";
import { Splitter } from "../Splitter";
import { usePaneWidth } from "../usePaneWidth";
import type { Selection } from "../history/CommitList";
import { relativeTime } from "../lib/time";
import { FileList, type FileView } from "./FileList";
import { StatsBanner } from "./StatsBanner";
import { buildTree, languageBreakdown, matchesFilter, type TreeNode } from "./summary";

interface Props {
  worktree: Worktree;
  selection: NonNullable<Selection>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onSelectionChange?: (sel: Selection) => void;
  scheme?: "light" | "dark";
}

const MODES: { value: WorktreeMode; label: string }[] = [
  { value: "all", label: "All uncommitted" },
  { value: "staged", label: "Staged" },
  { value: "unstaged", label: "Unstaged" },
  { value: "untracked", label: "Untracked" },
];

function usePersisted<T extends string>(key: string, fallback: T, valid: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T | null;
      return v && valid.includes(v) ? v : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // storage unavailable; the choice still applies for this session
    }
  };
  return [value, set];
}

export function ChangesetView({ worktree, selection, selectedPath, onSelectPath, onSelectionChange, scheme }: Props) {
  const [mode, setMode] = useState<WorktreeMode>("all");
  const [view, setView] = usePersisted<FileView>("void.fileView", "tree", ["tree", "flat"]);
  const [diffMode, setDiffMode] = usePersisted<DiffMode>("void.diffMode", "unified", ["unified", "split"]);
  const [ws, setWs] = usePersisted<"0" | "1">("void.ignoreWhitespace", "0", ["0", "1"]);
  const [filter, setFilter] = useState("");
  const [pane, setPane] = useState<"diff" | "map">("diff");
  const [filesWidth, setFilesWidth, resetFilesWidth] = usePaneWidth({ key: "void.filesWidth", initial: 300, min: 200, max: 800 });

  const selector: ChangesetSelector =
    selection.kind === "commit"
      ? { commit: selection.sha }
      : selection.kind === "range"
        ? { from: selection.from, to: selection.to, mergeBase: selection.mergeBase }
        : { worktree: mode };
  const changeset = useQuery({
    queryKey: ["changeset", worktree.path, selector],
    queryFn: () => changesetApi.changeset(worktree.path, selector),
    refetchInterval: selection.kind === "worktree" ? 30000 : false,
  });
  const commit = useQuery({
    queryKey: ["commit", worktree.path, selection.kind === "commit" ? selection.sha : ""],
    queryFn: () => api.log({ wt: worktree.path, ref: selection.kind === "commit" ? selection.sha : "", limit: 1 }),
    enabled: selection.kind === "commit",
    select: (page) => page.commits[0],
    staleTime: Infinity,
  });

  const files = useMemo(() => changeset.data?.files ?? [], [changeset.data]);
  // Files in the order they are displayed (tree order collapses dirs first), so
  // keyboard navigation and the default selection follow what the user sees.
  const visible = useMemo(() => {
    const matching = files.filter((f) => matchesFilter(f, filter));
    if (view === "flat") return matching;
    const out: typeof matching = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === "file") out.push(n.file);
        else walk(n.children);
      }
    };
    walk(buildTree(matching));
    return out;
  }, [files, filter, view]);
  // The first visible file is shown until the user picks one.
  const current = files.find((f) => f.path === selectedPath) ?? visible[0];

  // n / p move between files, "/" focuses the filter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Filter files"]')?.focus();
        return;
      }
      if (e.key === "m" && !typing) {
        e.preventDefault();
        setPane((p) => (p === "diff" ? "map" : "diff"));
        return;
      }
      if (typing || (e.key !== "n" && e.key !== "p") || visible.length === 0) return;
      e.preventDefault();
      const idx = current ? visible.findIndex((f) => f.path === current.path) : -1;
      const next = e.key === "n" ? Math.min(idx + 1, visible.length - 1) : Math.max(idx - 1, 0);
      onSelectPath(visible[next].path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, current, onSelectPath]);

  return (
    <div className="changeset">
      {selection.kind === "commit" ? (
        <CommitHeader commit={commit.data} sha={selection.sha} />
      ) : selection.kind === "range" ? (
        <RangeHeader selection={selection} onChange={onSelectionChange} from={changeset.data?.from} to={changeset.data?.to} />
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
          <StatsBanner totals={changeset.data.totals} languages={languageBreakdown(changeset.data.files)}>
            <div className="segmented" role="radiogroup" aria-label="Pane">
              {(["diff", "map"] as const).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={pane === p} className={pane === p ? "on" : ""} onClick={() => setPane(p)} title={p === "map" ? "Dependency map (m)" : "Diff (m)"}>
                  {p === "diff" ? "Diff" : "Map"}
                </button>
              ))}
            </div>
          </StatsBanner>
          <div className="changeset-body" style={{ gridTemplateColumns: `${filesWidth}px 6px 1fr` }}>
            <FileList
              files={changeset.data.files}
              filter={filter}
              onFilterChange={setFilter}
              selectedPath={current?.path ?? null}
              onSelect={onSelectPath}
              view={view}
              onViewChange={setView}
            />
            <Splitter width={filesWidth} onChange={setFilesWidth} onReset={resetFilesWidth} label="Resize file list" min={200} max={800} />
            {pane === "map" ? (
              <DepsMap
                worktree={worktree}
                selector={selector}
                changedPaths={new Set(files.map((f) => f.path))}
                selectedPath={current?.path ?? null}
                onSelectPath={(p) => {
                  onSelectPath(p);
                  setPane("diff");
                }}
              />
            ) : current ? (
              <DiffView
                key={`${current.path}:${current.oldPath ?? ""}`}
                worktree={worktree}
                selector={selector}
                file={current}
                scheme={scheme}
                mode={diffMode}
                onModeChange={setDiffMode}
                ignoreWhitespace={ws === "1"}
                onIgnoreWhitespaceChange={(v) => setWs(v ? "1" : "0")}
              />
            ) : (
              <div className="diff diff-empty">
                <p className="empty">{files.length === 0 ? "Nothing to show." : "No file matches the filter."}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const short = (rev: string | undefined) => (rev && /^[0-9a-f]{8,40}$/.test(rev) ? rev.slice(0, 7) : rev);

function RangeHeader({
  selection,
  onChange,
  from,
  to,
}: {
  selection: Extract<NonNullable<Selection>, { kind: "range" }>;
  onChange?: (sel: Selection) => void;
  from?: string;
  to?: string;
}) {
  return (
    <header className="changeset-header range-header">
      <h2>
        Range <code title={from}>{short(from) ?? short(selection.from)}</code>
        {selection.mergeBase ? " … " : " .. "}
        <code title={to}>{short(to) ?? short(selection.to)}</code>
      </h2>
      <label className="check">
        <input
          type="checkbox"
          checked={selection.mergeBase}
          onChange={(e) => onChange?.({ ...selection, mergeBase: e.target.checked })}
          disabled={!onChange}
        />{" "}
        Compare against merge base
      </label>
      <p className="commit-header-meta">
        {selection.mergeBase
          ? `Changes on ${selection.to} since it diverged from ${selection.from}.`
          : `Everything that differs between ${selection.from} and ${selection.to}.`}
      </p>
    </header>
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
