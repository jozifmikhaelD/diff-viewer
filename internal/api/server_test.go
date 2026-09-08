package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"testing/fstest"

	"void/internal/git"
	"void/internal/testutil"
	"void/internal/watch"
)

type testServer struct {
	*Server
	base string
}

func newTestServer(t *testing.T, static fstest.MapFS) testServer {
	t.Helper()
	base := testutil.Fixture(t)
	repo, err := git.Open(context.Background(), filepath.Join(base, "repo"))
	if err != nil {
		t.Fatal(err)
	}
	return testServer{New(repo, static, "test", watch.NewBus()), base}
}

func get(t *testing.T, h http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder, wantStatus int) T {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, wantStatus, rec.Body.String())
	}
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode: %v; body %s", err, rec.Body.String())
	}
	return v
}

func TestHealth(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	body := decode[healthResponse](t, get(t, s, "/api/health"), http.StatusOK)
	if !body.OK || body.Version != "test" {
		t.Errorf("body = %+v", body)
	}
}

func TestRepoListsWorktreesWithStatus(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	body := decode[RepoResponse](t, get(t, s, "/api/repo"), http.StatusOK)
	if body.Root != s.current().Root || body.DefaultBranch != "main" {
		t.Errorf("root/default = %q/%q", body.Root, body.DefaultBranch)
	}
	if len(body.Worktrees) != 2 {
		t.Fatalf("worktrees = %+v", body.Worktrees)
	}
	main, wt := body.Worktrees[0], body.Worktrees[1]
	if !main.Main || !main.Current || main.Branch != "main" || main.Status == nil ||
		*main.Status != (git.WorktreeStatus{Staged: 1, Unstaged: 1, Untracked: 1}) {
		t.Errorf("main = %+v status=%+v", main, main.Status)
	}
	if wt.Main || wt.Current || wt.Branch != "feature" || wt.Status == nil || !wt.Status.Clean() {
		t.Errorf("wt = %+v status=%+v", wt, wt.Status)
	}
}

func TestLogDefaultsAndPaging(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	all := decode[LogResponse](t, get(t, s, "/api/log"), http.StatusOK)
	if len(all.Commits) != 8 || all.HasMore || all.Limit != defaultLogLimit {
		t.Fatalf("all = %d commits, more=%v, limit=%d", len(all.Commits), all.HasMore, all.Limit)
	}
	var headRefs, tagRefs int
	for _, c := range all.Commits {
		for _, r := range c.Refs {
			if r.Head {
				headRefs++
			}
			if r.Kind == git.RefTag {
				tagRefs++
			}
		}
	}
	if headRefs != 1 || tagRefs != 1 {
		t.Errorf("refs attached: head=%d tag=%d", headRefs, tagRefs)
	}

	p1 := decode[LogResponse](t, get(t, s, "/api/log?limit=5"), http.StatusOK)
	p2 := decode[LogResponse](t, get(t, s, "/api/log?limit=5&skip=5"), http.StatusOK)
	if !p1.HasMore || len(p1.Commits) != 5 || p2.HasMore || len(p2.Commits) != 3 || p2.Skip != 5 {
		t.Errorf("paging: p1=%d/%v p2=%d/%v skip=%d", len(p1.Commits), p1.HasMore, len(p2.Commits), p2.HasMore, p2.Skip)
	}
	if p2.Commits[0].SHA != all.Commits[5].SHA {
		t.Error("page 2 does not continue page 1")
	}
}

func TestLogRefAndWorktreeSelection(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	main := decode[LogResponse](t, get(t, s, "/api/log?ref=main"), http.StatusOK)
	if len(main.Commits) != 6 {
		t.Errorf("main: %d commits", len(main.Commits))
	}
	wt := url.QueryEscape(filepath.Join(s.base, "wt-feature"))
	feat := decode[LogResponse](t, get(t, s, "/api/log?wt="+wt+"&ref=HEAD"), http.StatusOK)
	if len(feat.Commits) != 4 || feat.Commits[0].Subject != "f2: document feature" {
		t.Errorf("feature HEAD via wt: %+v", feat.Commits)
	}
	// HEAD ref badge must reflect the selected worktree's branch.
	if len(feat.Commits[0].Refs) == 0 || !feat.Commits[0].Refs[0].Head || feat.Commits[0].Refs[0].Name != "feature" {
		t.Errorf("head badge = %+v", feat.Commits[0].Refs)
	}
}

func TestLogBadParams(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	cases := map[string]int{
		"/api/log?wt=/etc": http.StatusBadRequest,
		"/api/log?wt=" + url.QueryEscape(filepath.Join(s.base, "repo", "src")): http.StatusBadRequest,
		"/api/log?ref=--output=/tmp/pwn":                                       http.StatusBadRequest,
		"/api/log?ref=does-not-exist":                                          http.StatusNotFound,
		"/api/log?limit=0":                                                     http.StatusBadRequest,
		"/api/log?limit=99999":                                                 http.StatusBadRequest,
		"/api/log?skip=abc":                                                    http.StatusBadRequest,
		"/api/nope":                                                            http.StatusNotFound,
	}
	for target, want := range cases {
		rec := get(t, s, target)
		if rec.Code != want || rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
			t.Errorf("%s: status=%d (want %d) content-type=%q body=%s", target, rec.Code, want, rec.Header().Get("Content-Type"), rec.Body.String())
		}
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
	if rec := get(t, s, "/"); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}
