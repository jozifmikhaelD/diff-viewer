package api

import (
	"context"
	"net/http"

	"void/internal/deps"
	"void/internal/git"
)

const maxGraphNodes = 300

// handleDeps serves GET /api/deps with the selector params plus depth= (0-2).
func (s *Server) handleDeps(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo, err := s.repoFor(ctx, r)
	if err != nil {
		writeGitError(w, err)
		return
	}
	q := r.URL.Query()
	depth, err := intParam(q.Get("depth"), 1, 0, 2)
	if err != nil {
		writeError(w, http.StatusBadRequest, "depth: "+err.Error())
		return
	}
	sel := selectionFromQuery(q)
	cs, err := repo.Summary(ctx, sel)
	if err != nil {
		writeGitError(w, err)
		return
	}
	cur, old, err := s.indexesFor(ctx, repo, sel, cs)
	if err != nil {
		writeGitError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deps.BuildGraph(cur, old, cs.Files, depth, maxGraphNodes))
}

// indexesFor builds the "to" and "from" indexes for a changeset. For the
// working tree the "to" side is HEAD overlaid with the changed files on disk.
func (s *Server) indexesFor(ctx context.Context, repo *git.Repo, sel git.Selection, cs *git.Changeset) (cur, old *deps.Index, err error) {
	if cs.From != "" {
		src, err := deps.NewRevSource(ctx, repo, cs.From)
		if err != nil {
			return nil, nil, err
		}
		if old, err = s.indexer.Build(ctx, src); err != nil {
			return nil, nil, err
		}
	}
	if cs.To != "" {
		src, err := deps.NewRevSource(ctx, repo, cs.To)
		if err != nil {
			return nil, nil, err
		}
		cur, err = s.indexer.Build(ctx, src)
		return cur, old, err
	}
	// working tree: overlay changed files over HEAD (or the index for unstaged)
	baseRev := "HEAD"
	if sel.Worktree == git.ModeStaged {
		// staged: the "to" side is the index; approximate with disk content of
		// staged files, which matches unless they also have unstaged edits.
		baseRev = "HEAD"
	}
	base, err := deps.NewRevSource(ctx, repo, baseRev)
	if err != nil {
		// unborn branch: nothing committed yet
		base = nil
	}
	ov := &deps.OverlaySource{Root: repo.Root, Changed: map[string]bool{}, Deleted: map[string]bool{}}
	if base != nil {
		ov.Base = base
		if old == nil {
			if old, err = s.indexer.Build(ctx, base); err != nil {
				return nil, nil, err
			}
		}
	} else {
		ov.Base = deps.MapSource{}
	}
	for _, f := range cs.Files {
		if f.Status == git.StatusDeleted {
			ov.Deleted[f.Path] = true
			continue
		}
		ov.Changed[f.Path] = true
		if f.OldPath != "" && f.OldPath != f.Path {
			ov.Deleted[f.OldPath] = true
		}
	}
	cur, err = s.indexer.Build(ctx, ov)
	return cur, old, err
}
