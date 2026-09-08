package api

import (
	"net/http"
	"testing"
	"testing/fstest"

	"void/internal/git"
)

func TestBlameEndpoint(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	b := decode[git.Blame](t, get(t, s, "/api/blame?commit=v0.1.0&path=src/utils.ts"), http.StatusOK)
	if len(b.Lines) != 3 || len(b.Commits) != 2 {
		t.Errorf("blame = %+v", b)
	}
	wb := decode[git.Blame](t, get(t, s, "/api/blame?worktree=all&path=README.md"), http.StatusOK)
	if !wb.Commits[wb.Lines[len(wb.Lines)-1]].Uncommitted {
		t.Errorf("worktree blame = %+v", wb)
	}
	for target, want := range map[string]int{
		"/api/blame?commit=main":                http.StatusBadRequest,
		"/api/blame?commit=main&path=../x":      http.StatusBadRequest,
		"/api/blame?commit=main&path=nope.txt":  http.StatusNotFound,
		"/api/blame?commit=nope&path=README.md": http.StatusNotFound,
	} {
		if rec := get(t, s, target); rec.Code != want {
			t.Errorf("%s: %d want %d: %s", target, rec.Code, want, rec.Body.String())
		}
	}
}
