# void — Plan (PR/FAQ → Requirements → Work Breakdown)

## Context

Reviewing changes in VS Code is tedious: the SCM view splits staged/unstaged/commit views, you must open files one at a time, and there is no summary of what a change touched or how the touched files relate. This is worse inside dev containers and across worktrees. **void** is a local web app (Go backend, TypeScript frontend) that points at any git repo and gives a single, visual review surface: pick a commit, range, or the working tree; see totals, the file list, per-file diffs, and a dependency map of the changed files.

Greenfield project in an empty directory. This document is the planning deliverable; no code exists yet.

---

## 1. Press Release (Amazon working-backwards format)

**FOR IMMEDIATE RELEASE**

### void: see every change in a repo at a glance, from any commit, branch, or worktree

*A local, zero-config review tool that turns a git repository into a visual map of what changed and how it connects.*

**Vancouver, BC — September 2026** — Today we announce **void**, a local web application that lets developers open any git repository and instantly understand a set of changes. Click a commit, pick a range, or look at uncommitted work, and void shows the total lines added and removed, every file touched, a readable diff for each, and an interactive map of how the changed files depend on one another.

Developers spend a large share of review time simply *finding* the change: locating the right commit, opening each file in turn, and switching between staged and unstaged views. Editors treat version control as a side panel rather than a first-class review surface, and the experience degrades further inside dev containers and across multiple worktrees. The result is slow reviews, missed side effects, and a poor mental model of what a change actually did.

void fixes this with one screen. On the left, a commit graph of the repository with branches and worktrees. In the centre, the selected changeset: a stats banner (files changed, +additions, −deletions), a file list grouped by directory and coloured by change type, and a diff viewer that supports side-by-side and unified modes with syntax highlighting. On the right, a **dependency map**: the changed files drawn as nodes, with edges from import statements, and their immediate unchanged neighbours shown faintly so you can see what a change might ripple into. Selecting a node scrolls to that file's diff. Everything updates live as the working tree changes.

void runs as a single binary. `void .` in any repo, or inside a dev container, starts a local server and opens the browser. It works with worktrees natively: every worktree of the repo is listed and switchable without leaving the app. Ranges like `main..HEAD` are one click, so "everything on my branch" is as easy as a single commit.

"I used to hunt for the commit, then open twenty files one by one," said a developer on the founding team. "Now I click once and see the whole change, including the files I forgot it would affect."

void is available today as a free, open-source download for macOS and Linux. Run `void` in any repository to get started.

---

## 2. FAQ

### Customer FAQ

**Q: How do I start it?**
`void [path]` starts a server on a free localhost port and opens the browser. Inside a dev container, forward the port (or use `--host 0.0.0.0 --port 4000`) and open it from the host.

**Q: Does it need git installed?**
Yes. void shells out to the system `git` for exact CLI parity and to avoid reimplementing porcelain. Requires git ≥ 2.30.

**Q: Which languages does the dependency map understand?**
v1: TypeScript/JavaScript (ESM + CommonJS, path aliases from tsconfig), Python, Go, Java/Kotlin. Files in other languages appear as nodes with no edges. Adding a language is a single resolver module.

**Q: Does it modify my repo?**
No. v1 is strictly read-only. No staging, committing, or checkout.

**Q: Large repos?**
Commit history is paged. Diffs are computed per file on demand. The dependency map is scoped to changed files plus depth-1 neighbours by default.

**Q: Does it handle binary files, renames, submodules?**
Renames and copies are detected (`-M -C`) and shown as one entry. Binary files show size change only. Submodules show as a single "pointer changed" entry.

### Internal / Stakeholder FAQ

**Q: Why a local web app instead of a VS Code extension?**
The editor's SCM model is the constraint we are escaping. A browser UI gives full control over layout and graph rendering, works identically in and out of containers, and can later be embedded in VS Code via a simple webview iframe if wanted.

**Q: Why Go + TypeScript?**
Go gives a single static binary that cross-compiles trivially into containers, with straightforward concurrency for parallel git calls. TypeScript owns the UI, where the ecosystem for diff and graph rendering is strongest.

**Q: Why shell out to git rather than use go-git?**
Parity and coverage. go-git lags on rename detection, worktrees, and pathspec edge cases. Shelling out with `--porcelain`/`-z` formats is stable and fast enough; we can swap hot paths later.

**Q: What is explicitly out of v1?**
Write operations (stage/commit/discard), comments/annotations, remote/PR integration, blame, multi-repo dashboards, co-change analysis, Windows support.

**Q: What does success look like?**
Time from "open tool" to "understand a 20-file change" under 30 seconds. Every changed file visible without scrolling more than one screen for typical commits. Dependency map renders in < 1 s for ≤ 200 nodes.

---

## 3. Refined Requirements

### 3.1 Functional

**R1. Repository & worktree selection**
- Launch with a path; detect the repo root and all worktrees (`git worktree list --porcelain`).
- Worktree switcher in the header; each worktree has its own HEAD, branch, and working-tree state.
- Recent repos list (persisted in `~/.config/void/`).

