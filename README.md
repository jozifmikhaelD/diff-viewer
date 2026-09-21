# diff-viewer (`void`)

A local web app for reading git changes. Point it at any repository, click a
commit, and see what changed, how much, and how the changed files connect.

```sh
void .                # serve the repo in the current directory
void -open ~/src/app  # serve another repo and open the browser
```

Everything runs on your machine. It never runs a git command that modifies
your repository.

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

Works with any repo, inside dev containers, and across worktrees.

## Install

You need **git 2.30 or newer** on your PATH. macOS and Linux are supported;
Windows is not yet.

### Option 1: one line

```sh
curl -fsSL https://raw.githubusercontent.com/jozifmikhaelD/diff-viewer/main/install.sh | sh
```

This downloads the latest release for your platform, verifies its checksum,
and installs `void` into `/usr/local/bin` (or `~/.local/bin` if that is not
writable). Set `VOID_VERSION=v0.1.0` to pin a version or `VOID_INSTALL_DIR`
to choose the directory. Then:

```sh
cd ~/src/some-repo
void -open .
```

### Option 2: download a binary yourself

Grab the archive for your platform from the
[releases page](https://github.com/jozifmikhaelD/diff-viewer/releases),
unpack it, and put `void` somewhere on your PATH:

```sh
tar -xzf void_*_darwin_arm64.tar.gz
mv void /usr/local/bin/
void -version
```

On macOS the first run may be blocked by Gatekeeper. Allow it with:

```sh
xattr -d com.apple.quarantine /usr/local/bin/void
```

### Option 3: build from source

Requirements:

| Tool | Version | Notes |
| --- | --- | --- |
| Go | 1.25+ | https://go.dev/dl |
| Node | 22+ | `nvm use` picks it up from `.nvmrc` |
| pnpm | 10 | `corepack enable` installs the pinned version automatically |

```sh
git clone git@github.com:jozifmikhaelD/diff-viewer.git
cd diff-viewer
corepack enable        # once per machine; makes pnpm available
make build             # builds the frontend and the Go binary
bin/void .             # run it against this repo
```

`make build` produces a single self-contained binary at `bin/void` with the
frontend embedded. Copy it anywhere on your PATH.

If `pnpm` is not found after `corepack enable`, install it directly with
`npm install -g pnpm@10` and try again.

## Use

```sh
void [flags] [path]
```

| Flag | Meaning |
| --- | --- |
| `-open` | open the browser after starting |
| `-port N` | listen on port N (default 4000, `0` picks a free port) |
| `-host H` | bind address (default `127.0.0.1`) |
| `-no-watch` | do not watch the repository for changes |
| `-version` | print the version and exit |

Inside a dev container, bind all interfaces and forward the port:

```sh
void -host 0.0.0.0 -port 4000 /workspaces/app
```

Recent repositories are stored in `~/.config/void/config.json`.

### Keyboard

| Key | Action |
| --- | --- |
| `j` / `k` | next / previous hunk |
| `n` / `p` | next / previous file |
| `/` | focus the file filter |
| `m` | toggle the map |
| `f` | toggle the flow diagram |
| `?` | show this list |
| shift-click | select a commit range |

## Develop

### Option A: dev container (nothing to install but Docker)

1. Install [Docker](https://docs.docker.com/get-docker/) and VS Code with the
   [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
   extension.
2. Clone the repo, open the folder in VS Code, and choose **Reopen in
   Container** when prompted.
3. Wait for the first build. It installs Go, Node, pnpm, Chromium, and every
   dependency, then starts `make dev` automatically.
4. VS Code opens http://localhost:5173 when the server is up. Every `make`
   target below works inside the container. The dev server's output is in
   `/tmp/dev.log`; `tail -f /tmp/dev.log` follows it.

From a terminal without VS Code:

```sh
npx @devcontainers/cli up --workspace-folder .
npx @devcontainers/cli exec --workspace-folder . make test
```

### Option B: on your machine

Same requirements as building from source. Then:

```sh
make dev       # Go API on :4000 and Vite on :5173 with live reload
make test      # Go and frontend unit tests
make lint      # go vet, golangci-lint, oxlint, tsc
make e2e       # Playwright against the real binary and a fixture repo
make verify    # build the binary and smoke-test it
make help      # list every target
```

Open http://localhost:5173 while `make dev` is running; Vite proxies `/api`
to the Go server. `make dev` serves this repository by default; pass
`REPO=/path/to/other` to serve another one.

The first `make e2e` needs a browser: run `cd web && pnpm e2e:install` once.

golangci-lint is optional locally. Install it with
`brew install golangci-lint` or run the pinned version without installing:

```sh
go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.6.0 run ./...
```

### Releasing

Push a tag and CI builds the archives and publishes a GitHub release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

### Layout

```
cmd/void          CLI
internal/git      read-only wrapper over the git binary
internal/deps     import indexer and dependency graph
internal/watch    file watcher and event bus
internal/config   recent repositories
internal/api      JSON API, server-sent events, embedded frontend
web/              React frontend, embedded into the binary
```
