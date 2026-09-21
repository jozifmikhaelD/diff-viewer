package api

import (
	"net/http"
	"net/url"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
)

func TestChangesetCommit(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	body := decode[ChangesetResponse](t, get(t, s, "/api/changeset?commit=v0.1.0"), http.StatusOK)
	if body.Kind != "commit" || body.Totals.Files != 5 || body.Totals.Additions != 4 || body.Totals.Deletions != 4 {
		t.Errorf("body = %+v", body)
	}
	var renamed bool
	for _, f := range body.Files {
		renamed = renamed || (f.Status == git.StatusRenamed && f.OldPath == "src/util.ts")
	}
	if !renamed {
		t.Errorf("rename missing: %+v", body.Files)
	}
}

func TestChangesetRangeAndWorktree(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	rng := decode[ChangesetResponse](t, get(t, s, "/api/changeset?from=main&to=feature&mergeBase=1"), http.StatusOK)
	if rng.Kind != "range" || rng.Totals.Files != 2 {
		t.Errorf("range = %+v", rng)
	}
	for mode, wantFiles := range map[string]int{"staged": 1, "unstaged": 1, "untracked": 1, "all": 3} {
		body := decode[ChangesetResponse](t, get(t, s, "/api/changeset?worktree="+mode), http.StatusOK)
		if body.Kind != "worktree" || body.Totals.Files != wantFiles {
			t.Errorf("%s: %+v", mode, body.Totals)
		}
	}
	wt := url.QueryEscape(filepath.Join(s.base, "wt-feature"))
	clean := decode[ChangesetResponse](t, get(t, s, "/api/changeset?wt="+wt+"&worktree=all"), http.StatusOK)
	if clean.Totals.Files != 0 || clean.Files == nil {
		t.Errorf("clean worktree = %+v", clean)
	}
}

func TestChangesetBadParams(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	cases := map[string]int{
		"/api/changeset": http.StatusBadRequest,
		"/api/changeset?commit=main&worktree=all": http.StatusBadRequest,
		"/api/changeset?from=main":                http.StatusBadRequest,
		"/api/changeset?worktree=bogus":           http.StatusBadRequest,
		"/api/changeset?commit=--output=/tmp/x":   http.StatusBadRequest,
		"/api/changeset?commit=nope":              http.StatusNotFound,
		"/api/changeset?from=main&to=nope":        http.StatusNotFound,
	}
	for target, want := range cases {
		if rec := get(t, s, target); rec.Code != want {
			t.Errorf("%s: status=%d want %d body=%s", target, rec.Code, want, rec.Body.String())
		}
	}
}
