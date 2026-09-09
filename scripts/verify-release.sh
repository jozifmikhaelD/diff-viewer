#!/usr/bin/env bash
# Smoke-tests a built binary against the fixture repo: it must serve the
# frontend, answer the API, and shut down cleanly.
set -euo pipefail
bin="${1:-bin/void}"
root="$(cd "$(dirname "$0")/.." && pwd)"
[ -x "$bin" ] || { echo "binary not found: $bin (run make build)"; exit 1; }

fixture="$(mktemp -d "${TMPDIR:-/tmp}/void-verify.XXXXXX")"
port="${PORT:-4199}"
cleanup() { [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true; rm -rf "$fixture"; }
trap cleanup EXIT

bash "$root/testdata/mkrepo.sh" "$fixture" >/dev/null
export VOID_CONFIG_DIR="$fixture/config"
"$bin" -version
"$bin" -host 127.0.0.1 -port "$port" "$fixture/repo" >"$fixture/void.log" 2>&1 &
pid=$!

for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break
  sleep 0.1
done

fail=0
check() { # description, url, grep pattern
  if curl -sf "http://127.0.0.1:$port$2" | grep -q -- "$3"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
check "health"            "/api/health"                        '"ok":true'
check "repo + worktrees"  "/api/repo"                          '"branch":"feature"'
check "history"           "/api/log?limit=3"                   '"subject"'
check "changeset"         "/api/changeset?commit=v0.1.0"       '"files":5'
check "diff"              "/api/diff?commit=v0.1.0&path=src/app.ts" '"hunks"'
check "deps"              "/api/deps?commit=v0.1.0"            '"nodes"'
check "frontend embedded" "/"                                  '<title>void</title>'
check "spa fallback"      "/some/client/route"                 '<title>void</title>'

kill "$pid"; wait "$pid" 2>/dev/null || true
pid=""
grep -q "url:" "$fixture/void.log" || { echo "FAIL startup banner"; fail=1; }
[ "$fail" -eq 0 ] && echo "release binary verified" || { cat "$fixture/void.log"; exit 1; }
