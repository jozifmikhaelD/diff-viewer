// Package git is a thin, read-only wrapper over the system git binary.
// It never runs a command with side effects on the repository.
package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ErrNotRepo is returned by Open when the path is not inside a git repository.
var ErrNotRepo = errors.New("not a git repository")

// DefaultTimeout bounds any single git invocation.
const DefaultTimeout = 30 * time.Second

// Error carries the failing command's arguments and stderr.
type Error struct {
	Args   []string
	Stderr string
	Err    error
}

func (e *Error) Error() string {
	msg := strings.TrimSpace(e.Stderr)
	if msg == "" {
		msg = e.Err.Error()
	}
	return fmt.Sprintf("git %s: %s", strings.Join(e.Args, " "), msg)
}

func (e *Error) Unwrap() error { return e.Err }

// Runner executes git commands in a fixed directory.
type Runner struct {
	Dir     string
	Timeout time.Duration
}

// Run executes `git args...` and returns stdout. Stderr is folded into the error.
func (r Runner) Run(ctx context.Context, args ...string) ([]byte, error) {
	timeout := r.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = r.Dir
	// Keep output stable and machine-parseable regardless of user config.
	cmd.Env = append(cmd.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0",
		"LC_ALL=C",
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		gerr := &Error{Args: args, Stderr: stderr.String(), Err: err}
		if strings.Contains(gerr.Stderr, "not a git repository") {
			gerr.Err = ErrNotRepo
		}
		return nil, gerr
	}
	return stdout.Bytes(), nil
}

// Repo is an opened repository (or linked worktree).
type Repo struct {
	// Root is the top-level directory of the checked-out worktree.
	Root string
	// GitDir is the .git directory for this worktree (a linked worktree's
	// gitdir lives under the main repo's .git/worktrees/<name>).
	GitDir string
	// CommonDir is the shared .git directory of the main repository.
	CommonDir string

	run Runner
}

// Open resolves the repository containing path.
func Open(ctx context.Context, path string) (*Repo, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	out, err := Runner{Dir: abs}.Run(ctx, "rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir")
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(lines) != 3 {
		return nil, fmt.Errorf("git rev-parse: unexpected output %q", out)
	}
	root, gitDir, commonDir := lines[0], lines[1], lines[2]
	// rev-parse prints relative paths relative to the command's cwd (abs).
	if !filepath.IsAbs(commonDir) {
		commonDir = filepath.Join(abs, commonDir)
	}
	commonDir = filepath.Clean(commonDir)
	return &Repo{
		Root:      root,
		GitDir:    gitDir,
		CommonDir: commonDir,
		run:       Runner{Dir: root},
	}, nil
}

// Run executes a git command rooted at the worktree.
func (r *Repo) Run(ctx context.Context, args ...string) ([]byte, error) {
	return r.run.Run(ctx, args...)
}

// IsLinkedWorktree reports whether this repo was opened via a linked worktree.
func (r *Repo) IsLinkedWorktree() bool {
	return r.GitDir != r.CommonDir
}
