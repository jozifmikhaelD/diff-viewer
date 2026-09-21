package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
	"github.com/jozifmikhaelD/diff-viewer/internal/testutil"
)

func TestSameOrigin(t *testing.T) {
	base := testutil.Fixture(t)
	repo, err := git.Open(context.Background(), filepath.Join(base, "repo"))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		bound  string
		host   string
		origin string
		want   int
	}{
		{"loopback host, no origin", "127.0.0.1", "127.0.0.1:4000", "", http.StatusOK},
		{"localhost name", "127.0.0.1", "localhost:4000", "", http.StatusOK},
		{"ipv6 loopback", "127.0.0.1", "[::1]:4000", "", http.StatusOK},
		{"same origin", "127.0.0.1", "localhost:4000", "http://localhost:4000", http.StatusOK},
		{"rebound dns name", "127.0.0.1", "evil.example:4000", "", http.StatusForbidden},
		{"cross-site origin", "127.0.0.1", "localhost:4000", "https://evil.example", http.StatusForbidden},
		{"other local port", "127.0.0.1", "localhost:4000", "http://localhost:3000", http.StatusForbidden},
		{"null origin", "127.0.0.1", "localhost:4000", "null", http.StatusForbidden},
		{"explicit bind address", "192.168.1.5", "192.168.1.5:4000", "", http.StatusOK},
		{"wildcard accepts any host", "0.0.0.0", "devbox.internal:4000", "", http.StatusOK},
		{"wildcard still rejects cross-origin", "0.0.0.0", "devbox.internal:4000", "http://evil.example", http.StatusForbidden},
		{"unset disables the check", "", "evil.example:4000", "http://evil.example", http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := NewWithOptions(repo, fstest.MapFS{}, "test", nil, Options{Host: tc.bound})
			t.Cleanup(s.Close)
			req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			req.Host = tc.host
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			rec := httptest.NewRecorder()
			s.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
