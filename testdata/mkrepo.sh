#!/usr/bin/env bash
# Builds the deterministic integration fixture used by Go golden tests and Playwright.
# Layout under <dest>:
#   sub/         standalone repo used as a submodule source
#   repo/        main fixture repo (branches main, feature, topic; tag v0.1.0; merge commit)
#   wt-feature/  linked worktree checked out at 'feature'
# repo/ is left with a staged edit, an unstaged edit, and an untracked file.
set -euo pipefail
dest="${1:?usage: mkrepo.sh <dest-dir>}"
mkdir -p "$dest"
dest="$(cd "$dest" && pwd -P)"

export GIT_AUTHOR_NAME="Fixture Author" GIT_AUTHOR_EMAIL="author@example.com"
export GIT_COMMITTER_NAME="Fixture Committer" GIT_COMMITTER_EMAIL="committer@example.com"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
ts=1700000000
commit() {
  GIT_AUTHOR_DATE="@$ts +0000" GIT_COMMITTER_DATE="@$ts +0000" git commit -q --allow-empty -m "$1"
  ts=$((ts + 60))
}

# --- submodule source ---------------------------------------------------------
git init -q -b main "$dest/sub"
( cd "$dest/sub" && echo "sub v1" > sub.txt && git add -A && commit "sub: initial" )

# --- main repo ----------------------------------------------------------------
git init -q -b main "$dest/repo"
cd "$dest/repo"

mkdir -p src lib
cat > README.md <<'MD'
# fixture
A small repo for exercising void.
MD
cat > src/app.ts <<'TS'
import { greet } from "./util";
export function main(): string {
  return greet("world");
}
TS
cat > src/util.ts <<'TS'
export function greet(name: string): string {
  return `hello ${name}`;
}
TS
cat > lib/helper.py <<'PY'
def helper():
    return 42
PY
git add -A && commit "c1: initial project"

cat >> src/app.ts <<'TS'
export const VERSION = "0.1";
TS
mkdir -p assets
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01' > assets/logo.png
git add -A && commit "c2: add version constant and logo"

git mv src/util.ts src/utils.ts
sed -i.bak 's/hello/hi/' src/utils.ts && rm src/utils.ts.bak
sed -i.bak 's#./util"#./utils"#' src/app.ts && rm src/app.ts.bak
git rm -q lib/helper.py
echo "spaces are fine" > "name with spaces.txt"
echo "naïve résumé" > "unicodé.txt"
git add -A && commit "c3: rename util, drop python helper, odd filenames"
git tag -a v0.1.0 -m "v0.1.0"

git -c protocol.file.allow=always submodule add -q "$dest/sub" vendor/sub
git add -A && commit "c4: add submodule"

# topic branch merged into main with a merge commit (exercises lanes)
git checkout -q -b topic HEAD~1 2>/dev/null
echo "topic work" > topic.txt
git add topic.txt && commit "t1: topic work"
git checkout -q main
GIT_AUTHOR_DATE="@$ts +0000" GIT_COMMITTER_DATE="@$ts +0000" git merge -q --no-ff -m "m1: merge topic" topic
ts=$((ts + 60))

# feature branch from c2, left unmerged (exercises ranges / branch-vs-base)
git checkout -q -b feature main~3 2>/dev/null
cat > src/feature.ts <<'TS'
import { main } from "./app";
export const featureOutput = main().toUpperCase();
TS
git add src/feature.ts && commit "f1: add feature module"
echo "Feature docs." >> README.md
git add README.md && commit "f2: document feature"
git checkout -q main

# linked worktree at feature
git worktree add -q "$dest/wt-feature" feature

# dirty working tree in repo/
echo "Staged line." >> README.md
git add README.md
echo "// unstaged edit" >> src/app.ts
echo "scratch" > notes.txt
