export interface Health {
  ok: boolean;
  version: string;
}

export interface WorktreeStatus {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
}

export interface Worktree {
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  main: boolean;
  current: boolean;
  status?: WorktreeStatus;
  statusError?: string;
}

export interface RepoInfo {
  root: string;
  commonDir: string;
  defaultBranch: string;
  worktrees: Worktree[];
}

export type RefKind = "branch" | "tag" | "remote";

export interface Ref {
  name: string;
  kind: RefKind;
  head?: boolean;
}

export interface Signature {
  name: string;
  email: string;
  time: number;
}

export interface Commit {
  sha: string;
  parents: string[];
  author: Signature;
  committer: Signature;
  subject: string;
  body?: string;
  refs?: Ref[];
}

export interface LogPage {
  commits: Commit[];
  hasMore: boolean;
  skip: number;
  limit: number;
}

export interface LogParams {
  wt?: string;
  ref?: string;
  skip?: number;
  limit?: number;
  author?: string;
  grep?: string;
}

function qs(params: object): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params) as [string, string | number | undefined][]) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => getJSON<Health>("/api/health"),
  repo: () => getJSON<RepoInfo>("/api/repo"),
  log: (params: LogParams) => getJSON<LogPage>(`/api/log${qs(params)}`),
};

export type FileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "?";

export interface FileChange {
  path: string;
  oldPath?: string;
  status: FileStatus;
  similarity?: number;
  additions: number;
  deletions: number;
  binary: boolean;
  submodule?: boolean;
  oldMode?: string;
  newMode?: string;
}

export interface Totals {
  files: number;
  additions: number;
  deletions: number;
}

export type WorktreeMode = "staged" | "unstaged" | "untracked" | "all";

export type ChangesetSelector =
  | { commit: string }
  | { from: string; to: string; mergeBase?: boolean }
  | { worktree: WorktreeMode };

export interface Changeset {
  kind: "commit" | "range" | "worktree";
  from: string;
  to: string;
  files: FileChange[];
  totals: Totals;
}

export function changesetURL(wt: string, sel: ChangesetSelector): string {
  const params: Record<string, string | number | undefined> = { wt };
  if ("commit" in sel) params.commit = sel.commit;
  else if ("worktree" in sel) params.worktree = sel.worktree;
  else {
    params.from = sel.from;
    params.to = sel.to;
    if (sel.mergeBase) params.mergeBase = 1;
  }
  return `/api/changeset${qs(params)}`;
}

export const changesetApi = {
  changeset: (wt: string, sel: ChangesetSelector) => getJSON<Changeset>(changesetURL(wt, sel)),
};

export interface DiffLine {
  t: " " | "+" | "-";
  s: string;
  o?: number;
  n?: number;
  nonl?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header?: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  submodule?: boolean;
  hunks: Hunk[];
  old: string[] | null;
  new: string[] | null;
  hasOld: boolean;
  hasNew: boolean;
  truncated: boolean;
  oldSize: number;
  newSize: number;
}

export interface DiffOptions {
  context?: number;
  ignoreWhitespace?: boolean;
}

export function diffURL(wt: string, sel: ChangesetSelector, path: string, oldPath: string | undefined, opts: DiffOptions = {}): string {
  const base = changesetURL(wt, sel).replace("/api/changeset", "/api/diff");
  const extra = qs({ path, oldPath, context: opts.context, ws: opts.ignoreWhitespace ? 1 : undefined }).slice(1);
  return `${base}&${extra}`;
}

export const diffApi = {
  file: (wt: string, sel: ChangesetSelector, path: string, oldPath: string | undefined, opts?: DiffOptions) =>
    getJSON<FileDiff>(diffURL(wt, sel, path, oldPath, opts)),
};

export interface DepNode {
  path: string;
  changed: boolean;
  status?: FileStatus;
  additions: number;
  deletions: number;
  depth: number;
}

export interface DepEdge {
  from: string;
  to: string;
}

export interface DepGraph {
  nodes: DepNode[];
  edges: DepEdge[];
  truncated: boolean;
  indexed: number;
}

export const depsApi = {
  graph: (wt: string, sel: ChangesetSelector, depth: number, filter = "") =>
    getJSON<DepGraph>(`${changesetURL(wt, sel).replace("/api/changeset", "/api/deps")}&depth=${depth}${filter.trim() ? `&filter=${encodeURIComponent(filter.trim())}` : ""}`),
};

export interface RecentRepo {
  path: string;
  lastOpen: string;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const repoApi = {
  recent: () => getJSON<{ recent: RecentRepo[] }>("/api/recent"),
  open: (path: string) => postJSON<RepoInfo>("/api/open", { path }),
};

export interface FSEntry {
  name: string;
  path: string;
  repo: boolean;
}

export interface FSComplete {
  dir: string;
  entries: FSEntry[];
  more: boolean;
}

export const fsApi = {
  complete: (path: string) => getJSON<FSComplete>(`/api/fs/complete${qs({ path })}`),
};

export interface BlameCommit {
  sha: string;
  author: string;
  email: string;
  time: number;
  summary: string;
  uncommitted?: boolean;
}

export interface Blame {
  path: string;
  rev: string;
  lines: string[];
  commits: Record<string, BlameCommit>;
}

export const blameApi = {
  file: (wt: string, sel: ChangesetSelector, path: string) =>
    getJSON<Blame>(`${changesetURL(wt, sel).replace("/api/changeset", "/api/blame")}&${qs({ path }).slice(1)}`),
};
