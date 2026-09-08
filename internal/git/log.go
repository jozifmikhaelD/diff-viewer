package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Signature is an author or committer stamp.
type Signature struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Time  int64  `json:"time"` // unix seconds
}

// Commit is one history entry.
type Commit struct {
	SHA       string    `json:"sha"`
	Parents   []string  `json:"parents"`
	Author    Signature `json:"author"`
	Committer Signature `json:"committer"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body,omitempty"`
	Refs      []Ref     `json:"refs,omitempty"`
}

// LogOptions controls Log. An empty Ref walks all refs.
type LogOptions struct {
	Ref    string
	Skip   int
	Limit  int
	Author string // case-insensitive regexp on author name/email
	Grep   string // case-insensitive regexp on message
}

// ErrBadRef is returned when a ref looks like an option flag.
var ErrBadRef = errors.New("invalid ref")

const logFormat = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%b"

// Log returns up to opts.Limit commits in topological order (parents after
// children, which the lane layout relies on) and whether more exist.
func (r *Repo) Log(ctx context.Context, opts LogOptions) ([]Commit, bool, error) {
	if strings.HasPrefix(opts.Ref, "-") {
		return nil, false, ErrBadRef
	}
	if opts.Limit <= 0 {
		opts.Limit = 200
	}
	args := []string{"log", "--topo-order", "-z", logFormat,
		"--skip=" + strconv.Itoa(opts.Skip), "-n", strconv.Itoa(opts.Limit + 1)}
	if opts.Author != "" {
		args = append(args, "--regexp-ignore-case", "--author="+opts.Author)
	}
	if opts.Grep != "" {
		args = append(args, "--regexp-ignore-case", "--grep="+opts.Grep)
	}
	if opts.Ref == "" {
		args = append(args, "--all")
	} else {
		args = append(args, opts.Ref)
	}
	args = append(args, "--")
	out, err := r.Run(ctx, args...)
	if err != nil {
		return nil, false, err
	}
	commits, err := parseLog(out)
	if err != nil {
		return nil, false, err
	}
	more := len(commits) > opts.Limit
	if more {
		commits = commits[:opts.Limit]
	}
	return commits, more, nil
}

// parseLog parses NUL-separated records whose fields are split by 0x1f.
func parseLog(out []byte) ([]Commit, error) {
	var commits []Commit
	for _, rec := range bytes.Split(out, []byte{0}) {
		if len(rec) == 0 {
			continue
		}
		f := strings.Split(string(rec), "\x1f")
		if len(f) != 10 {
			return nil, fmt.Errorf("log: expected 10 fields, got %d in %q", len(f), rec)
		}
		at, err := strconv.ParseInt(f[4], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("log: author time %q: %w", f[4], err)
		}
		ct, err := strconv.ParseInt(f[7], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("log: committer time %q: %w", f[7], err)
		}
		c := Commit{
			SHA:       f[0],
			Parents:   strings.Fields(f[1]),
			Author:    Signature{Name: f[2], Email: f[3], Time: at},
			Committer: Signature{Name: f[5], Email: f[6], Time: ct},
			Subject:   f[8],
			Body:      strings.TrimRight(f[9], "\n"),
		}
		if c.Parents == nil {
			c.Parents = []string{}
		}
		commits = append(commits, c)
	}
	return commits, nil
}
