package watch

import (
	"bytes"
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Options tunes a Watcher.
type Options struct {
	// Debounce is how long to wait after the last raw event before publishing.
	Debounce time.Duration
	// MaxDirs caps the number of watched directories; above it the watcher
	// polls instead. Zero derives a cap from the open-file limit.
	MaxDirs int
	// PollInterval is the fallback cadence when not using fsnotify.
	PollInterval time.Duration
}

func (o Options) withDefaults() Options {
	if o.Debounce == 0 {
		o.Debounce = 250 * time.Millisecond
	}
	if o.PollInterval == 0 {
		o.PollInterval = 2 * time.Second
	}
	if o.MaxDirs == 0 {
		o.MaxDirs = dirBudget()
	}
	return o
}

// Watcher watches one worktree plus its git dir.
type Watcher struct {
	root, gitDir, commonDir string
	bus                     *Bus
	opts                    Options
	fsw                     *fsnotify.Watcher
	mu                      sync.Mutex
	dirs                    map[string]bool
	polling                 atomic.Bool
}

// New prepares a Watcher; call Run to start it.
func New(root, gitDir, commonDir string, bus *Bus, opts Options) *Watcher {
	return &Watcher{root: filepath.Clean(root), gitDir: filepath.Clean(gitDir), commonDir: filepath.Clean(commonDir),
		bus: bus, opts: opts.withDefaults(), dirs: map[string]bool{}}
}

// Polling reports whether the watcher fell back to polling.
func (w *Watcher) Polling() bool { return w.polling.Load() }

// Watching reports whether dir is under fsnotify observation.
func (w *Watcher) Watching(dir string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.dirs[dir]
}

func (w *Watcher) addDir(dir string) error {
	if err := w.fsw.Add(dir); err != nil {
		return err
	}
	w.mu.Lock()
	w.dirs[dir] = true
	w.mu.Unlock()
	return nil
}

func (w *Watcher) dirCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.dirs)
}

// Run watches until ctx is cancelled.
func (w *Watcher) Run(ctx context.Context) error {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		w.polling.Store(true)
	} else {
		w.fsw = fsw
		defer func() { _ = fsw.Close() }()
		if err := w.addAll(ctx); err != nil {
			log.Printf("watch %s: %v; falling back to polling", w.root, err)
			w.polling.Store(true)
		}
	}
	if w.polling.Load() {
		return w.poll(ctx)
	}

	var (
		pending  = map[Kind]bool{}
		timer    *time.Timer
		timerC   <-chan time.Time
		deadline time.Time
	)
	arm := func() {
		if timer == nil {
			timer = time.NewTimer(w.opts.Debounce)
			timerC = timer.C
			deadline = time.Now().Add(4 * w.opts.Debounce)
			return
		}
		if time.Now().Before(deadline) {
			timer.Reset(w.opts.Debounce)
		}
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case ev, ok := <-fsw.Events:
			if !ok {
				return nil
			}
			kind, relevant := w.classify(ev)
			if !relevant {
				continue
			}
			if kind == KindWorktree && ev.Has(fsnotify.Create) {
				w.maybeAddDir(ctx, ev.Name)
			}
			pending[kind] = true
			arm()
		case err, ok := <-fsw.Errors:
			if !ok {
				return nil
			}
			log.Printf("watch %s: %v", w.root, err)
		case <-timerC:
			for k := range pending {
				w.bus.Publish(Event{Worktree: w.root, Kind: k})
			}
			pending = map[Kind]bool{}
			timer, timerC = nil, nil
		}
	}
}

// classify maps a raw event to a Kind, or reports it as noise.
func (w *Watcher) classify(ev fsnotify.Event) (Kind, bool) {
	name := ev.Name
	base := filepath.Base(name)
	if strings.HasSuffix(base, ".lock") || strings.HasSuffix(base, ".swp") || strings.HasSuffix(base, "~") || base == ".DS_Store" {
		return "", false
	}
	if ev.Op&(fsnotify.Chmod) == ev.Op {
		return "", false
	}
	if within(name, w.gitDir) || within(name, w.commonDir) {
		return KindRefs, true
	}
	if within(name, w.root) {
		return KindWorktree, true
	}
	return "", false
}

func within(p, dir string) bool {
	return p == dir || strings.HasPrefix(p, dir+string(filepath.Separator))
}

