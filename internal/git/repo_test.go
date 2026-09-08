package git

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"void/internal/testutil"
)

func openFixture(t *testing.T) (*Repo, string) {
	t.Helper()
	base := testutil.Fixture(t)
	repo, err := Open(context.Background(), filepath.Join(base, "repo"))
	if err != nil {
		t.Fatal(err)
	}
	return repo, base
}

func TestWorktreesFixture(t *testing.T) {
	repo, base := openFixture(t)
	wts, err := repo.Worktrees(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(wts) != 2 {
		t.Fatalf("got %d worktrees: %+v", len(wts), wts)
	}
	if wts[0].Path != filepath.Join(base, "repo") || !wts[0].Main || wts[0].Branch != "main" {
		t.Errorf("main worktree = %+v", wts[0])
	}
	if wts[1].Path != filepath.Join(base, "wt-feature") || wts[1].Main || wts[1].Branch != "feature" || wts[1].Head == "" {
		t.Errorf("linked worktree = %+v", wts[1])
	}
}

func TestRefsAndDefaultBranchFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()
	if got := repo.DefaultBranch(ctx); got != "main" {
		t.Errorf("DefaultBranch = %q", got)
	}
	refs, err := repo.Refs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	var headCount int
	for _, rs := range refs {
		for _, r := range rs {
			names = append(names, string(r.Kind)+":"+r.Name)
			if r.Head {
				headCount++
			}
		}
	}
	for _, want := range []string{"branch:main", "branch:feature", "branch:topic", "tag:v0.1.0"} {
		found := false
		for _, n := range names {
			found = found || n == want
		}
		if !found {
			t.Errorf("missing ref %s in %v", want, names)
		}
	}
	if headCount != 1 {
		t.Errorf("HEAD marked on %d refs, want 1", headCount)
	}
	// Annotated tag must be peeled to the commit c3 (parent of c4), which is
	// also where 'topic' branched from; ensure the tag sits on a real commit.
	commits, _, err := repo.Log(ctx, LogOptions{Ref: "v0.1.0", Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := refs[commits[0].SHA]; !ok {
		t.Errorf("tag not peeled: refs keyed by %v, tag commit %s", names, commits[0].SHA)
	}
}

func TestStatusFixture(t *testing.T) {
	repo, base := openFixture(t)
	ctx := context.Background()
	st, err := repo.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if want := (WorktreeStatus{Staged: 1, Unstaged: 1, Untracked: 1}); st != want {
		t.Errorf("main status = %+v, want %+v", st, want)
	}
	wt, err := Open(ctx, filepath.Join(base, "wt-feature"))
	if err != nil {
		t.Fatal(err)
	}
	if st, err := wt.Status(ctx); err != nil || !st.Clean() {
		t.Errorf("worktree status = %+v, %v; want clean", st, err)
	}
}

func TestLogFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()

	all, more, err := repo.Log(ctx, LogOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if more || len(all) != 8 {
		t.Fatalf("all: %d commits, more=%v", len(all), more)
	}
	// topo order: every parent appears after its child
	pos := map[string]int{}
	for i, c := range all {
		pos[c.SHA] = i
	}
	for _, c := range all {
		for _, p := range c.Parents {
			if pos[p] <= pos[c.SHA] {
				t.Errorf("parent %s of %s appears before it", p, c.SHA)
			}
		}
	}
	if all[len(all)-1].Subject != "c1: initial project" || len(all[len(all)-1].Parents) != 0 {
		t.Errorf("last commit = %+v", all[len(all)-1])
	}

	page1, more, err := repo.Log(ctx, LogOptions{Limit: 3})
	if err != nil || !more || len(page1) != 3 {
		t.Fatalf("page1: %d, more=%v, err=%v", len(page1), more, err)
	}
	page2, _, err := repo.Log(ctx, LogOptions{Limit: 3, Skip: 3})
	if err != nil || page2[0].SHA != all[3].SHA {
		t.Errorf("paging mismatch: %v / %v", err, page2)
	}

	mainOnly, _, err := repo.Log(ctx, LogOptions{Ref: "main"})
	if err != nil || len(mainOnly) != 6 {
		t.Errorf("main: %d commits, err=%v", len(mainOnly), err)
	}
	var merge *Commit
	for i := range mainOnly {
		if len(mainOnly[i].Parents) == 2 {
			merge = &mainOnly[i]
		}
	}
	if merge == nil || merge.Subject != "m1: merge topic" {
		t.Errorf("merge commit not found in %+v", mainOnly)
	}

	grep, _, err := repo.Log(ctx, LogOptions{Grep: "FEATURE"})
	if err != nil || len(grep) != 2 {
		t.Errorf("grep: %d commits, err=%v", len(grep), err)
	}
	author, _, err := repo.Log(ctx, LogOptions{Author: "nobody"})
	if err != nil || len(author) != 0 {
		t.Errorf("author: %d commits, err=%v", len(author), err)
	}
	if _, _, err := repo.Log(ctx, LogOptions{Ref: "--output=/tmp/x"}); !errors.Is(err, ErrBadRef) {
		t.Errorf("flag-like ref accepted: %v", err)
	}
	if _, _, err := repo.Log(ctx, LogOptions{Ref: "nope"}); err == nil {
		t.Error("unknown ref accepted")
	}
}
