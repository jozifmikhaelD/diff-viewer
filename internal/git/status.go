package git

import (
	"bytes"
	"context"
	"strings"
)

// WorktreeStatus summarises `git status` for the working tree.
type WorktreeStatus struct {
	Staged    int `json:"staged"`
	Unstaged  int `json:"unstaged"`
	Untracked int `json:"untracked"`
	Conflicts int `json:"conflicts"`
}

// Clean reports whether the working tree has no changes of any kind.
func (s WorktreeStatus) Clean() bool {
	return s.Staged == 0 && s.Unstaged == 0 && s.Untracked == 0 && s.Conflicts == 0
}

// Status counts staged, unstaged, untracked and conflicted paths.
func (r *Repo) Status(ctx context.Context) (WorktreeStatus, error) {
	out, err := r.Run(ctx, "status", "--porcelain=v2", "-z", "--untracked-files=normal")
	if err != nil {
		return WorktreeStatus{}, err
	}
	return parseStatusV2(out), nil
}

// parseStatusV2 parses porcelain v2 with -z. A path in a rename/copy record
// ("2 ...") is followed by the original path as a separate NUL-terminated field.
func parseStatusV2(out []byte) WorktreeStatus {
	var st WorktreeStatus
	fields := bytes.Split(out, []byte{0})
	for i := 0; i < len(fields); i++ {
		rec := string(fields[i])
		if rec == "" {
			continue
		}
		kind, rest, _ := strings.Cut(rec, " ")
		switch kind {
		case "1", "2":
			xy := rest[:2]
			if xy[0] != '.' {
				st.Staged++
			}
			if xy[1] != '.' {
				st.Unstaged++
			}
			if kind == "2" {
				i++ // skip the original-path field
			}
		case "u":
			st.Conflicts++
		case "?":
			st.Untracked++
		}
	}
	return st
}