// addAll registers the worktree's non-ignored directories and the git dirs.
func (w *Watcher) addAll(ctx context.Context) error {
	for _, d := range w.gitDirs() {
		if err := w.fsw.Add(d); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	dirs, err := w.worktreeDirs(ctx)
	if err != nil {
		return err
	}
	if len(dirs) > w.opts.MaxDirs {
		return &tooManyDirs{n: len(dirs), max: w.opts.MaxDirs}
	}
	for _, d := range dirs {
		if err := w.addDir(d); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
	}
	return nil
}

type tooManyDirs struct{ n, max int }

func (e *tooManyDirs) Error() string {
	return "too many directories to watch (" + itoa(e.n) + " > " + itoa(e.max) + ")"
}

// gitDirs lists the git-internal locations whose changes mean refs/index moved.
func (w *Watcher) gitDirs() []string {
	set := map[string]bool{w.gitDir: true, w.commonDir: true}
	_ = filepath.WalkDir(filepath.Join(w.commonDir, "refs"), func(p string, d os.DirEntry, err error) error {
		if err == nil && d.IsDir() {
			set[p] = true
		}
		return nil
	})
	if w.gitDir != w.commonDir {
		_ = filepath.WalkDir(filepath.Join(w.gitDir, "refs"), func(p string, d os.DirEntry, err error) error {
			if err == nil && d.IsDir() {
				set[p] = true
			}
			return nil
		})
	}
	out := make([]string, 0, len(set))
	for d := range set {
		out = append(out, d)
	}
	return out
}

// worktreeDirs derives the directory set from tracked and untracked
// (non-ignored) files, so ignored trees like node_modules cost nothing.
func (w *Watcher) worktreeDirs(ctx context.Context) ([]string, error) {
	cmd := exec.CommandContext(ctx, "git", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	cmd.Dir = w.root
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	set := map[string]bool{w.root: true}
	for _, p := range bytes.Split(out, []byte{0}) {
		if len(p) == 0 {
			continue
		}
		dir := filepath.Dir(string(p))
		for dir != "." && dir != "/" {
			abs := filepath.Join(w.root, dir)
			if set[abs] {
				break
			}
			set[abs] = true
			dir = filepath.Dir(dir)
		}
	}
	dirs := make([]string, 0, len(set))
	for d := range set {
		dirs = append(dirs, d)
	}
	return dirs, nil
}

// maybeAddDir starts watching a newly created directory unless git ignores it.
func (w *Watcher) maybeAddDir(ctx context.Context, p string) {
	st, err := os.Stat(p)
	if err != nil || !st.IsDir() || w.Watching(p) || within(p, w.gitDir) || within(p, w.commonDir) {
		return
	}
	if w.dirCount() >= w.opts.MaxDirs {
		return
	}
	rel, err := filepath.Rel(w.root, p)
	if err != nil {
		return
	}
	check := exec.CommandContext(ctx, "git", "check-ignore", "-q", "--", rel)
	check.Dir = w.root
	if check.Run() == nil { // exit 0 => ignored
		return
	}
	_ = w.addDir(p)
	// Files may already exist inside a directory created and populated quickly.
	_ = filepath.WalkDir(p, func(sub string, d os.DirEntry, err error) error {
		if err == nil && d.IsDir() && sub != p && !w.Watching(sub) && w.dirCount() < w.opts.MaxDirs {
			_ = w.addDir(sub)
		}
		return nil
	})
}

// poll is the fallback: publish a worktree event whenever `git status` output
// changes and a refs event whenever HEAD or the ref list changes.
func (w *Watcher) poll(ctx context.Context) error {
	t := time.NewTicker(w.opts.PollInterval)
	defer t.Stop()
	var lastStatus, lastRefs []byte
	first := true
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
		status := w.git(ctx, "status", "--porcelain=v2", "-z", "--untracked-files=normal")
		refs := append(w.git(ctx, "rev-parse", "HEAD"), w.git(ctx, "for-each-ref")...)
		if !first {
			if !bytes.Equal(status, lastStatus) {
				w.bus.Publish(Event{Worktree: w.root, Kind: KindWorktree})
			}
			if !bytes.Equal(refs, lastRefs) {
				w.bus.Publish(Event{Worktree: w.root, Kind: KindRefs})
			}
		}
		lastStatus, lastRefs, first = status, refs, false
	}
}

func (w *Watcher) git(ctx context.Context, args ...string) []byte {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = w.root
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	out, _ := cmd.Output()
	return out
}

// dirBudget leaves headroom under the process's open-file limit.
func dirBudget() int {
	var rl syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &rl); err != nil || rl.Cur == 0 {
		return 2000
	}
	budget := int(rl.Cur/2) - 128
	if budget < 64 {
		return 64
	}
	if budget > 20000 {
		return 20000
	}
	return budget
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
