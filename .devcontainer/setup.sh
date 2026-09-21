#!/usr/bin/env bash
# Runs once when the devcontainer is created: installs every dependency so
# `make dev`, `make test`, `make lint`, `make e2e`, and `make build` work.
set -euo pipefail
cd "$(dirname "$0")/.."

# web/node_modules is a named volume (see devcontainer.json) so Linux binaries
# never collide with a host install; make it writable by the container user.
sudo chown "$(id -u):$(id -g)" web/node_modules
(cd web && CI=true pnpm install --frozen-lockfile)
(cd web && pnpm e2e:install)               # Chromium for Playwright
go mod download
GOFLAGS=-mod=mod go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.6.0 version >/dev/null  # warm the lint cache
echo "devcontainer ready: run 'make dev' (started automatically) and open http://localhost:5173"
