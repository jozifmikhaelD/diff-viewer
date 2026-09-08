# void

See every change in a git repository at a glance: pick a commit, a range, or the
working tree and get totals, the file list, readable diffs, and a dependency map
of the changed files. Works with any repo, inside dev containers, and across
worktrees.

Status: **M1 (repo + history)**: worktree switcher, paged commit history with graph lanes, working-tree badges. Changeset views land in M2. See [docs/plan.md](docs/plan.md) for the press release,
requirements, and milestone breakdown.

## Run

```sh
make build            # builds web/dist and bin/void
bin/void [path]       # serve the repo at path (default .)
bin/void -open .      # also open the browser
```

Inside a dev container, bind all interfaces and forward the port:

```sh
bin/void -host 0.0.0.0 -port 4000 .
```

## Develop

```sh
make dev              # Go API on :4000 + Vite on :5173 with live reload
make test             # Go (race) + frontend unit tests
make e2e              # Playwright against the real binary and the fixture repo
make lint
make fixture          # builds testdata/mkrepo.sh into tmp/fixture for poking
```

Requires Go 1.25+, Node 22+ (`nvm use` picks it up from `.nvmrc`), pnpm, and git 2.30+.

## Layout

```
cmd/void          CLI entry point
internal/git      read-only wrapper over the git binary
internal/api      JSON API + embedded SPA
internal/testutil fixture repo helper for tests
testdata/         mkrepo.sh builds the deterministic fixture repo
web/              Vite + React frontend (embedded into the binary from web/dist)
```
