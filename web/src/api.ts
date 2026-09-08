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
