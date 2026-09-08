package api

import (
	"errors"
	"net/http"
	"net/url"

	"void/internal/git"
)

// ChangesetResponse is a git.Changeset plus how it was selected.
type ChangesetResponse struct {
	Kind string `json:"kind"` // commit | range | worktree
	*git.Changeset
}

// selectionFromQuery reads the shared selector params:
//
//	?commit=<rev>
//	?from=<rev>&to=<rev>[&mergeBase=1]
//	?worktree=staged|unstaged|untracked|all
func selectionFromQuery(q url.Values) git.Selection {
	mb := q.Get("mergeBase")
	return git.Selection{
		Commit:    q.Get("commit"),
		From:      q.Get("from"),
		To:        q.Get("to"),
		MergeBase: mb == "1" || mb == "true",
		Worktree:  git.WorktreeMode(q.Get("worktree")),
	}
}

func (s *Server) handleChangeset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo, err := s.repoFor(ctx, r)
	if err != nil {
		writeGitError(w, err)
		return
	}
	sel := selectionFromQuery(r.URL.Query())
	cs, err := repo.Summary(ctx, sel)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ChangesetResponse{Kind: sel.Kind(), Changeset: cs})
}

// handleDiff serves GET /api/diff with the selector params plus
// path=, oldPath= (renames), context= (0-100, default 3), ws=1 (ignore whitespace).
func (s *Server) handleDiff(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo, err := s.repoFor(ctx, r)
	if err != nil {
		writeGitError(w, err)
		return
	}
	q := r.URL.Query()
	path := q.Get("path")
	if path == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	context, err := intParam(q.Get("context"), git.DefaultContext, 0, 100)
	if err != nil {
		writeError(w, http.StatusBadRequest, "context: "+err.Error())
		return
	}
	ws := q.Get("ws")
	fd, err := repo.FileDiff(ctx, selectionFromQuery(q), path, q.Get("oldPath"), git.FileDiffOptions{
		Context:          context,
		IgnoreWhitespace: ws == "1" || ws == "true",
	})
	if err != nil {
		if errors.Is(err, git.ErrBadRef) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, fd)
}
