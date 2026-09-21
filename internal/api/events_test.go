package api

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
	"github.com/jozifmikhaelD/diff-viewer/internal/testutil"
	"github.com/jozifmikhaelD/diff-viewer/internal/watch"
)

func TestEventsStream(t *testing.T) {
	heartbeatInterval = 50 * time.Millisecond
	t.Cleanup(func() { heartbeatInterval = 15 * time.Second })
	s := newTestServer(t, fstest.MapFS{})
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = res.Body.Close() })
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type = %q", ct)
	}
	// wait for the subscription before publishing
	deadline := time.Now().Add(2 * time.Second)
	for s.Bus().Subscribers() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	s.Bus().Publish(watch.Event{Worktree: "/w", Kind: watch.KindRefs})

	rd := bufio.NewReader(res.Body)
	var gotRetry, gotEvent, gotData, gotPing bool
	for !gotRetry || !gotEvent || !gotData || !gotPing {
		line, err := rd.ReadString('\n')
		if err != nil {
			t.Fatalf("read: %v (retry=%v event=%v data=%v ping=%v)", err, gotRetry, gotEvent, gotData, gotPing)
		}
		switch {
		case strings.HasPrefix(line, "retry: 2000"):
			gotRetry = true
		case strings.HasPrefix(line, "event: change"):
			gotEvent = true
		case strings.HasPrefix(line, "data: "):
			if !strings.Contains(line, `"worktree":"/w"`) || !strings.Contains(line, `"kind":"refs"`) {
				t.Errorf("data = %q", line)
			}
			gotData = true
		case strings.HasPrefix(line, ": ping"):
			gotPing = true
		}
	}
	cancel()
	// the handler must unsubscribe when the client disconnects
	deadline = time.Now().Add(2 * time.Second)
	for s.Bus().Subscribers() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := s.Bus().Subscribers(); n != 0 {
		t.Errorf("subscribers after disconnect = %d", n)
	}
}

func TestEventsDisabledWithoutBus(t *testing.T) {
	repo, err := git.Open(context.Background(), testutil.FixtureRepo(t))
	if err != nil {
		t.Fatal(err)
	}
	s := New(repo, fstest.MapFS{}, "test", nil)
	rec := get(t, s, "/api/events")
	if rec.Code != http.StatusNotImplemented {
		t.Errorf("status = %d", rec.Code)
	}
}
