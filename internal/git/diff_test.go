package git

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseRaw(t *testing.T) {
	out := z(
		":000000 100644 0000000 1111111 A", "new file.txt",
		":100644 100644 1111111 2222222 M", "src/app.ts",
		":100644 000000 1111111 0000000 D", "lib/helper.py",
		":100644 100644 1111111 3333333 R064", "src/util.ts", "src/utils.ts",
		":100644 100644 1111111 1111111 C100", "a.txt", "b.txt",
		":100644 120000 1111111 4444444 T", "link",
		":000000 160000 0000000 5555555 A", "vendor/sub",
		":100644 100644 1111111 1111111 U", "conflict.ts",
	)
	got, err := parseRaw(out)
	if err != nil {
		t.Fatal(err)
	}
	want := []FileChange{
		{Path: "new file.txt", Status: StatusAdded, OldMode: "000000", NewMode: "100644"},
		{Path: "src/app.ts", Status: StatusModified, OldMode: "100644", NewMode: "100644"},
		{Path: "lib/helper.py", Status: StatusDeleted, OldMode: "100644", NewMode: "000000"},
		{Path: "src/utils.ts", OldPath: "src/util.ts", Status: StatusRenamed, Similarity: 64, OldMode: "100644", NewMode: "100644"},
		{Path: "b.txt", OldPath: "a.txt", Status: StatusCopied, Similarity: 100, OldMode: "100644", NewMode: "100644"},
		{Path: "link", Status: StatusTypeChng, OldMode: "100644", NewMode: "120000"},
		{Path: "vendor/sub", Status: StatusAdded, Submodule: true, OldMode: "000000", NewMode: "160000"},
		{Path: "conflict.ts", Status: StatusUnmerged, OldMode: "100644", NewMode: "100644"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestParseRawMalformed(t *testing.T) {
	for _, in := range [][]byte{z("garbage", "p"), z(":100644 100644 1 2 R050", "only-old")} {
		if _, err := parseRaw(in); err == nil {
			t.Errorf("accepted %q", in)
		}
	}
}

func TestParseNumstat(t *testing.T) {
	out := z("3\t1\tsrc/app.ts", "-\t-\tassets/logo.png", "1\t1\t", "src/util.ts", "src/utils.ts", "0\t2\tname with spaces.txt")
	got, err := parseNumstat(out)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]numstat{
		"src/app.ts":           {add: 3, del: 1},
		"assets/logo.png":      {binary: true},
		"src/utils.ts":         {add: 1, del: 1},
		"name with spaces.txt": {del: 2},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v want %+v", got, want)
	}
	if _, err := parseNumstat(z("1\t2")); err == nil {
		t.Error("accepted malformed record")
	}
}

func TestCountLines(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, data []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	cases := []struct {
		data   []byte
		lines  int
		binary bool
	}{
		{[]byte(""), 0, false},
		{[]byte("one\n"), 1, false},
		{[]byte("one\ntwo"), 2, false},
		{[]byte("a\nb\nc\n"), 3, false},
		{[]byte("\x89PNG\x00\x00"), 0, true},
	}
	for i, c := range cases {
		lines, binary, err := countLines(write(string(rune('a'+i)), c.data))
		if err != nil || lines != c.lines || binary != c.binary {
			t.Errorf("%q: lines=%d binary=%v err=%v; want %d %v", c.data, lines, binary, err, c.lines, c.binary)
		}
	}
}

func byPath(files []FileChange) map[string]FileChange {
	m := map[string]FileChange{}
	for _, f := range files {
		m[f.Path] = f
	}
	return m
}

func TestDiffCommitFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()

	// c3: rename with edit, delete, adds with odd names
	c3, err := repo.DiffCommit(ctx, "v0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if c3.Totals != (Totals{Files: 5, Additions: 4, Deletions: 4}) {
		t.Errorf("c3 totals = %+v", c3.Totals)
	}
	files := byPath(c3.Files)
	if f := files["src/utils.ts"]; f.Status != StatusRenamed || f.OldPath != "src/util.ts" || f.Additions != 1 || f.Deletions != 1 || f.Similarity == 0 {
		t.Errorf("rename = %+v", f)
	}
	if f := files["lib/helper.py"]; f.Status != StatusDeleted || f.Deletions != 2 {
		t.Errorf("delete = %+v", f)
	}
	if f := files["unicodé.txt"]; f.Status != StatusAdded || f.Additions != 1 {
		t.Errorf("unicode add = %+v", f)
	}
	if _, ok := files["name with spaces.txt"]; !ok {
		t.Error("spaced path missing")
	}
	if c3.From == "" || c3.To == "" || len(c3.To) != 40 {
		t.Errorf("from/to = %q/%q", c3.From, c3.To)
	}

	// c2: binary file
	c2, err := repo.DiffCommit(ctx, "main~3")
	if err != nil {
		t.Fatal(err)
	}
	if f := byPath(c2.Files)["assets/logo.png"]; !f.Binary || f.Status != StatusAdded || f.Additions != 0 {
		t.Errorf("binary = %+v", f)
	}

	// root commit vs empty tree
	root, err := repo.DiffCommit(ctx, "main~4")
	if err != nil {
		t.Fatal(err)
	}
	empty, _ := repo.EmptyTree(ctx)
	if root.From != empty || root.Totals.Files != 4 || root.Totals.Deletions != 0 {
		t.Errorf("root = from %s totals %+v", root.From, root.Totals)
	}

	// submodule commit
	c4, err := repo.DiffCommit(ctx, "main~1")
	if err != nil {
		t.Fatal(err)
	}
	if f := byPath(c4.Files)["vendor/sub"]; !f.Submodule || f.Status != StatusAdded {
		t.Errorf("submodule = %+v", f)
	}

	// merge commit: against first parent only
	m1, err := repo.DiffCommit(ctx, "main")
	if err != nil {
		t.Fatal(err)
	}
	if m1.Totals.Files != 1 || m1.Files[0].Path != "topic.txt" {
		t.Errorf("merge = %+v", m1.Files)
	}

	if _, err := repo.DiffCommit(ctx, "nope"); err == nil {
		t.Error("unknown rev accepted")
	}
	if _, err := repo.DiffCommit(ctx, "--all"); !errors.Is(err, ErrBadRef) {
		t.Errorf("flag rev: %v", err)
	}
}

func TestDiffRangeFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()

	// feature vs main with merge-base: only the two feature commits
	tri, err := repo.DiffRange(ctx, "main", "feature", true)
	if err != nil {
		t.Fatal(err)
	}
	files := byPath(tri.Files)
	if len(files) != 2 || files["src/feature.ts"].Status != StatusAdded || files["README.md"].Additions != 1 {
		t.Errorf("feature...main = %+v", tri.Files)
	}
	c2, _ := repo.ResolveCommit(ctx, "main~3")
	if tri.From != c2 {
		t.Errorf("merge base = %s, want c2 %s", tri.From, c2)
	}

	// plain two-dot: everything different between the tips
	two, err := repo.DiffRange(ctx, "main", "feature", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(two.Files) <= len(tri.Files) {
		t.Errorf("two-dot should include reverted main work: %+v", two.Files)
	}
	if _, err := repo.DiffRange(ctx, "main", "nope", false); err == nil {
		t.Error("unknown rev accepted")
	}
}

func TestDiffWorktreeFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()
	head, _ := repo.ResolveCommit(ctx, "HEAD")

	staged, err := repo.DiffWorktree(ctx, ModeStaged)
	if err != nil {
		t.Fatal(err)
	}
	if staged.From != head || staged.To != "" || len(staged.Files) != 1 || staged.Files[0].Path != "README.md" || staged.Files[0].Additions != 1 {
		t.Errorf("staged = %+v", staged)
	}
	unstaged, err := repo.DiffWorktree(ctx, ModeUnstaged)
	if err != nil {
		t.Fatal(err)
	}
	if unstaged.From != "" || len(unstaged.Files) != 1 || unstaged.Files[0].Path != "src/app.ts" {
		t.Errorf("unstaged = %+v", unstaged)
	}
	untracked, err := repo.DiffWorktree(ctx, ModeUntracked)
	if err != nil {
		t.Fatal(err)
	}
	if len(untracked.Files) != 1 || untracked.Files[0].Path != "notes.txt" || untracked.Files[0].Status != StatusUntracked || untracked.Files[0].Additions != 1 {
		t.Errorf("untracked = %+v", untracked.Files)
	}
	all, err := repo.DiffWorktree(ctx, ModeAll)
	if err != nil {
		t.Fatal(err)
	}
	if all.Totals != (Totals{Files: 3, Additions: 3}) {
		t.Errorf("all totals = %+v files %+v", all.Totals, all.Files)
	}
	if _, err := repo.DiffWorktree(ctx, "bogus"); !errors.Is(err, ErrBadMode) {
		t.Errorf("bad mode: %v", err)
	}
}
