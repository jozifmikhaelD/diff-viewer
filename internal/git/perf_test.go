package git

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestLogFirstPageLatency guards the "first paint < 1s" goal on a generated
// 10k-commit repository. It runs only with VOID_PERF=1 (make perf).
func TestLogFirstPageLatency(t *testing.T) {
	if os.Getenv("VOID_PERF") == "" {
		t.Skip("set VOID_PERF=1 to run")
	}
	dir := t.TempDir()
	if out, err := exec.Command("git", "init", "-q", "-b", "main", dir).CombinedOutput(); err != nil {
		t.Fatalf("init: %v %s", err, out)
	}
	const n = 10000
	var b strings.Builder
	mark := 1
	prev := 0
	for i := 0; i < n; i++ {
		content := fmt.Sprintf("line %d\n", i)
		fmt.Fprintf(&b, "blob\nmark :%d\ndata %d\n%s\n", mark, len(content), content)
		blob := mark
		mark++
		msg := fmt.Sprintf("commit %d", i)
		fmt.Fprintf(&b, "commit refs/heads/main\nmark :%d\nauthor A <a@x> %d +0000\ncommitter A <a@x> %d +0000\ndata %d\n%s\n",
			mark, 1600000000+i*60, 1600000000+i*60, len(msg), msg)
		if prev != 0 {
			fmt.Fprintf(&b, "from :%d\n", prev)
		}
		fmt.Fprintf(&b, "M 100644 :%d file%d.txt\n\n", blob, i%50)
		prev = mark
		mark++
	}
	imp := exec.Command("git", "fast-import", "--quiet")
	imp.Dir = dir
	imp.Stdin = strings.NewReader(b.String())
	if out, err := imp.CombinedOutput(); err != nil {
		t.Fatalf("fast-import: %v %s", err, out)
	}
	reset := exec.Command("git", "reset", "-q", "--hard")
	reset.Dir = dir
	if out, err := reset.CombinedOutput(); err != nil {
		t.Fatalf("reset: %v %s", err, out)
	}

	repo, err := Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	// warm the object store once, then measure
	if _, _, err := repo.Log(context.Background(), LogOptions{Limit: 10}); err != nil {
		t.Fatal(err)
	}
	const budget = 1000 * time.Millisecond
	for _, skip := range []int{0, 5000} {
		start := time.Now()
		commits, more, err := repo.Log(context.Background(), LogOptions{Limit: 200, Skip: skip})
		el := time.Since(start)
		if err != nil || len(commits) != 200 || !more {
			t.Fatalf("skip %d: %d commits, more=%v, err=%v", skip, len(commits), more, err)
		}
		t.Logf("log skip=%d: %v", skip, el)
		if el > budget {
			t.Errorf("skip %d took %v, budget %v", skip, el, budget)
		}
	}
	start := time.Now()
	if _, err := repo.Worktrees(context.Background()); err != nil {
		t.Fatal(err)
	}
	if st, err := repo.Status(context.Background()); err != nil || !st.Clean() {
		t.Fatalf("status: %+v %v", st, err)
	}
	t.Logf("repo+status: %v", time.Since(start))
}
