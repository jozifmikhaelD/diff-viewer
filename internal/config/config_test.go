package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDirPrecedence(t *testing.T) {
	t.Setenv("VOID_CONFIG_DIR", "/tmp/voidcfg")
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg")
	if d, _ := Dir(); d != "/tmp/voidcfg" {
		t.Errorf("VOID_CONFIG_DIR ignored: %s", d)
	}
	t.Setenv("VOID_CONFIG_DIR", "")
	if d, _ := Dir(); d != filepath.Join("/tmp/xdg", "void") {
		t.Errorf("XDG ignored: %s", d)
	}
	t.Setenv("XDG_CONFIG_HOME", "")
	d, err := Dir()
	if err != nil || filepath.Base(d) != "void" || filepath.Base(filepath.Dir(d)) != ".config" {
		t.Errorf("home default = %s, %v", d, err)
	}
}

func TestTouchForgetAndPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	s := New(path)
	c, err := s.Load()
	if err != nil || len(c.Recent) != 0 {
		t.Fatalf("empty load = %+v, %v", c, err)
	}
	a, b := t.TempDir(), t.TempDir()
	t0 := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	if _, err := s.Touch(a, t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Touch(b, t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	list, err := s.Touch(a, t0.Add(2*time.Minute)) // re-open moves to front, no duplicate
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Path != a || list[1].Path != b {
		t.Errorf("list = %+v", list)
	}
	// persisted across stores
	again, _ := New(path).Load()
	if len(again.Recent) != 2 || again.Recent[0].Path != a || !again.Recent[0].LastOpen.Equal(t0.Add(2*time.Minute)) {
		t.Errorf("reload = %+v", again.Recent)
	}
	if err := s.Forget(a); err != nil {
		t.Fatal(err)
	}
	after, _ := s.Load()
	if len(after.Recent) != 1 || after.Recent[0].Path != b {
		t.Errorf("after forget = %+v", after.Recent)
	}
	if st, err := os.Stat(path); err != nil || st.Mode().Perm() != 0o600 {
		t.Errorf("file mode = %v, %v", st.Mode(), err)
	}
}

func TestTouchPrunesVanishedDirectories(t *testing.T) {
	s := New(filepath.Join(t.TempDir(), "config.json"))
	gone := filepath.Join(t.TempDir(), "gone")
	if err := os.Mkdir(gone, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Touch(gone, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(gone); err != nil {
		t.Fatal(err)
	}
	keep := t.TempDir()
	list, err := s.Touch(keep, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Path != keep {
		t.Errorf("vanished dir not pruned: %+v", list)
	}
}

func TestCapAndCorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	s := New(path)
	base := time.Now()
	root := t.TempDir()
	for i := 0; i < MaxRecent+5; i++ {
		d := filepath.Join(root, string(rune('a'+i)))
		if err := os.Mkdir(d, 0o755); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Touch(d, base.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	c, _ := s.Load()
	if len(c.Recent) != MaxRecent || c.Recent[0].Path != filepath.Join(root, string(rune('a'+MaxRecent+4))) {
		t.Errorf("cap: %d entries, first %s", len(c.Recent), c.Recent[0].Path)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := s.Load()
	if err != nil || len(c.Recent) != 0 {
		t.Errorf("corrupt file should load empty: %+v %v", c, err)
	}
}
