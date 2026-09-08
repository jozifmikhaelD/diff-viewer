import type { Commit, RepoInfo, Worktree } from "../api";

const sig = (time: number) => ({ name: "Fixture Author", email: "author@example.com", time });

export const worktreeMain: Worktree = {
  path: "/work/repo",
  head: "aaaaaaa1",
  branch: "main",
  detached: false,
  bare: false,
  locked: false,
  prunable: false,
  main: true,
  current: true,
  status: { staged: 1, unstaged: 2, untracked: 3, conflicts: 0 },
};

export const worktreeFeature: Worktree = {
  ...worktreeMain,
  path: "/work/wt-feature",
  head: "bbbbbbb1",
  branch: "feature",
  main: false,
  current: false,
  status: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
};

export const repoInfo: RepoInfo = {
  root: "/work/repo",
  commonDir: "/work/repo/.git",
  defaultBranch: "main",
  worktrees: [worktreeMain, worktreeFeature],
};

export const commits: Commit[] = [
  { sha: "m1m1m1m1", parents: ["c4c4c4c4", "t1t1t1t1"], author: sig(1700000300), committer: sig(1700000300), subject: "m1: merge topic", refs: [{ name: "main", kind: "branch", head: true }] },
  { sha: "t1t1t1t1", parents: ["c3c3c3c3"], author: sig(1700000240), committer: sig(1700000240), subject: "t1: topic work", refs: [{ name: "topic", kind: "branch" }] },
  { sha: "c4c4c4c4", parents: ["c3c3c3c3"], author: sig(1700000180), committer: sig(1700000180), subject: "c4: add submodule" },
  { sha: "c3c3c3c3", parents: ["c2c2c2c2"], author: sig(1700000120), committer: sig(1700000120), subject: "c3: rename util", refs: [{ name: "v0.1.0", kind: "tag" }] },
  { sha: "c2c2c2c2", parents: ["c1c1c1c1"], author: sig(1700000060), committer: sig(1700000060), subject: "c2: add version" },
  { sha: "c1c1c1c1", parents: [], author: sig(1700000000), committer: sig(1700000000), subject: "c1: initial project" },
];
