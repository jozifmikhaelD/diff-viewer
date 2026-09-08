// Package testutil builds the shared integration fixture repository.
package testutil

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// Fixture builds testdata/mkrepo.sh into a temp dir and returns the base
// directory. The main repo is at <base>/repo and the linked worktree at
// <base>/wt-feature. The directory is removed when the test finishes.
func Fixture(t testing.TB) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate testutil source file")
	}
	script := filepath.Join(filepath.Dir(file), "..", "..", "testdata", "mkrepo.sh")
	dir := t.TempDir()
	// t.TempDir may be a symlinked path on macOS; git reports the resolved
	// path, so resolve up front to keep comparisons simple.
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatalf("resolve temp dir: %v", err)
	}
	out, err := exec.Command("bash", script, resolved).CombinedOutput()
	if err != nil {
		t.Fatalf("mkrepo.sh failed: %v\n%s", err, out)
	}
	return resolved
}

// FixtureRepo is Fixture's main repository path.
func FixtureRepo(t testing.TB) string {
	t.Helper()
	return filepath.Join(Fixture(t), "repo")
}
