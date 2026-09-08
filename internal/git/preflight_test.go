package git

import (
	"context"
	"testing"
)

func TestParseGitVersion(t *testing.T) {
	cases := map[string][3]int{
		"git version 2.50.1 (Apple Git-155)\n": {2, 50, 1},
		"git version 2.30.0":                   {2, 30, 1},
		"git version 3.0.0-rc1":                {3, 0, 1},
		"nonsense":                             {0, 0, 0},
	}
	for in, want := range cases {
		maj, min, ok := parseGitVersion(in)
		if maj != want[0] || min != want[1] || ok != (want[2] == 1) {
			t.Errorf("%q: got %d %d %v", in, maj, min, ok)
		}
	}
}

func TestPreflight(t *testing.T) {
	if err := Preflight(context.Background()); err != nil {
		t.Fatalf("preflight on this machine: %v", err)
	}
	t.Setenv("PATH", t.TempDir())
	if err := Preflight(context.Background()); err == nil {
		t.Fatal("expected error when git is missing from PATH")
	}
}
