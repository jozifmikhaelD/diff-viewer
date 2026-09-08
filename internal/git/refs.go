package git

import (
	"context"
	"fmt"
	"strings"
)

// RefKind classifies a ref.
type RefKind string

const (
	RefBranch RefKind = "branch"
	RefTag    RefKind = "tag"
	RefRemote RefKind = "remote"
)

// Ref is a named pointer at a commit.
type Ref struct {
	Name string  `json:"name"` // short name: main, v1.0, origin/main
	Kind RefKind `json:"kind"`
	Head bool    `json:"head,omitempty"` // true for the checked-out branch of this worktree
}

// Refs returns all branches, tags and remote branches keyed by the commit
// they point at (annotated tags are peeled). Remote HEAD symrefs are skipped.
func (r *Repo) Refs(ctx context.Context) (map[string][]Ref, error) {
	out, err := r.Run(ctx, "for-each-ref",
		"--format=%(objectname)%00%(refname)%00%(HEAD)%00%(objecttype)%00%(*objectname)",
		"refs/heads", "refs/tags", "refs/remotes")
	if err != nil {
		return nil, err
	}
	return parseRefs(string(out))
}

func parseRefs(out string) (map[string][]Ref, error) {
	refs := map[string][]Ref{}
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x00")
		if len(f) != 5 {
			return nil, fmt.Errorf("for-each-ref: unexpected line %q", line)
		}
		sha, name, head, objType, peeled := f[0], f[1], f[2], f[3], f[4]
		if objType == "tag" && peeled != "" {
			sha = peeled
		}
		ref := Ref{Head: head == "*"}
		switch {
		case strings.HasPrefix(name, "refs/heads/"):
			ref.Kind, ref.Name = RefBranch, strings.TrimPrefix(name, "refs/heads/")
		case strings.HasPrefix(name, "refs/tags/"):
			ref.Kind, ref.Name = RefTag, strings.TrimPrefix(name, "refs/tags/")
		case strings.HasPrefix(name, "refs/remotes/"):
			ref.Kind, ref.Name = RefRemote, strings.TrimPrefix(name, "refs/remotes/")
			if strings.HasSuffix(ref.Name, "/HEAD") {
				continue
			}
		default:
			continue
		}
		refs[sha] = append(refs[sha], ref)
	}
	return refs, nil
}

// DefaultBranch guesses the integration branch: origin/HEAD if set, then
// main, then master, then init.defaultBranch. Returns "" when nothing matches.
func (r *Repo) DefaultBranch(ctx context.Context) string {
	if out, err := r.Run(ctx, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"); err == nil {
		return strings.TrimPrefix(strings.TrimSpace(string(out)), "refs/remotes/origin/")
	}
	for _, name := range []string{"main", "master"} {
		if _, err := r.Run(ctx, "rev-parse", "--verify", "--quiet", "refs/heads/"+name); err == nil {
			return name
		}
	}
	if out, err := r.Run(ctx, "config", "--get", "init.defaultBranch"); err == nil {
		if name := strings.TrimSpace(string(out)); name != "" {
			if _, err := r.Run(ctx, "rev-parse", "--verify", "--quiet", "refs/heads/"+name); err == nil {
				return name
			}
		}
	}
	return ""
}
