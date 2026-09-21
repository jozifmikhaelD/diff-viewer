package git

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jozifmikhaelD/diff-viewer/internal/testutil"
)

func TestOpenMainRepo(t *testing.T) {
	base := testutil.Fixture(t)
	for _, from := range []string{"", "src", "assets"} {
		t.Run("from "+from, func(t *testing.T) {
			checkMainRepo(t, base, filepath.Join(base, "repo", from))
		})
	}
}

func checkMainRepo(t *testing.T, base, from string) {
	t.Helper()
	repo, err := Open(context.Background(), from)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(base, "repo"); repo.Root != want {
		t.Errorf("Root = %q, want %q", repo.Root, want)
	}
	if want := filepath.Join(base, "repo", ".git"); repo.GitDir != want {
		t.Errorf("GitDir = %q, want %q", repo.GitDir, want)
	}
	if repo.CommonDir != repo.GitDir {
		t.Errorf("CommonDir = %q, want same as GitDir %q", repo.CommonDir, repo.GitDir)
	}
	if repo.IsLinkedWorktree() {
		t.Error("main repo reported as linked worktree")
	}
}

func TestOpenLinkedWorktree(t *testing.T) {
	base := testutil.Fixture(t)
	repo, err := Open(context.Background(), filepath.Join(base, "wt-feature"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(base, "wt-feature"); repo.Root != want {
		t.Errorf("Root = %q, want %q", repo.Root, want)
	}
	if want := filepath.Join(base, "repo", ".git"); repo.CommonDir != want {
		t.Errorf("CommonDir = %q, want %q", repo.CommonDir, want)
	}
	if !strings.HasPrefix(repo.GitDir, filepath.Join(base, "repo", ".git", "worktrees")) {
		t.Errorf("GitDir = %q, want under main .git/worktrees", repo.GitDir)
	}
	if !repo.IsLinkedWorktree() {
		t.Error("linked worktree not detected")
	}
}

func TestOpenNotRepo(t *testing.T) {
	_, err := Open(context.Background(), t.TempDir())
	if !errors.Is(err, ErrNotRepo) {
		t.Fatalf("err = %v, want ErrNotRepo", err)
	}
}

func TestRunCapturesStderr(t *testing.T) {
	repo, err := Open(context.Background(), testutil.FixtureRepo(t))
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.Run(context.Background(), "rev-parse", "--verify", "does-not-exist")
	var gerr *Error
	if !errors.As(err, &gerr) {
		t.Fatalf("err = %T %v, want *Error", err, err)
	}
	if gerr.Stderr == "" || len(gerr.Args) == 0 {
		t.Errorf("Error missing detail: %+v", gerr)
	}
}

func TestOpenInsideSubmoduleOpensSubmodule(t *testing.T) {
	base := testutil.Fixture(t)
	repo, err := Open(context.Background(), filepath.Join(base, "repo", "vendor", "sub"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(base, "repo", "vendor", "sub"); repo.Root != want {
		t.Errorf("Root = %q, want %q", repo.Root, want)
	}
	if want := filepath.Join(base, "repo", ".git", "modules", "vendor", "sub"); repo.GitDir != want {
		t.Errorf("GitDir = %q, want %q", repo.GitDir, want)
	}
}
