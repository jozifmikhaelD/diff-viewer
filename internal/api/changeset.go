package api

import (
	"net/http"

	"void/internal/git"
)

// ChangesetResponse is a git.Changeset plus how it was selected.
type ChangesetResponse struct {
	Kind string `json:"kind"` // commit | range | worktree
	*git.Changeset
}

// handleChangeset serves GET /api/changeset with exactly one selector:
//
//	?commit=<rev>
//	?from=<rev>&to=<rev>[&mergeBase=1]
//	?worktree=staged|unstaged|untracked|all
func (s *Server) handleChangeset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo, err := s.repoFor(ctx, r)
	if err != nil {
		writeGitError(w, err)
		return
	}
	q := r.URL.Query()
	commit, from, to, wt := q.Get("commit"), q.Get("from"), q.Get("to"), q.Get("worktree")
	selectors := 0
	for _, set := range []bool{commit != "", from != "" || to != "", wt != ""} {
		if set {
			selectors++
		}
	}
	if selectors != 1 {
		writeError(w, http.StatusBadRequest, "specify exactly one of commit, from+to, or worktree")
		return
	}
	var (
		cs   *git.Changeset
		kind string
	)
	switch {
	case commit != "":
		kind, cs, err = "commit", nil, nil
		cs, err = repo.DiffCommit(ctx, commit)
	case wt != "":
		kind = "worktree"
		cs, err = repo.DiffWorktree(ctx, git.WorktreeMode(wt))
	default:
		if from == "" || to == "" {
			writeError(w, http.StatusBadRequest, "range needs both from and to")
			return
		}
		kind = "range"
		mb := q.Get("mergeBase")
		cs, err = repo.DiffRange(ctx, from, to, mb == "1" || mb == "true")
	}
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ChangesetResponse{Kind: kind, Changeset: cs})
}
