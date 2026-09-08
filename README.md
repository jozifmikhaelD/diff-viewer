# void

See every change in a git repository at a glance. Point void at any repo and
pick a commit, a range, or the working tree: you get totals, a file tree,
readable diffs, and a map of how the changed files depend on each other.
Works with any repository, inside dev containers, and across worktrees.

```
void .            # serve the repo in the current directory and print the URL
void -open ~/src/app
```

Status: all six planned milestones are implemented (see [docs/plan.md](docs/plan.md)
for the press release, requirements, and breakdown).

## What you get

- **History** with a commit graph, branch/tag badges, and every worktree of the
  repo in a switcher. The working tree is pinned on top with staged / unstaged /
  untracked counts.
- **Changesets** for a single commit (merges diff against their first parent),
  a shift-clicked range (`A..B`, or `A...B` against the merge base), a
  one-click "branch vs main", or the uncommitted work (all / staged / unstaged /
  untracked).
- **Summary**: files changed, +/− totals, per-language breakdown, and a file
  tree with rolled-up counts, per-file churn bars, filter, and tree/flat views.
- **Diffs**: unified or side-by-side with syntax highlighting, word-level
  change highlights, expandable context, an ignore-whitespace toggle, and
  binary / submodule / rename handling.
- **Dependency map**: the changed files as nodes, import edges between them,
  and their unchanged neighbours faded out, so you can see what a change might
  ripple into. Resolves TypeScript/JavaScript (incl. tsconfig paths), Python,
  Go, and Java/Kotlin imports. Depth 0–2, clustering by directory, click a
  node to jump to its diff.
- **Live updates**: edits, staging, and commits show up without a reload via a
  file watcher and server-sent events.
- **Recent repos**: switch between repositories you have opened before.

### Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | next / previous hunk |
| `n` / `p` | next / previous file |
| `/` | focus the file filter |
| `m` | toggle diff ↔ dependency map |
| shift-click | select a commit range |

## Install

Download a binary from the releases page, or build from source:

```sh
make build            # builds web/dist and bin/void
bin/void [path]       # serve the repo at path (default .)
```

Requires git 2.30+ at runtime. Building needs Go 1.25+, Node 22+ (`nvm use`
picks it up from `.nvmrc`), and pnpm.

### Inside a dev container

The binary is static, so copy it in (or build it there) and bind all
interfaces, then forward the port to the host:

```sh
void -host 0.0.0.0 -port 4000 /workspaces/app
# then open http://localhost:4000 on the host
```

Flags: `-host`, `-port` (0 picks a free port), `-open` (launch the browser),
`-no-watch` (disable live updates), `-version`.

Preferences (theme, layout choices) live in the browser; the recent-repos list
is stored in `~/.config/void/config.json` (override with `VOID_CONFIG_DIR`).

## Develop

```sh
make dev              # Go API on :4000 + Vite on :5173 with live reload
make test             # Go (race) + frontend unit tests
make e2e              # Playwright against the real binary and the fixture repo
make lint
make verify           # build and smoke-test the binary against the fixture
make perf             # first-page history latency on a generated 10k-commit repo
make fixture          # builds testdata/mkrepo.sh into tmp/fixture for poking
```

## Layout

```
cmd/void          CLI entry point
internal/git      read-only wrapper over the git binary (log, refs, diff, status)
internal/deps     import indexer + per-language resolvers, dependency graph
internal/watch    fsnotify watcher with polling fallback, event bus
internal/config   recent-repos persistence
internal/api      JSON API, SSE, embedded SPA
testdata/         mkrepo.sh builds the deterministic fixture repo
web/              Vite + React frontend (embedded into the binary from web/dist)
```

void never runs a git command that modifies your repository.
