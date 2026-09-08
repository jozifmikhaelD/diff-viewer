package git

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"
)

// BlameCommit describes a commit referenced by blame lines.
type BlameCommit struct {
	SHA     string `json:"sha"`
	Author  string `json:"author"`
	Email   string `json:"email"`
	Time    int64  `json:"time"`
	Summary string `json:"summary"`
	// Uncommitted marks working-tree changes not yet committed.
	Uncommitted bool `json:"uncommitted,omitempty"`
}

// Blame maps each line of a file (index+1 = line number) to a commit.
type Blame struct {
	Path    string                  `json:"path"`
	Rev     string                  `json:"rev"`     // "" for the working tree
	Lines   []string                `json:"lines"`   // sha per line
	Commits map[string]*BlameCommit `json:"commits"` // keyed by sha
}

const uncommittedSHA = "0000000000000000000000000000000000000000"

// BlameFile runs git blame for path within sel: at the "to" commit, or on the
// working tree (uncommitted lines are attributed to a synthetic entry).
func (r *Repo) BlameFile(ctx context.Context, sel Selection, path string) (*Blame, error) {
	if err := checkPath(path); err != nil {
		return nil, err
	}
	t, err := r.resolve(ctx, sel)
	if err != nil {
		return nil, err
	}
	args := []string{"blame", "--porcelain", "-w"}
	rev := t.to
	if rev != "" {
		args = append(args, rev)
	}
	args = append(args, "--", path)
	out, err := r.Run(ctx, args...)
	if err != nil {
		return nil, err
	}
	b, err := parseBlame(out)
	if err != nil {
		return nil, err
	}
	b.Path, b.Rev = path, rev
	return b, nil
}

// parseBlame parses `git blame --porcelain` output.
func parseBlame(out []byte) (*Blame, error) {
	b := &Blame{Lines: []string{}, Commits: map[string]*BlameCommit{}}
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	var cur *BlameCommit
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "\t") {
			// content line; header for this line already recorded
			continue
		}
		f := strings.Fields(line)
		if len(f) >= 3 && len(f[0]) == 40 && isHex(f[0]) {
			if _, err := strconv.Atoi(f[2]); err != nil {
				return nil, fmt.Errorf("blame: bad header %q", line)
			}
			sha := f[0]
			c, ok := b.Commits[sha]
			if !ok {
				c = &BlameCommit{SHA: sha, Uncommitted: sha == uncommittedSHA}
				if c.Uncommitted {
					c.Author, c.Summary = "You", "Uncommitted changes"
				}
				b.Commits[sha] = c
			}
			cur = c
			b.Lines = append(b.Lines, sha)
			continue
		}
		if cur == nil {
			continue
		}
		key, val, _ := strings.Cut(line, " ")
		switch key {
		case "author":
			if !cur.Uncommitted {
				cur.Author = val
			}
		case "author-mail":
			cur.Email = strings.Trim(val, "<>")
		case "author-time":
			cur.Time, _ = strconv.ParseInt(val, 10, 64)
		case "summary":
			if !cur.Uncommitted {
				cur.Summary = val
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	return b, nil
}

func isHex(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}
