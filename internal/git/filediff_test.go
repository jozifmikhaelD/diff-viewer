package git

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestParsePatch(t *testing.T) {
	patch := strings.Join([]string{
		"diff --git src/util.ts src/utils.ts",
		"similarity index 64%",
		"rename from src/util.ts",
		"rename to src/utils.ts",
		"index 3056cd1..831f713 100644",
		"--- src/util.ts",
		"+++ src/utils.ts",
		"@@ -1,3 +1,3 @@ export function greet",
		" export function greet(name: string): string {",
		"-  return `hello ${name}`;",
		"+  return `hi ${name}`;",
		" }",
		"@@ -10 +10,2 @@",
		"-x",
		"+y",
		"+z",
		"\\ No newline at end of file",
	}, "\n") + "\n"
	status, binary, hunks, err := parsePatch([]byte(patch))
	if err != nil {
		t.Fatal(err)
	}
	if status != StatusRenamed || binary {
		t.Errorf("status=%s binary=%v", status, binary)
	}
	want := []Hunk{
		{OldStart: 1, OldLines: 3, NewStart: 1, NewLines: 3, Header: "export function greet", Lines: []DiffLine{
			{Type: " ", Text: "export function greet(name: string): string {", OldNo: 1, NewNo: 1},
			{Type: "-", Text: "  return `hello ${name}`;", OldNo: 2},
			{Type: "+", Text: "  return `hi ${name}`;", NewNo: 2},
			{Type: " ", Text: "}", OldNo: 3, NewNo: 3},
		}},
		{OldStart: 10, OldLines: 1, NewStart: 10, NewLines: 2, Lines: []DiffLine{
			{Type: "-", Text: "x", OldNo: 10},
			{Type: "+", Text: "y", NewNo: 10},
			{Type: "+", Text: "z", NewNo: 11, NoNewline: true},
		}},
	}
	if !reflect.DeepEqual(hunks, want) {
		t.Errorf("got  %+v\nwant %+v", hunks, want)
	}
}

func TestParsePatchBinaryAndStatuses(t *testing.T) {
	status, binary, hunks, err := parsePatch([]byte("diff --git a a\nnew file mode 100644\nindex 0..1\nBinary files /dev/null and a differ\n"))
	if err != nil || status != StatusAdded || !binary || len(hunks) != 0 {
		t.Errorf("binary add: %s %v %d %v", status, binary, len(hunks), err)
	}
	status, _, _, _ = parsePatch([]byte("diff --git a a\ndeleted file mode 100644\n--- a\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n"))
	if status != StatusDeleted {
		t.Errorf("deleted: %s", status)
	}
	if _, _, _, err := parsePatch([]byte("@@ garbage @@\n")); err == nil {
		t.Error("malformed hunk header accepted")
	}
	// Empty-context hunk lines: an empty context line is " " which the scanner keeps.
	_, _, hunks, err = parsePatch([]byte("--- a\n+++ b\n@@ -1,2 +1,2 @@\n \n-a\n+b\n"))
	if err != nil || len(hunks) != 1 || len(hunks[0].Lines) != 3 || hunks[0].Lines[0].Text != "" {
		t.Errorf("empty context line: %+v %v", hunks, err)
	}
}

