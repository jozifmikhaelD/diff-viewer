package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"void/internal/git"
	"void/internal/testutil"
)

func newTestServer(t *testing.T, static fstest.MapFS) *Server {
	t.Helper()
	repo, err := git.Open(context.Background(), testutil.FixtureRepo(t))
	if err != nil {
		t.Fatal(err)
	}
	return New(repo, static, "test")
}

func get(t *testing.T, h http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestHealth(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	rec := get(t, s, "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body healthResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || body.Version != "test" {
		t.Errorf("body = %+v", body)
	}
}

func TestRepo(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	rec := get(t, s, "/api/repo")
	var body RepoResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Root != s.repo.Root || body.LinkedWorktree {
		t.Errorf("body = %+v", body)
	}
}

func TestUnknownAPIRouteIsJSON404(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	rec := get(t, s, "/api/nope")
	if rec.Code != http.StatusNotFound || rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Errorf("status=%d content-type=%q", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestStaticServesFilesAndSPAFallback(t *testing.T) {
	static := fstest.MapFS{
		"index.html":    {Data: []byte("<html>index</html>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	}
	s := newTestServer(t, static)
	if rec := get(t, s, "/assets/app.js"); rec.Body.String() != "console.log(1)" {
		t.Errorf("asset body = %q", rec.Body.String())
	}
	for _, p := range []string{"/", "/commits/abc123", "/assets/"} {
		rec := get(t, s, p)
		if rec.Code != http.StatusOK || rec.Body.String() != "<html>index</html>" {
			t.Errorf("%s: status=%d body=%q, want 200 index fallback", p, rec.Code, rec.Body.String())
		}
	}
}

func TestStaticUnbuiltFrontend(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{".gitkeep": {}})
	rec := get(t, s, "/")
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}
