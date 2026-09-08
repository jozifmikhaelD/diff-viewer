package api

import (
	"errors"
	"net/http"

	"void/internal/git"
)

// handleBlame serves GET /api/blame with the selector params plus path=.
func (s *Server) handleBlame(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo, err := s.repoFor(ctx, r)
	if err != nil {
		writeGitError(w, err)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	b, err := repo.BlameFile(ctx, selectionFromQuery(r.URL.Query()), path)
	if err != nil {
		if errors.Is(err, git.ErrBadRef) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		var gerr *git.Error
		if errors.As(err, &gerr) && (contains(gerr.Stderr, "no such path") || contains(gerr.Stderr, "does not exist")) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func contains(s, sub string) bool {
	return len(sub) > 0 && len(s) >= len(sub) && indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
