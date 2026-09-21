package git

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// FileStatus is git's one-letter change status.
type FileStatus string

const (
	StatusAdded     FileStatus = "A"
	StatusModified  FileStatus = "M"
	StatusDeleted   FileStatus = "D"
	StatusRenamed   FileStatus = "R"
	StatusCopied    FileStatus = "C"
	StatusTypeChng  FileStatus = "T"
	StatusUnmerged  FileStatus = "U"
	StatusUntracked FileStatus = "?"
)

// FileChange is one entry of a changeset.
type FileChange struct {
	Path       string     `json:"path"`
	OldPath    string     `json:"oldPath,omitempty"` // set for renames and copies
	Status     FileStatus `json:"status"`
	Similarity int        `json:"similarity,omitempty"` // rename/copy score 0-100
	Additions  int        `json:"additions"`
	Deletions  int        `json:"deletions"`
	Binary     bool       `json:"binary"`
	Submodule  bool       `json:"submodule,omitempty"`
	OldMode    string     `json:"oldMode,omitempty"`
	NewMode    string     `json:"newMode,omitempty"`
}

// Totals sums a changeset.
type Totals struct {
	Files     int `json:"files"`
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

// Changeset is the summary of a diff between two states.
type Changeset struct {
	// From and To are resolved commit SHAs. To is "" for index/working-tree
	// comparisons; From is "" when comparing the index to the working tree.
	From   string       `json:"from"`
	To     string       `json:"to"`
	Files  []FileChange `json:"files"`
	Totals Totals       `json:"totals"`
}

// WorktreeMode selects which uncommitted changes to summarise.
type WorktreeMode string

const (
	ModeStaged    WorktreeMode = "staged"    // index vs HEAD
	ModeUnstaged  WorktreeMode = "unstaged"  // working tree vs index (tracked files only)
	ModeUntracked WorktreeMode = "untracked" // untracked files only
	ModeAll       WorktreeMode = "all"       // working tree vs HEAD, plus untracked
)

// ErrBadMode is returned for an unknown WorktreeMode.
var ErrBadMode = errors.New("invalid worktree mode")

const submoduleMode = "160000"

// Summary lists the files changed by sel with per-file line counts.
func (r *Repo) Summary(ctx context.Context, sel Selection) (*Changeset, error) {
	t, err := r.resolve(ctx, sel)
	if err != nil {
		return nil, err
	}
	var files []FileChange
	if !t.onlyUntracked {
		if files, err = r.diffFiles(ctx, t.diffArgs...); err != nil {
			return nil, err
		}
	}
	if t.withUntracked {
		untracked, err := r.untrackedFiles(ctx)
		if err != nil {
			return nil, err
		}
		files = append(files, untracked...)
	}
	return newChangeset(t.from, t.to, files), nil
}

// DiffCommit summarises a commit against its first parent (or the empty tree
// for a root commit).
func (r *Repo) DiffCommit(ctx context.Context, rev string) (*Changeset, error) {
	return r.Summary(ctx, Selection{Commit: rev})
}

// DiffRange summarises from..to. With mergeBase it uses from...to semantics
// (changes on to since it diverged from from).
func (r *Repo) DiffRange(ctx context.Context, from, to string, mergeBase bool) (*Changeset, error) {
	return r.Summary(ctx, Selection{From: from, To: to, MergeBase: mergeBase})
}

// DiffWorktree summarises uncommitted changes.
func (r *Repo) DiffWorktree(ctx context.Context, mode WorktreeMode) (*Changeset, error) {
	return r.Summary(ctx, Selection{Worktree: mode})
}

// ResolveCommit turns a revision into a full commit SHA.
func (r *Repo) ResolveCommit(ctx context.Context, rev string) (string, error) {
	if err := checkRev(rev); err != nil {
		return "", err
	}
	out, err := r.Run(ctx, "rev-parse", "--verify", "--quiet", rev+"^{commit}")
	if err != nil {
		var gerr *Error
		if errors.As(err, &gerr) && gerr.Stderr == "" {
			gerr.Stderr = "fatal: bad revision '" + rev + "'"
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// EmptyTree returns the hash of the empty tree for this repo's object format.
func (r *Repo) EmptyTree(ctx context.Context) (string, error) {
	r.emptyTreeOnce.Do(func() {
		out, err := r.Run(ctx, "hash-object", "-t", "tree", "/dev/null")
		if err != nil {
			r.emptyTreeErr = err
			return
		}
		r.emptyTree = strings.TrimSpace(string(out))
	})
	return r.emptyTree, r.emptyTreeErr
}

func checkRev(rev string) error {
	if rev == "" || strings.HasPrefix(rev, "-") {
		return fmt.Errorf("%w: %q", ErrBadRef, rev)
	}
	return nil
}

func newChangeset(from, to string, files []FileChange) *Changeset {
	if files == nil {
		files = []FileChange{}
	}
	cs := &Changeset{From: from, To: to, Files: files}
	for _, f := range files {
		cs.Totals.Files++
		cs.Totals.Additions += f.Additions
		cs.Totals.Deletions += f.Deletions
	}
	return cs
}

// diffFiles runs `git diff --raw` and `git diff --numstat` with the given
// revision arguments concurrently and merges them.
func (r *Repo) diffFiles(ctx context.Context, revs ...string) ([]FileChange, error) {
	common := []string{"diff", "-z", "-M", "-C", "--no-color", "--no-ext-diff", "--no-relative"}
	rawArgs := append(append(append([]string{}, common...), "--raw"), revs...)
	numArgs := append(append(append([]string{}, common...), "--numstat"), revs...)
	rawArgs = append(rawArgs, "--")
	numArgs = append(numArgs, "--")

	var (
		wg             sync.WaitGroup
		rawOut, numOut []byte
		rawErr, numErr error
	)
	wg.Add(2)
	go func() { defer wg.Done(); rawOut, rawErr = r.Run(ctx, rawArgs...) }()
	go func() { defer wg.Done(); numOut, numErr = r.Run(ctx, numArgs...) }()
	wg.Wait()
	if rawErr != nil {
		return nil, rawErr
	}
	if numErr != nil {
		return nil, numErr
	}
	files, err := parseRaw(rawOut)
	if err != nil {
		return nil, err
	}
	stats, err := parseNumstat(numOut)
	if err != nil {
		return nil, err
	}
	for i := range files {
		if st, ok := stats[files[i].Path]; ok {
			files[i].Additions, files[i].Deletions, files[i].Binary = st.add, st.del, st.binary
		}
	}
	return files, nil
}

// parseRaw parses `diff --raw -z`: ":oldmode newmode oldsha newsha STATUS[score]" NUL path NUL [path2 NUL].
func parseRaw(out []byte) ([]FileChange, error) {
	var files []FileChange
	fields := bytes.Split(out, []byte{0})
	for i := 0; i < len(fields); i++ {
		hdr := string(fields[i])
		if hdr == "" {
			continue
		}
		if !strings.HasPrefix(hdr, ":") {
			return nil, fmt.Errorf("diff --raw: unexpected header %q", hdr)
		}
		parts := strings.Fields(hdr[1:])
		if len(parts) != 5 || i+1 >= len(fields) {
			return nil, fmt.Errorf("diff --raw: malformed entry %q", hdr)
		}
		status := parts[4]
		fc := FileChange{
			OldMode: parts[0], NewMode: parts[1],
			Status: FileStatus(status[:1]),
		}
		if len(status) > 1 {
			fc.Similarity, _ = strconv.Atoi(status[1:])
		}
		i++
		fc.Path = string(fields[i])
		if fc.Status == StatusRenamed || fc.Status == StatusCopied {
			if i+1 >= len(fields) || len(fields[i+1]) == 0 {
				return nil, fmt.Errorf("diff --raw: rename missing destination for %q", fc.Path)
			}
			i++
			fc.OldPath, fc.Path = fc.Path, string(fields[i])
		}
		fc.Submodule = fc.OldMode == submoduleMode || fc.NewMode == submoduleMode
		files = append(files, fc)
	}
	return files, nil
}

type numstat struct {
	add, del int
	binary   bool
}

// parseNumstat parses `diff --numstat -z`: "add TAB del TAB path NUL", or for
// renames "add TAB del TAB NUL old NUL new NUL". Binary files use "-".
func parseNumstat(out []byte) (map[string]numstat, error) {
	stats := map[string]numstat{}
	fields := bytes.Split(out, []byte{0})
	for i := 0; i < len(fields); i++ {
		rec := string(fields[i])
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\t", 3)
		if len(parts) != 3 {
			return nil, fmt.Errorf("diff --numstat: malformed record %q", rec)
		}
		var st numstat
		if parts[0] == "-" && parts[1] == "-" {
			st.binary = true
		} else {
			var err error
			if st.add, err = strconv.Atoi(parts[0]); err != nil {
				return nil, fmt.Errorf("diff --numstat: additions %q", parts[0])
			}
			if st.del, err = strconv.Atoi(parts[1]); err != nil {
				return nil, fmt.Errorf("diff --numstat: deletions %q", parts[1])
			}
		}
		path := parts[2]
		if path == "" { // rename: old and new follow as separate fields
			if i+2 >= len(fields) {
				return nil, fmt.Errorf("diff --numstat: rename missing paths after %q", rec)
			}
			path = string(fields[i+2])
			i += 2
		}
		stats[path] = st
	}
	return stats, nil
}

// untrackedFiles lists untracked, non-ignored files with line counts.
func (r *Repo) untrackedFiles(ctx context.Context) ([]FileChange, error) {
	out, err := r.Run(ctx, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	var files []FileChange
	for _, p := range bytes.Split(out, []byte{0}) {
		if len(p) == 0 {
			continue
		}
		path := string(p)
		fc := FileChange{Path: path, Status: StatusUntracked, NewMode: "100644"}
		fc.Additions, fc.Binary, err = countLines(filepath.Join(r.Root, path))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("untracked %s: %w", path, err)
		}
		files = append(files, fc)
	}
	return files, nil
}

// countLines counts newline-terminated lines (plus a final unterminated one)
// and detects binary content by a NUL byte in the first 8 KiB, like git.
func countLines(path string) (lines int, binary bool, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = f.Close() }()
	br := bufio.NewReaderSize(f, 64*1024)
	head, _ := br.Peek(8192)
	if bytes.IndexByte(head, 0) >= 0 {
		return 0, true, nil
	}
	var last byte = '\n'
	for {
		b, err := br.ReadByte()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, false, err
		}
		if b == '\n' {
			lines++
		}
		last = b
	}
	if last != '\n' {
		lines++
	}
	return lines, false, nil
}
