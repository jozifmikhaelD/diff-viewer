# void

A local web app for reading git changes. Point it at any repository, click a
commit, and see what changed, how much, and how the changed files connect.

```sh
void .                # serve the repo in the current directory
void -open ~/src/app  # serve another repo and open the browser
```

## What it does

- **History** with a commit graph, branch and tag badges, a worktree switcher,
  and a search box (`author:name`, a SHA, `branch:name`).
- **Pick anything**: a commit, a shift-click range, "branch vs main", or the
  uncommitted working tree (all, staged, unstaged, untracked).
- **Summary**: files changed, lines added and removed, a language breakdown,
  and a file tree you can filter.
- **Diffs**: unified or side-by-side, syntax highlighted, with word-level
  highlights and expandable context. Double-click a file to read the whole
  file with inline git blame on the line you hover.
- **Map**: the changed files and the files they import, as a graph.
- **Flow**: the same files laid out left to right by import direction, with
  a "Copy as Mermaid" button for PR descriptions.
- **Live**: edits, staging, and commits show up without a reload.
- **Open…** switches to another repository; recent ones are remembered.

Works with any repo, inside dev containers, and across worktrees. It never
runs a git command that modifies your repository.

## Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | next / previous hunk |
| `n` / `p` | next / previous file |
| `/` | focus the file filter |
| `m` | toggle the map |
| `f` | toggle the flow diagram |
| `?` | show this list |
| shift-click | select a commit range |

## Install

Download a binary from the releases page, or build it yourself:

```sh
make build        # needs Go 1.25+, Node 22+ (nvm use), pnpm
bin/void [path]
```

Needs git 2.30 or newer at runtime.

Inside a dev container, bind all interfaces and forward the port:

```sh
void -host 0.0.0.0 -port 4000 /workspaces/app
```

Flags: `-host`, `-port` (0 picks a free port), `-open`, `-no-watch`, `-version`.
Recent repositories are stored in `~/.config/void/config.json`.

## Develop

```sh
make dev      # Go API on :4000 and Vite on :5173 with live reload
make test     # Go and frontend unit tests
make e2e      # Playwright against the real binary
make verify   # build and smoke-test the binary
```

The design and milestone history are in [docs/plan.md](docs/plan.md).

## Layout

```
cmd/void          CLI
internal/git      read-only wrapper over the git binary
internal/deps     import indexer and dependency graph
internal/watch    file watcher and event bus
internal/config   recent repositories
internal/api      JSON API, server-sent events, embedded frontend
web/              React frontend, embedded into the binary
```

MIT licensed.
