package git

import (
	"reflect"
	"strings"
	"testing"
)

func z(lines ...string) []byte { return []byte(strings.Join(lines, "\x00") + "\x00") }

func TestParseWorktrees(t *testing.T) {
	out := z(
		"worktree /r/main", "HEAD aaaa", "branch refs/heads/main", "",
		"worktree /r/wt", "HEAD bbbb", "detached", "locked reason here", "",
		"worktree /r/bare", "bare", "",
		"worktree /r/gone", "HEAD cccc", "branch refs/heads/x", "prunable gitdir file points to non-existent location", "",
	)
	got, err := parseWorktrees(out)
	if err != nil {
		t.Fatal(err)
	}
	want := []Worktree{
		{Path: "/r/main", Head: "aaaa", Branch: "main", Main: true},
		{Path: "/r/wt", Head: "bbbb", Detached: true, Locked: true, LockReason: "reason here"},
		{Path: "/r/bare", Bare: true},
		{Path: "/r/gone", Head: "cccc", Branch: "x", Prunable: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestParseWorktreesRejectsOrphanAttribute(t *testing.T) {
	if _, err := parseWorktrees(z("HEAD aaaa")); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseRefs(t *testing.T) {
	out := strings.Join([]string{
		"c1\x00refs/heads/main\x00*\x00commit\x00",
		"c2\x00refs/heads/feature\x00 \x00commit\x00",
		"t1\x00refs/tags/v1\x00 \x00tag\x00c1",
		"c2\x00refs/tags/light\x00 \x00commit\x00",
		"c1\x00refs/remotes/origin/main\x00 \x00commit\x00",
		"c1\x00refs/remotes/origin/HEAD\x00 \x00commit\x00",
		"x\x00refs/stash\x00 \x00commit\x00",
	}, "\n") + "\n"
	got, err := parseRefs(out)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]Ref{
		"c1": {{Name: "main", Kind: RefBranch, Head: true}, {Name: "v1", Kind: RefTag}, {Name: "origin/main", Kind: RefRemote}},
		"c2": {{Name: "feature", Kind: RefBranch}, {Name: "light", Kind: RefTag}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestParseStatusV2(t *testing.T) {
	out := z(
		"1 M. N... 100644 100644 100644 0a 2f README.md",
		"1 .M N... 100644 100644 100644 5e 5e src/app.ts",
		"1 MM N... 100644 100644 100644 5e 5e both.ts",
		"2 R. N... 100644 100644 100644 5e 5e R100 new name.ts", "old name.ts",
		"u UU N... 100644 100644 100644 100644 1a 2b 3c conflict.ts",
		"? notes.txt",
		"? other.txt",
		"! ignored.log",
	)
	got := parseStatusV2(out)
	want := WorktreeStatus{Staged: 3, Unstaged: 2, Untracked: 2, Conflicts: 1}
	if got != want {
		t.Errorf("got %+v want %+v", got, want)
	}
	if !(WorktreeStatus{}).Clean() || got.Clean() {
		t.Error("Clean() wrong")
	}
}

func TestParseLog(t *testing.T) {
	rec := func(f ...string) string { return strings.Join(f, "\x1f") }
	out := z(
		rec("m1", "p1 p2 p3", "Ann", "ann@x", "1700000300", "Cam", "cam@x", "1700000301", "merge", "line1\nline2\n"),
		rec("r0", "", "Ann", "ann@x", "1700000000", "Ann", "ann@x", "1700000000", "root", ""),
	)
	got, err := parseLog(out)
	if err != nil {
		t.Fatal(err)
	}
	want := []Commit{
		{SHA: "m1", Parents: []string{"p1", "p2", "p3"},
			Author: Signature{"Ann", "ann@x", 1700000300}, Committer: Signature{"Cam", "cam@x", 1700000301},
			Subject: "merge", Body: "line1\nline2"},
		{SHA: "r0", Parents: []string{},
			Author: Signature{"Ann", "ann@x", 1700000000}, Committer: Signature{"Ann", "ann@x", 1700000000},
			Subject: "root"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestParseLogRejectsMalformed(t *testing.T) {
	if _, err := parseLog(z("only\x1ftwo")); err == nil {
		t.Fatal("expected error")
	}
}
