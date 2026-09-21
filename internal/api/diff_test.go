package api

import (
	"net/http"
	"testing"
	"testing/fstest"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
)

func TestDiffEndpoint(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	fd := decode[git.FileDiff](t, get(t, s, "/api/diff?commit=v0.1.0&path=src/utils.ts&oldPath=src/util.ts"), http.StatusOK)
	if fd.Status != git.StatusRenamed || len(fd.Hunks) != 1 || len(fd.Old) != 3 || len(fd.New) != 3 {
		t.Errorf("rename diff = %+v", fd)
	}
	fd = decode[git.FileDiff](t, get(t, s, "/api/diff?commit=v0.1.0&path=src/app.ts&context=0&ws=1"), http.StatusOK)
	if len(fd.Hunks) != 1 || len(fd.Hunks[0].Lines) != 2 {
		t.Errorf("U0 diff = %+v", fd.Hunks)
	}
	fd = decode[git.FileDiff](t, get(t, s, "/api/diff?worktree=untracked&path=notes.txt"), http.StatusOK)
	if fd.Status != git.StatusUntracked || len(fd.Hunks) != 1 {
		t.Errorf("untracked diff = %+v", fd)
	}
	fd = decode[git.FileDiff](t, get(t, s, "/api/diff?from=main&to=feature&mergeBase=1&path=README.md"), http.StatusOK)
	if fd.Status != git.StatusModified || len(fd.Hunks) != 1 {
		t.Errorf("range diff = %+v", fd)
	}

	cases := map[string]int{
		"/api/diff?commit=main":                     http.StatusBadRequest, // no path
		"/api/diff?path=x":                          http.StatusBadRequest, // no selector
		"/api/diff?commit=main&path=../x":           http.StatusBadRequest,
		"/api/diff?commit=main&path=x&context=500":  http.StatusBadRequest,
		"/api/diff?commit=nope&path=x":              http.StatusNotFound,
		"/api/diff?worktree=untracked&path=missing": http.StatusNotFound,
	}
	for target, want := range cases {
		if rec := get(t, s, target); rec.Code != want {
			t.Errorf("%s: status=%d want %d body=%s", target, rec.Code, want, rec.Body.String())
		}
	}
}