func TestSplitLines(t *testing.T) {
	cases := map[string][]string{"": {}, "a": {"a"}, "a\n": {"a"}, "a\nb": {"a", "b"}, "a\n\n": {"a", ""}, "\n": {""}}
	for in, want := range cases {
		if got := splitLines([]byte(in)); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}

func TestCheckPath(t *testing.T) {
	for _, bad := range []string{"", "-x", "/etc/passwd", "../x", "a/../b", "a\x00b"} {
		if err := checkPath(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	for _, ok := range []string{"a", "a/b.txt", "name with spaces.txt", "unicodé.txt", "..hidden", "a/..b"} {
		if err := checkPath(ok); err != nil {
			t.Errorf("rejected %q: %v", ok, err)
		}
	}
}

func TestFileDiffFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()

	// rename with edit at c3, full content on both sides
	fd, err := repo.FileDiff(ctx, Selection{Commit: "v0.1.0"}, "src/utils.ts", "src/util.ts", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if fd.Status != StatusRenamed || fd.Binary || !fd.HasOld || !fd.HasNew || fd.Truncated {
		t.Errorf("rename fd = %+v", fd)
	}
	if len(fd.Hunks) != 1 || len(fd.Hunks[0].Lines) != 4 || fd.Hunks[0].Lines[1].Type != "-" || fd.Hunks[0].Lines[2].Text != "  return `hi ${name}`;" {
		t.Errorf("rename hunks = %+v", fd.Hunks)
	}
	if len(fd.Old) != 3 || len(fd.New) != 3 || fd.Old[1] != "  return `hello ${name}`;" {
		t.Errorf("rename content old=%q new=%q", fd.Old, fd.New)
	}

	// deleted file: no new side
	fd, err = repo.FileDiff(ctx, Selection{Commit: "v0.1.0"}, "lib/helper.py", "", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if fd.Status != StatusDeleted || fd.HasNew || !fd.HasOld || fd.New != nil || len(fd.Old) != 2 {
		t.Errorf("deleted fd = %+v", fd)
	}

	// binary
	fd, err = repo.FileDiff(ctx, Selection{Commit: "main~3"}, "assets/logo.png", "", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if !fd.Binary || fd.Status != StatusAdded || fd.Old != nil || fd.New != nil || fd.NewSize == 0 {
		t.Errorf("binary fd = %+v", fd)
	}

	// submodule
	fd, err = repo.FileDiff(ctx, Selection{Commit: "main~1"}, "vendor/sub", "", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if !fd.Submodule || len(fd.Hunks) != 1 || !strings.HasPrefix(fd.Hunks[0].Lines[0].Text, "Subproject commit") || fd.New != nil {
		t.Errorf("submodule fd = %+v", fd)
	}

	// root commit: old side is the empty tree
	fd, err = repo.FileDiff(ctx, Selection{Commit: "main~4"}, "README.md", "", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if fd.Status != StatusAdded || fd.HasOld || len(fd.New) != 2 {
		t.Errorf("root fd = %+v", fd)
	}

	// range with merge base
	fd, err = repo.FileDiff(ctx, Selection{From: "main", To: "feature", MergeBase: true}, "src/feature.ts", "", FileDiffOptions{Context: 3})
	if err != nil || fd.Status != StatusAdded || len(fd.Hunks) != 1 {
		t.Errorf("range fd = %+v err=%v", fd, err)
	}

	// context and whitespace options
	fd, err = repo.FileDiff(ctx, Selection{Commit: "v0.1.0"}, "src/app.ts", "", FileDiffOptions{Context: 0})
	if err != nil || fd.Hunks[0].OldLines != 1 || len(fd.Hunks[0].Lines) != 2 {
		t.Errorf("U0 fd = %+v err=%v", fd.Hunks, err)
	}
	fd, err = repo.FileDiff(ctx, Selection{Commit: "v0.1.0"}, "src/app.ts", "", FileDiffOptions{Context: 3, IgnoreWhitespace: true})
	if err != nil || len(fd.Hunks) != 1 {
		t.Errorf("-w fd = %+v err=%v", fd, err)
	}

	// errors
	if _, err := repo.FileDiff(ctx, Selection{Commit: "main"}, "../etc", "", FileDiffOptions{Context: 3}); !errors.Is(err, ErrBadRef) {
		t.Errorf("path traversal: %v", err)
	}
	if _, err := repo.FileDiff(ctx, Selection{Commit: "main", Worktree: ModeAll}, "x", "", FileDiffOptions{Context: 3}); !errors.Is(err, ErrBadSelection) {
		t.Errorf("ambiguous selection: %v", err)
	}
	fd, err = repo.FileDiff(ctx, Selection{Commit: "main"}, "does/not/exist", "", FileDiffOptions{Context: 3})
	if err != nil || len(fd.Hunks) != 0 || fd.HasOld || fd.HasNew {
		t.Errorf("missing path should be an empty diff: %+v %v", fd, err)
	}
}

func TestFileDiffWorktreeFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()

	staged, err := repo.FileDiff(ctx, Selection{Worktree: ModeStaged}, "README.md", "", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(staged.Hunks) != 1 || staged.Hunks[0].Lines[len(staged.Hunks[0].Lines)-1].Text != "Staged line." {
		t.Errorf("staged = %+v", staged.Hunks)
	}
	if staged.New[len(staged.New)-1] != "Staged line." || len(staged.Old) != 2 {
		t.Errorf("staged content old=%q new=%q", staged.Old, staged.New)
	}

	unstaged, err := repo.FileDiff(ctx, Selection{Worktree: ModeUnstaged}, "src/app.ts", "", FileDiffOptions{Context: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(unstaged.Hunks) != 1 || unstaged.Hunks[0].Lines[len(unstaged.Hunks[0].Lines)-1].Text != "// unstaged edit" {
		t.Errorf("unstaged = %+v", unstaged.Hunks)
	}
	// staged view of an unstaged-only file is empty
	none, err := repo.FileDiff(ctx, Selection{Worktree: ModeStaged}, "src/app.ts", "", FileDiffOptions{Context: 3})
	if err != nil || len(none.Hunks) != 0 || !none.HasOld || !none.HasNew {
		t.Errorf("staged app.ts = %+v err=%v", none, err)
	}

	for _, mode := range []WorktreeMode{ModeUntracked, ModeAll} {
		un, err := repo.FileDiff(ctx, Selection{Worktree: mode}, "notes.txt", "", FileDiffOptions{Context: 3})
		if err != nil {
			t.Fatal(err)
		}
		if un.Status != StatusUntracked || un.HasOld || !un.HasNew || len(un.Hunks) != 1 || un.Hunks[0].Lines[0].Text != "scratch" || un.Hunks[0].Lines[0].NewNo != 1 || len(un.New) != 1 {
			t.Errorf("%s notes.txt = %+v", mode, un)
		}
	}
	if _, err := repo.FileDiff(ctx, Selection{Worktree: ModeUntracked}, "missing.txt", "", FileDiffOptions{Context: 3}); err == nil {
		t.Error("missing untracked file accepted")
	}
}
