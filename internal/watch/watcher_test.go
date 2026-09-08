package watch

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"void/internal/git"
	"void/internal/testutil"
)

func startWatcher(t *testing.T, root string, opts Options) (<-chan Event, *Watcher) {
	t.Helper()
	repo, err := git.Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	bus := NewBus()
	events, unsub := bus.Subscribe()
	t.Cleanup(unsub)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	w := New(repo.Root, repo.GitDir, repo.CommonDir, bus, opts)
	go func() { _ = w.Run(ctx) }()
	time.Sleep(150 * time.Millisecond) // let watches register
	return events, w
}

func expectEvent(t *testing.T, events <-chan Event, kind Kind, within time.Duration) {
	t.Helper()
	deadline := time.After(within)
	for {
		select {
		case e := <-events:
			if e.Kind == kind {
				return
			}
		case <-deadline:
			t.Fatalf("no %s event within %v", kind, within)
		}
	}
}

func expectQuiet(t *testing.T, events <-chan Event, within time.Duration) {
	t.Helper()
	select {
	case e := <-events:
		t.Fatalf("unexpected event %+v", e)
	case <-time.After(within):
	}
}

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@x", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@x")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestBus(t *testing.T) {
	b := NewBus()
	ch, unsub := b.Subscribe()
	b.Publish(Event{Worktree: "x", Kind: KindRefs})
	if e := <-ch; e.Kind != KindRefs {
		t.Fatalf("got %+v", e)
	}
	for i := 0; i < 40; i++ { // must not block when the subscriber is slow
		b.Publish(Event{Kind: KindWorktree})
	}
	unsub()
	unsub() // idempotent
	if b.Subscribers() != 0 {
		t.Fatal("subscriber not removed")
	}
}

func TestWatcherFileAndRefEvents(t *testing.T) {
	base := testutil.Fixture(t)
	root := filepath.Join(base, "repo")
	events, w := startWatcher(t, root, Options{Debounce: 50 * time.Millisecond})
	if w.Polling() {
		t.Skip("fsnotify unavailable; polling covered separately")
	}

	// edit a tracked file -> worktree event
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectEvent(t, events, KindWorktree, 2*time.Second)

	// stage + commit -> refs events (index and HEAD)
	gitIn(t, root, "add", "README.md")
	expectEvent(t, events, KindRefs, 2*time.Second)
	gitIn(t, root, "commit", "-q", "-m", "x")
	expectEvent(t, events, KindRefs, 2*time.Second)

	// new directory with a file inside -> watched dynamically
	dir := filepath.Join(root, "newdir")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	expectEvent(t, events, KindWorktree, 2*time.Second)
	time.Sleep(100 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectEvent(t, events, KindWorktree, 2*time.Second)
}

func TestWatcherIgnoresNoise(t *testing.T) {
	base := testutil.Fixture(t)
	root := filepath.Join(base, "repo")
	events, w := startWatcher(t, root, Options{Debounce: 50 * time.Millisecond})
	if w.Polling() {
		t.Skip("fsnotify unavailable")
	}
	// lock files and editor swap files are noise
	for _, name := range []string{filepath.Join(root, ".git", "index.lock"), filepath.Join(root, ".git", "HEAD.lock"), filepath.Join(root, "x.swp"), filepath.Join(root, "y~")} {
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	expectQuiet(t, events, 400*time.Millisecond)
	// objects are not watched at all
	objDir := filepath.Join(root, ".git", "objects", "zz")
	if err := os.MkdirAll(objDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(objDir, "blob"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectQuiet(t, events, 400*time.Millisecond)
}

func TestWatcherIgnoredDirectoriesAreNotWatched(t *testing.T) {
	base := testutil.Fixture(t)
	root := filepath.Join(base, "repo")
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("ignored/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "ignored"), 0o755); err != nil {
		t.Fatal(err)
	}
	events, w := startWatcher(t, root, Options{Debounce: 50 * time.Millisecond})
	if w.Polling() {
		t.Skip("fsnotify unavailable")
	}
	if err := os.WriteFile(filepath.Join(root, "ignored", "junk.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectQuiet(t, events, 400*time.Millisecond)
	if w.Watching(filepath.Join(root, "ignored")) {
		t.Error("ignored dir is watched")
	}
}

func TestWatcherDebouncesBursts(t *testing.T) {
	base := testutil.Fixture(t)
	root := filepath.Join(base, "repo")
	events, w := startWatcher(t, root, Options{Debounce: 100 * time.Millisecond})
	if w.Polling() {
		t.Skip("fsnotify unavailable")
	}
	for i := 0; i < 20; i++ {
		if err := os.WriteFile(filepath.Join(root, "burst.txt"), []byte{byte(i)}, 0o644); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	expectEvent(t, events, KindWorktree, 2*time.Second)
	expectQuiet(t, events, 300*time.Millisecond)
}

func TestWatcherPollingFallback(t *testing.T) {
	base := testutil.Fixture(t)
	root := filepath.Join(base, "repo")
	events, w := startWatcher(t, root, Options{Debounce: 50 * time.Millisecond, MaxDirs: 1, PollInterval: 100 * time.Millisecond})
	if !w.Polling() {
		t.Fatal("expected polling fallback with MaxDirs=1")
	}
	time.Sleep(150 * time.Millisecond) // first poll establishes the baseline
	if err := os.WriteFile(filepath.Join(root, "polled.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	expectEvent(t, events, KindWorktree, 2*time.Second)
	gitIn(t, root, "add", "polled.txt")
	gitIn(t, root, "commit", "-q", "-m", "p")
	expectEvent(t, events, KindRefs, 2*time.Second)
}

func TestLinkedWorktreeRefsAreWatched(t *testing.T) {
	base := testutil.Fixture(t)
	wt := filepath.Join(base, "wt-feature")
	events, w := startWatcher(t, wt, Options{Debounce: 50 * time.Millisecond})
	if w.Polling() {
		t.Skip("fsnotify unavailable")
	}
	gitIn(t, wt, "commit", "-q", "--allow-empty", "-m", "empty")
	expectEvent(t, events, KindRefs, 2*time.Second)
}