**R2. History browser**
- Paged commit list (`git log --format=... -z`) with graph lanes, branch/tag refs, author, relative date, short subject.
- Filter by branch, author, text; jump to SHA.
- Virtual "Working tree" entry pinned at top (with badges for staged/unstaged/untracked counts).

**R3. Changeset selection modes**
- Single commit (baseline).
- Range: `A..B` and `A...B`, with presets "branch vs base" (merge-base of HEAD and default branch) and shift-click two commits.
- Working tree: staged, unstaged, untracked, and combined "all uncommitted" views.

**R4. Changeset summary**
- Banner: files changed, +added, −deleted, per-language breakdown.
- File list: tree or flat, grouped by directory, status glyph (A/M/D/R/C/T), per-file +/− bar, filter box, ignore-whitespace and hide-generated toggles.

**R5. Diff viewer**
- Side-by-side and unified, syntax highlighting, word-level intra-line highlighting, expandable context, collapse unchanged hunks.
- Keyboard nav: `j/k` next/prev hunk, `n/p` next/prev file, `/` filter.
- Binary/large-file fallbacks; rename shown with old → new path.

**R6. Dependency map**
- Nodes: changed files (coloured by status), plus depth-1 import neighbours (muted). Depth slider 0–2.
- Edges: static imports resolved to repo files (per-language resolvers; tsconfig `paths` and `baseUrl`; Python packages; Go module path; Java packages).
- Interaction: hover shows path + stats; click scrolls the diff pane; drag/zoom; cluster by top-level directory; toggle to hide neighbours.
- Cache the import index per commit SHA; incremental update for working tree via file watcher.

**R7. Live updates**
- Watch the working tree (fsnotify) and `.git` refs; push updates over WebSocket/SSE so the working-tree view and history refresh without reload.

### 3.2 Non-functional
- Single static binary embedding the built frontend (`embed.FS`).
- Cold start to first paint < 1 s on a 10k-commit repo; commit list pages of 200.
- Read-only: no git command with side effects is ever executed.
- Cross-platform: macOS + Linux (amd64/arm64) in v1; Windows later.
- Works in dev containers: bind `--host`, print the URL, no browser-open assumptions.
- Accessible: keyboard-first, high-contrast diff colours, light/dark.

### 3.3 Out of scope for v1
Write operations, comments, GitHub/GitLab PR sync, blame, co-change graph, multi-repo, Windows, auth.

---

## 4. Architecture

```
void (Go binary)
├─ cmd/void            CLI: path, --port, --host, --open
├─ internal/git        thin wrapper over `git` (exec, -z parsing, caching)
│    ├─ repo.go        root, worktrees, refs
│    ├─ log.go         paged history + graph lanes
│    ├─ diff.go        numstat, name-status, per-file patch, working tree
│    └─ show.go        file content at rev (for side-by-side)
├─ internal/deps       import indexer + per-language resolvers
│    ├─ index.go       walk tree at rev, cache by SHA
│    └─ lang/{ts,py,go,java}.go
├─ internal/watch      fsnotify → event bus
├─ internal/api        HTTP (JSON) + SSE; embeds web/dist
└─ web/                TypeScript frontend (Vite + React)
     ├─ history/       commit graph (virtualised list)
     ├─ changeset/     stats banner, file tree
     ├─ diff/          diff renderer (side-by-side/unified)
     └─ map/           dependency graph (d3-force or cytoscape.js)
```

**Key API endpoints**
- `GET /api/repo` → root, worktrees, default branch, HEAD per worktree
- `GET /api/log?wt=&ref=&skip=&limit=&author=&grep=` → commits with parents and refs; lane layout is computed client-side (pure function, continues across pages)
- `GET /api/changeset?wt=&(commit=|from=&to=[&mergeBase=1]|worktree=staged|unstaged|untracked|all)` → files (status, rename, binary, submodule, +/−) + totals; language breakdown computed client-side
- `GET /api/diff?wt=&<selector>&path=&oldPath=&context=&ws=1` → structured hunks + both full sides (≤2 MiB / 20k lines) so the client renders side-by-side and expands context locally
- `GET /api/deps?wt=&rev=&paths=...&depth=1` → nodes + edges
- `GET /api/events` → SSE stream (worktree changed, refs changed)

**Frontend libs (pinned when scaffolding):** React, Vite, TanStack Query, `@git-diff-view/react` or `react-diff-view` for rendering, Shiki for highlighting, `d3-force` or `cytoscape.js` for the map, `react-virtual` for lists.

---

## 5. Work Breakdown

Each milestone is independently demoable. Estimates are rough engineering days and include tests.

**Definition of done for every milestone**
- Go: unit tests for every new package (`go test -race`), parsers tested against recorded `git` output fixtures in `testdata/`.
- API: golden tests for every endpoint against the integration fixture repo (built by `testdata/mkrepo.sh`: branches, a worktree, renames, binary file, submodule, staged + unstaged + untracked edits).
- Frontend: Vitest + React Testing Library tests for each component with real edge cases; no snapshot-only tests.
- E2E (from M3): Playwright suite that launches the binary against the fixture repo and walks the core flows.
- CI green: golangci-lint, eslint/tsc, all test suites, build matrix (darwin/linux × amd64/arm64). Coverage reported, no hard threshold in v1.

