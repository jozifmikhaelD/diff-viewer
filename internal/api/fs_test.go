package api

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestFSComplete(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})
	base := t.TempDir()
	for _, d := range []string{"alpha", "Apple", "beta", ".hidden", "arepo/.git", "zeta"} {
		if err := os.MkdirAll(filepath.Join(base, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(base, "afile.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	q := func(p string) FSCompleteResponse {
		return decode[FSCompleteResponse](t, get(t, s, "/api/fs/complete?path="+url.QueryEscape(p)), http.StatusOK)
	}
	// partial segment, case-insensitive, files and hidden dirs excluded, repos first
	got := q(filepath.Join(base, "a"))
	names := []string{}
	for _, e := range got.Entries {
		names = append(names, e.Name)
	}
	if len(names) != 3 || names[0] != "arepo" || !got.Entries[0].Repo || names[1] != "alpha" || names[2] != "Apple" {
		t.Errorf("entries = %+v", got.Entries)
	}
	if got.Entries[1].Path != filepath.Join(base, "alpha") {
		t.Errorf("path = %s", got.Entries[1].Path)
	}
	// trailing slash lists the directory's children
	all := q(base + "/")
	if len(all.Entries) != 5 {
		t.Errorf("all = %+v", all.Entries)
	}
	// dot prefix reveals hidden dirs
	if h := q(filepath.Join(base, ".h")); len(h.Entries) != 1 || h.Entries[0].Name != ".hidden" {
		t.Errorf("hidden = %+v", h.Entries)
	}
	// nonexistent parent -> empty, not an error
	if none := q(filepath.Join(base, "nope", "x")); len(none.Entries) != 0 {
		t.Errorf("nonexistent = %+v", none.Entries)
	}
	// ~ expands to home
	home := decode[FSCompleteResponse](t, get(t, s, "/api/fs/complete?path=~/"), http.StatusOK)
	if h, _ := os.UserHomeDir(); home.Dir != h+"/" {
		t.Errorf("home dir = %s", home.Dir)
	}
}
