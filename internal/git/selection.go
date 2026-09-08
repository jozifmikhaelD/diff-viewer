package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Selection names what to diff. Exactly one form must be set: Commit; From+To
// (optionally MergeBase); or Worktree.
type Selection struct {
	Commit    string
	From      string
	To        string
	MergeBase bool
	Worktree  WorktreeMode
}

// Kind is "commit", "range" or "worktree".
func (s Selection) Kind() string {
	switch {
	case s.Commit != "":
		return "commit"
	case s.Worktree != "":
		return "worktree"
	default:
		return "range"
	}
}

// ErrBadSelection is returned when a Selection is ambiguous or incomplete.
var ErrBadSelection = errors.New("invalid selection")

// Validate checks that exactly one selector form is present.
func (s Selection) Validate() error {
	n := 0
	if s.Commit != "" {
		n++
	}
	if s.From != "" || s.To != "" {
		n++
		if s.From == "" || s.To == "" {
			return fmt.Errorf("%w: range needs both from and to", ErrBadSelection)
		}
	}
	if s.Worktree != "" {
		n++
	}
	if n != 1 {
		return fmt.Errorf("%w: specify exactly one of commit, from+to, or worktree", ErrBadSelection)
	}
	return nil
}

// sourceKind says where a file's content on one side of a diff lives.
type sourceKind int

const (
	srcNone     sourceKind = iota // side does not exist (e.g. before an untracked file)
	srcRev                        // <rev>:<path>
	srcIndex                      // :<path>
	srcWorktree                   // file on disk
)

type contentSource struct {
	kind sourceKind
	rev  string
}

// target is a resolved Selection.
type target struct {
	kind          string
	from, to      string   // resolved SHAs; "" for index/worktree sides
	diffArgs      []string // revision arguments for `git diff`
	oldSrc        contentSource
	newSrc        contentSource
	withUntracked bool // append untracked files to the summary
	onlyUntracked bool // no `git diff` at all
}

func (r *Repo) resolve(ctx context.Context, sel Selection) (*target, error) {
	if err := sel.Validate(); err != nil {
		return nil, err
	}
	switch sel.Kind() {
	case "commit":
		if err := checkRev(sel.Commit); err != nil {
			return nil, err
		}
		out, err := r.Run(ctx, "rev-list", "--parents", "-n", "1", sel.Commit, "--")
		if err != nil {
			return nil, err
		}
		ids := strings.Fields(string(out))
		if len(ids) == 0 {
			return nil, &Error{Args: []string{"rev-list", sel.Commit}, Stderr: "fatal: bad revision '" + sel.Commit + "'", Err: errors.New("no such commit")}
		}
		sha, from := ids[0], ""
		if len(ids) > 1 {
			from = ids[1]
		} else if from, err = r.EmptyTree(ctx); err != nil {
			return nil, err
		}
		return &target{kind: "commit", from: from, to: sha, diffArgs: []string{from, sha},
			oldSrc: contentSource{srcRev, from}, newSrc: contentSource{srcRev, sha}}, nil

	case "range":
		toSHA, err := r.ResolveCommit(ctx, sel.To)
		if err != nil {
			return nil, err
		}
		var fromSHA string
		if sel.MergeBase {
			if err := checkRev(sel.From); err != nil {
				return nil, err
			}
			out, err := r.Run(ctx, "merge-base", sel.From, toSHA)
			if err != nil {
				return nil, err
			}
			fromSHA = strings.TrimSpace(string(out))
		} else if fromSHA, err = r.ResolveCommit(ctx, sel.From); err != nil {
			return nil, err
		}
		return &target{kind: "range", from: fromSHA, to: toSHA, diffArgs: []string{fromSHA, toSHA},
			oldSrc: contentSource{srcRev, fromSHA}, newSrc: contentSource{srcRev, toSHA}}, nil

	default:
		head, err := r.ResolveCommit(ctx, "HEAD")
		if err != nil {
			// Unborn branch: compare against the empty tree.
			if head, err = r.EmptyTree(ctx); err != nil {
				return nil, err
			}
		}
		t := &target{kind: "worktree"}
		switch sel.Worktree {
		case ModeStaged:
			t.from, t.diffArgs = head, []string{"--cached", head}
			t.oldSrc, t.newSrc = contentSource{srcRev, head}, contentSource{kind: srcIndex}
		case ModeUnstaged:
			t.oldSrc, t.newSrc = contentSource{kind: srcIndex}, contentSource{kind: srcWorktree}
		case ModeAll:
			t.from, t.diffArgs, t.withUntracked = head, []string{head}, true
			t.oldSrc, t.newSrc = contentSource{srcRev, head}, contentSource{kind: srcWorktree}
		case ModeUntracked:
			t.withUntracked, t.onlyUntracked = true, true
			t.oldSrc, t.newSrc = contentSource{kind: srcNone}, contentSource{kind: srcWorktree}
		default:
			return nil, fmt.Errorf("%w: %q", ErrBadMode, sel.Worktree)
		}
		return t, nil
	}
}

// content fetches one side of a file. ok is false when the side has no such file.
func (r *Repo) content(ctx context.Context, src contentSource, path string) (data []byte, ok bool, err error) {
	switch src.kind {
	case srcNone:
		return nil, false, nil
	case srcWorktree:
		data, err = os.ReadFile(filepath.Join(r.Root, path))
		if errors.Is(err, os.ErrNotExist) {
			return nil, false, nil
		}
		return data, err == nil, err
	case srcIndex:
		return r.show(ctx, ":"+path)
	default:
		return r.show(ctx, src.rev+":"+path)
	}
}

func (r *Repo) show(ctx context.Context, spec string) ([]byte, bool, error) {
	out, err := r.Run(ctx, "show", spec)
	if err != nil {
		var gerr *Error
		if errors.As(err, &gerr) && (strings.Contains(gerr.Stderr, "does not exist") ||
			strings.Contains(gerr.Stderr, "exists on disk, but not in") ||
			strings.Contains(gerr.Stderr, "bad object") ||
			strings.Contains(gerr.Stderr, "is in the index, but not at stage")) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return out, true, nil
}