### M0 — Scaffold (1d) ✅ 2026-09-08
- Go module, `cmd/void`, Vite React app in `web/`, `embed.FS` wiring, Makefile (`make dev` runs both; `make build` produces one binary), CI (lint + test + build matrix).
- **Tests:** `testdata/mkrepo.sh` fixture repo builder + a Go test helper that creates it in a temp dir; Vitest and Playwright configured with one smoke test each so CI runs all suites from day one.

### M1 — Repo + history (3d) ✅ 2026-09-08
- `internal/git`: exec wrapper with context, timeouts, `-z` parsing; repo root + worktree discovery; paged log with lanes.
- API `/api/repo`, `/api/log`.
- UI: header with worktree switcher; virtualised commit list with graph lanes; pinned "Working tree" row.
- **Tests:** `-z` log/worktree parser fixtures (merges, octopus, detached HEAD, tags); lane algorithm unit tests; API golden tests for `/api/repo` and `/api/log` (paging, worktree switch); component tests for commit list and switcher.
- **Demo:** open any repo, scroll history, switch worktrees.

### M2 — Changeset summary (2d) ✅ 2026-09-08
- `diff.go`: numstat + name-status for commit, range, and working-tree modes (staged/unstaged/untracked).
- API `/api/changeset`.
- UI: stats banner, file tree/flat toggle, status glyphs, +/− bars, filter.
- **Tests:** numstat/name-status parsers (renames, copies, binary `-`, type change, paths with spaces/unicode); golden tests for every mode of `/api/changeset` (commit, range, staged, unstaged, untracked, all); file-tree component tests (grouping, filter, empty state).
- **Demo:** click a commit or range, see totals and file list.

### M3 — Diff viewer (4d) ✅ 2026-09-08 (syntax highlighting deferred to M6 polish)
- `diff.go`: per-file structured hunks; `show.go` for full-file content at both revs; rename/binary handling.
- API `/api/diff`.
- UI: side-by-side and unified, Shiki highlighting, word-level diff, expand context, keyboard nav, ignore-whitespace.
- **Tests:** hunk parser fixtures (no newline at EOF, CRLF, empty file, binary, rename with edits, mode-only change); `/api/diff` golden tests; diff renderer component tests for each fixture in both modes plus keyboard nav; first Playwright flow: open repo → click commit → open file → toggle side-by-side.
- **Demo:** full commit review without leaving the page.

### M4 — Range & working-tree UX (2d)
- Shift-click range selection; "branch vs base" preset via merge-base; staged/unstaged/all tabs.
- `internal/watch` + SSE; live refresh of working-tree row and diffs.
- **Tests:** merge-base preset and range-normalisation unit tests; watcher tests (debounce, ignore `.git` internals except refs, worktree-scoped events); SSE endpoint test; Playwright flow: mutate fixture working tree → UI updates without reload; shift-click range flow.
- **Demo:** edit a file in the editor, see void update.

### M5 — Dependency map (5d)
- `internal/deps`: tree walk at rev, import extraction per language, resolver to repo paths, SHA-keyed cache, incremental update for working tree.
- API `/api/deps`.
- UI: force-directed graph, status colouring, neighbour muting, depth slider, click-to-scroll, directory clustering.
- **Tests:** per-language resolver fixture trees (TS: relative, tsconfig `paths`/`baseUrl`, index files, `.js`→`.ts`; Python: relative + package imports; Go: module-path imports; Java: package imports); cache invalidation tests (SHA-keyed, working-tree incremental); `/api/deps` golden tests at depth 0/1/2; graph component tests (node click scrolls, neighbour toggle); Playwright flow: select commit → map renders → click node → diff scrolls.
- **Demo:** see how a change ripples through the codebase.

### M6 — Polish & release (2d)
- Recent repos, light/dark, empty/error states, large-repo guardrails, `--open` browser launch, goreleaser for macOS/Linux binaries, README with dev-container instructions.
- **Tests:** config persistence tests; error-state component tests (not a repo, git missing, permission denied); performance smoke test in CI against a generated 10k-commit repo asserting first-page latency; release build verified by running the packaged binary against the fixture repo.

**Total: ~21 engineering days (tests included).**

---

## 6. Verification

Automated coverage is defined per milestone above (definition of done + per-milestone test lines). In addition:

- **Manual acceptance per milestone:** run `void` against (a) this repo, (b) a large public repo (e.g. `kubernetes/kubernetes` clone) for performance, (c) a repo inside a dev container with port-forwarding.
- **Success metrics from FAQ:** first paint < 1 s; 20-file change fully understood in < 30 s (self-timed); map renders < 1 s for ≤ 200 nodes.

---

## 7. Open decisions (defaults chosen; flag if you disagree)
- Frontend framework: **React** (Svelte is the alternative; React has the richer diff/graph libraries).
- Graph library: **d3-force** for control over layout; cytoscape.js if we want built-in clustering fast.
- Config location: `~/.config/void/config.json`.
- Licence: MIT.
