package git

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// DiffLine is one line of a hunk. Type is " " (context), "+" or "-".
type DiffLine struct {
	Type      string `json:"t"`
	Text      string `json:"s"`
	OldNo     int    `json:"o,omitempty"`
	NewNo     int    `json:"n,omitempty"`
	NoNewline bool   `json:"nonl,omitempty"`
}

// Hunk is one @@ block.
type Hunk struct {
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Header   string     `json:"header,omitempty"`
	Lines    []DiffLine `json:"lines"`
}

// FileDiff is a single file's patch plus (when small enough) both full sides,
// so the client can render side-by-side and expand context without another
// round trip.
type FileDiff struct {
	Path      string     `json:"path"`
	OldPath   string     `json:"oldPath,omitempty"`
	Status    FileStatus `json:"status"`
	Binary    bool       `json:"binary"`
	Submodule bool       `json:"submodule,omitempty"`
	Hunks     []Hunk     `json:"hunks"`
	// Old and New are the full file contents split into lines, or nil when
	// the side does not exist, the file is binary, or it exceeds the size cap.
	Old       []string `json:"old"`
	New       []string `json:"new"`
	HasOld    bool     `json:"hasOld"`
	HasNew    bool     `json:"hasNew"`
	Truncated bool     `json:"truncated"` // content omitted because of size
	OldSize   int      `json:"oldSize"`
	NewSize   int      `json:"newSize"`
}

// FileDiffOptions tunes patch generation.
type FileDiffOptions struct {
	Context          int  // lines of context; 0 means none (the API defaults to DefaultContext)
	IgnoreWhitespace bool // git diff -w
}

// DefaultContext is the usual number of unchanged lines around a change.
const DefaultContext = 3

const (
	maxContentBytes = 2 << 20 // 2 MiB per side
	maxContentLines = 20000
)

// FileDiff produces the patch for one file within sel. oldPath is required to
// keep rename detection paired when the file was renamed.
func (r *Repo) FileDiff(ctx context.Context, sel Selection, path, oldPath string, opts FileDiffOptions) (*FileDiff, error) {
	if err := checkPath(path); err != nil {
		return nil, err
	}
	if oldPath != "" {
		if err := checkPath(oldPath); err != nil {
			return nil, err
		}
	}
	t, err := r.resolve(ctx, sel)
	if err != nil {
		return nil, err
	}
	fd := &FileDiff{Path: path, OldPath: oldPath, Status: StatusModified, Hunks: []Hunk{}}

	oldName := path
	if oldPath != "" {
		oldName = oldPath
	}
	oldData, hasOld, err := r.content(ctx, t.oldSrc, oldName)
	if err != nil {
		return nil, err
	}
	newData, hasNew, err := r.content(ctx, t.newSrc, path)
	if err != nil {
		return nil, err
	}
	fd.HasOld, fd.HasNew = hasOld, hasNew
	fd.OldSize, fd.NewSize = len(oldData), len(newData)
	fd.Binary = isBinary(oldData) || isBinary(newData)

	untracked := t.onlyUntracked || (t.withUntracked && !hasOld && hasNew && !r.tracked(ctx, path))
	switch {
	case untracked:
		fd.Status = StatusUntracked
		if !hasNew {
			return nil, &Error{Args: []string{"diff", path}, Stderr: "fatal: no such path '" + path + "'", Err: os.ErrNotExist}
		}
		if !fd.Binary {
			lines := splitLines(newData)
			h := Hunk{OldStart: 0, OldLines: 0, NewStart: 1, NewLines: len(lines)}
			for i, l := range lines {
				h.Lines = append(h.Lines, DiffLine{Type: "+", Text: l, NewNo: i + 1})
			}
			if len(lines) > 0 && !bytes.HasSuffix(newData, []byte("\n")) {
				h.Lines[len(h.Lines)-1].NoNewline = true
			}
			if len(lines) > 0 {
				fd.Hunks = append(fd.Hunks, h)
			}
		}
	default:
		ctxLines := max(opts.Context, 0)
		args := []string{"-c", "core.quotePath=false", "diff", "-p", "-U" + strconv.Itoa(ctxLines), "-M", "-C",
			"--no-color", "--no-ext-diff", "--no-relative", "--no-prefix"}
		if opts.IgnoreWhitespace {
			args = append(args, "-w")
		}
		args = append(args, t.diffArgs...)
		args = append(args, "--", path)
		if oldPath != "" && oldPath != path {
			args = append(args, oldPath)
		}
		out, err := r.Run(ctx, args...)
		if err != nil {
			return nil, err
		}
		status, binary, hunks, err := parsePatch(out)
		if err != nil {
			return nil, err
		}
		if status != "" {
			fd.Status = status
		}
		fd.Binary = fd.Binary || binary
		fd.Hunks = hunks
	}
	fd.Submodule = isGitlink(fd.Hunks)

	if !fd.Binary && !fd.Submodule {
		oldLines, newLines := splitLines(oldData), splitLines(newData)
		if len(oldData) > maxContentBytes || len(newData) > maxContentBytes ||
			len(oldLines) > maxContentLines || len(newLines) > maxContentLines {
			fd.Truncated = true
		} else {
			if hasOld {
				fd.Old = oldLines
			}
			if hasNew {
				fd.New = newLines
			}
		}
	}
	return fd, nil
}

