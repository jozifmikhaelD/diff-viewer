package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jozifmikhaelD/diff-viewer/internal/config"
	"github.com/jozifmikhaelD/diff-viewer/internal/git"
	"github.com/jozifmikhaelD/diff-viewer/internal/testutil"
	"github.com/jozifmikhaelD/diff-viewer/internal/watch"
)

func post(t *testing.T, h http.Handler, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, target, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	return rec
}

func TestOpenSwitchesRepoAndRecordsRecent(t *testing.T) {
	base := testutil.Fixture(t)
	other := testutil.Fixture(t)
	repo, err := git.Open(context.Background(), filepath.Join(base, "repo"))
	if err != nil {
		t.Fatal(err)
	}
	store := config.New(filepath.Join(t.TempDir(), "config.json"))
	s := NewWithOptions(repo, fstest.MapFS{}, "test", watch.NewBus(), Options{Config: store, Watch: true})
	t.Cleanup(s.Close)

	first := decode[RecentResponse](t, get(t, s, "/api/recent"), http.StatusOK)
	if len(first.Recent) != 1 || first.Recent[0].Path != repo.Root {
		t.Errorf("initial recent = %+v", first.Recent)
	}

	// switch to the other fixture's linked worktree
	target := filepath.Join(other, "wt-feature")
	body := decode[RepoResponse](t, post(t, s, "/api/open", map[string]string{"path": target}), http.StatusOK)
	if body.Root != target || len(body.Worktrees) != 2 {
		t.Errorf("open = %+v", body)
	}
	if s.current().Root != target {
		t.Errorf("current = %s", s.current().Root)
	}
	// history now comes from the new repo's HEAD (feature branch)
	logResp := decode[LogResponse](t, get(t, s, "/api/log?ref=HEAD&limit=1"), http.StatusOK)
	if logResp.Commits[0].Subject != "f2: document feature" {
		t.Errorf("log after open = %+v", logResp.Commits[0])
	}
	recent := decode[RecentResponse](t, get(t, s, "/api/recent"), http.StatusOK)
	if len(recent.Recent) != 2 || recent.Recent[0].Path != target {
		t.Errorf("recent after open = %+v", recent.Recent)
	}
	// watchers follow the open repo: a change in the new repo produces an event
	events, unsub := s.Bus().Subscribe()
	defer unsub()
	time.Sleep(200 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(target, "new.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-events:
		if ev.Worktree != target && ev.Worktree != filepath.Join(other, "repo") {
			t.Errorf("event from unexpected worktree %s", ev.Worktree)
		}
	case <-time.After(3 * time.Second):
		t.Error("no watch event from the newly opened repo")
	}

	// recent entries whose directory vanished are hidden
	_ = store.Forget(target)
	if _, err := store.Touch(filepath.Join(t.TempDir(), "gone"), time.Now()); err != nil {
		t.Fatal(err)
	}
	rr := decode[RecentResponse](t, get(t, s, "/api/recent"), http.StatusOK)
	for _, r := range rr.Recent {
		if filepath.Base(r.Path) == "gone" {
			t.Error("missing directory listed as recent")
		}
	}
}

func TestOpenErrors(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	notRepo := t.TempDir()
	file := filepath.Join(notRepo, "f.txt")
	_ = os.WriteFile(file, []byte("x"), 0o644)
	cases := []struct {
		body any
		want int
	}{
		{map[string]string{"path": filepath.Join(notRepo, "missing")}, http.StatusNotFound},
		{map[string]string{"path": notRepo}, http.StatusBadRequest},
		{map[string]string{"path": file}, http.StatusBadRequest},
		{map[string]string{}, http.StatusBadRequest},
		{"garbage", http.StatusBadRequest},
	}
	for _, c := range cases {
		if rec := post(t, s, "/api/open", c.body); rec.Code != c.want {
			t.Errorf("%v: status=%d want %d body=%s", c.body, rec.Code, c.want, rec.Body.String())
		}
	}
	// recent list is empty (not an error) when no config store is configured
	if rr := decode[RecentResponse](t, get(t, s, "/api/recent"), http.StatusOK); len(rr.Recent) != 0 {
		t.Errorf("recent without store = %+v", rr)
	}
}

func TestExpandHome(t *testing.T) {
	home, _ := os.UserHomeDir()
	if got := expandHome("~/x"); got != filepath.Join(home, "x") {
		t.Errorf("~ expansion = %s", got)
	}
	if got := expandHome("/a/./b/"); got != "/a/b" {
		t.Errorf("clean = %s", got)
	}
}
