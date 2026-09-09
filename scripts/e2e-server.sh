#!/usr/bin/env bash
# Starts void against a freshly built fixture repo for Playwright.
# Assumes the frontend has been built (make web) so the binary serves real assets.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/void-e2e.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
bash "$root/testdata/mkrepo.sh" "$fixture" >/dev/null
cd "$root"
# Keep test runs out of the user's real recent-repos list.
export VOID_CONFIG_DIR="$fixture/config"
exec go run ./cmd/void -host 127.0.0.1 -port 4173 "$fixture/repo"