// tracked reports whether path is in the index.
func (r *Repo) tracked(ctx context.Context, path string) bool {
	out, err := r.Run(ctx, "ls-files", "--error-unmatch", "--", path)
	return err == nil && len(out) > 0
}

// isGitlink detects a submodule pointer patch.
func isGitlink(hunks []Hunk) bool {
	for _, h := range hunks {
		for _, l := range h.Lines {
			if !strings.HasPrefix(l.Text, "Subproject commit ") {
				return false
			}
		}
	}
	return len(hunks) > 0
}

func checkPath(p string) error {
	if p == "" || strings.HasPrefix(p, "-") || strings.HasPrefix(p, "/") || strings.Contains(p, "\x00") {
		return fmt.Errorf("%w: invalid path %q", ErrBadRef, p)
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return fmt.Errorf("%w: invalid path %q", ErrBadRef, p)
		}
	}
	return nil
}

func isBinary(data []byte) bool {
	head := data
	if len(head) > 8192 {
		head = head[:8192]
	}
	return bytes.IndexByte(head, 0) >= 0
}

// splitLines splits file content into lines without terminators. A trailing
// newline does not produce an extra empty line.
func splitLines(data []byte) []string {
	if len(data) == 0 {
		return []string{}
	}
	s := string(data)
	s = strings.TrimSuffix(s, "\n")
	return strings.Split(s, "\n")
}

// parsePatch extracts status, binary flag and hunks from a single-file
// `git diff -p --no-prefix` output.
func parsePatch(out []byte) (FileStatus, bool, []Hunk, error) {
	var (
		status FileStatus
		binary bool
		hunks  = []Hunk{}
		cur    *Hunk
		oldNo  int
		newNo  int
	)
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	inHunk := false
	for sc.Scan() {
		line := sc.Text()
		if inHunk && len(line) > 0 {
			switch line[0] {
			case ' ', '+', '-':
				dl := DiffLine{Type: line[:1], Text: line[1:]}
				switch line[0] {
				case ' ':
					dl.OldNo, dl.NewNo = oldNo, newNo
					oldNo++
					newNo++
				case '-':
					dl.OldNo = oldNo
					oldNo++
				case '+':
					dl.NewNo = newNo
					newNo++
				}
				cur.Lines = append(cur.Lines, dl)
				continue
			case '\\':
				if n := len(cur.Lines); n > 0 {
					cur.Lines[n-1].NoNewline = true
				}
				continue
			}
		}
		inHunk = false
		switch {
		case strings.HasPrefix(line, "@@ "):
			h, err := parseHunkHeader(line)
			if err != nil {
				return "", false, nil, err
			}
			hunks = append(hunks, h)
			cur = &hunks[len(hunks)-1]
			oldNo, newNo = h.OldStart, h.NewStart
			inHunk = true
		case strings.HasPrefix(line, "new file mode"):
			status = StatusAdded
		case strings.HasPrefix(line, "deleted file mode"):
			status = StatusDeleted
		case strings.HasPrefix(line, "rename from"):
			status = StatusRenamed
		case strings.HasPrefix(line, "copy from"):
			status = StatusCopied
		case strings.HasPrefix(line, "Binary files "), strings.HasPrefix(line, "GIT binary patch"):
			binary = true
		}
	}
	if err := sc.Err(); err != nil {
		return "", false, nil, err
	}
	return status, binary, hunks, nil
}

// parseHunkHeader parses "@@ -a[,b] +c[,d] @@[ header]".
func parseHunkHeader(line string) (Hunk, error) {
	rest := strings.TrimPrefix(line, "@@ ")
	end := strings.Index(rest, " @@")
	if end < 0 {
		return Hunk{}, fmt.Errorf("diff: malformed hunk header %q", line)
	}
	ranges := strings.Fields(rest[:end])
	if len(ranges) != 2 || !strings.HasPrefix(ranges[0], "-") || !strings.HasPrefix(ranges[1], "+") {
		return Hunk{}, fmt.Errorf("diff: malformed hunk header %q", line)
	}
	var h Hunk
	var err error
	if h.OldStart, h.OldLines, err = parseRange(ranges[0][1:]); err != nil {
		return Hunk{}, fmt.Errorf("diff: hunk header %q: %w", line, err)
	}
	if h.NewStart, h.NewLines, err = parseRange(ranges[1][1:]); err != nil {
		return Hunk{}, fmt.Errorf("diff: hunk header %q: %w", line, err)
	}
	h.Header = strings.TrimPrefix(rest[end+3:], " ")
	return h, nil
}

func parseRange(s string) (start, count int, err error) {
	count = 1
	if i := strings.IndexByte(s, ','); i >= 0 {
		if count, err = strconv.Atoi(s[i+1:]); err != nil {
			return
		}
		s = s[:i]
	}
	start, err = strconv.Atoi(s)
	return
}
