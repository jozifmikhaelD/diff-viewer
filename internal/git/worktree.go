package git

import (
	"bytes"
	"context"
	"fmt"
	"strings"
)

// Worktree is one entry of `git worktree list`. The first entry is the main worktree.
type Worktree struct {
	Path       string `json:"path"`
	Head       string `json:"head"`
	Branch     string `json:"branch"` // short branch name; empty when detached or bare
	Detached   bool   `json:"detached"`
	Bare       bool   `json:"bare"`
	Locked     bool   `json:"locked"`
	LockReason string `json:"lockReason,omitempty"`
	Prunable   bool   `json:"prunable"`
	Main       bool   `json:"main"`
}

// Worktrees lists all worktrees sharing this repository's common dir.
func (r *Repo) Worktrees(ctx context.Context) ([]Worktree, error) {
	out, err := r.Run(ctx, "worktree", "list", "--porcelain", "-z")
	if err != nil {
		return nil, err
	}
	return parseWorktrees(out)
}

// parseWorktrees parses `worktree list --porcelain -z`: attributes are
// NUL-terminated lines and each record ends with an extra NUL.
func parseWorktrees(out []byte) ([]Worktree, error) {
	var (
		wts []Worktree
		cur *Worktree
	)
	for _, line := range bytes.Split(out, []byte{0}) {
		if len(line) == 0 {
			if cur != nil {
				wts = append(wts, *cur)
				cur = nil
			}
			continue
		}
		key, val, _ := strings.Cut(string(line), " ")
		switch key {
		case "worktree":
			if cur != nil { // malformed: record without terminator
				wts = append(wts, *cur)
			}
			cur = &Worktree{Path: val, Main: len(wts) == 0}
			continue
		}
		if cur == nil {
			return nil, fmt.Errorf("worktree list: attribute %q before any worktree", line)
		}
		switch key {
		case "HEAD":
			cur.Head = val
		case "branch":
			cur.Branch = strings.TrimPrefix(val, "refs/heads/")
		case "detached":
			cur.Detached = true
		case "bare":
			cur.Bare = true
		case "locked":
			cur.Locked = true
			cur.LockReason = val
		case "prunable":
			cur.Prunable = true
		}
	}
	if cur != nil {
		wts = append(wts, *cur)
	}
	return wts, nil
}
