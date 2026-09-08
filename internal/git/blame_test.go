package git

import (
	"context"
	"strings"
	"testing"
)

func TestParseBlame(t *testing.T) {
	sha1 := strings.Repeat("a", 40)
	sha2 := strings.Repeat("b", 40)
	out := strings.Join([]string{
		sha1 + " 1 1 2",
		"author Ann", "author-mail <ann@x>", "author-time 1700000000", "author-tz +0000",
		"committer Ann", "committer-mail <ann@x>", "committer-time 1700000000", "committer-tz +0000",
		"summary first commit", "filename f.txt",
		"\tline one",
		sha1 + " 2 2",
		"\tline two",
		sha2 + " 1 3 1",
		"author Bob", "author-mail <bob@x>", "author-time 1700000600", "author-tz +0000",
		"committer Bob", "committer-mail <bob@x>", "committer-time 1700000600", "committer-tz +0000",
		"summary second", "previous " + sha1 + " f.txt", "filename f.txt",
		"\tline three",
		uncommittedSHA + " 4 4 1",
		"author Not Committed Yet", "author-mail <not.committed.yet>", "author-time 1700001200", "author-tz +0000",
		"committer Not Committed Yet", "committer-mail <not.committed.yet>", "committer-time 1700001200", "committer-tz +0000",
		"summary Version of f.txt from f.txt", "previous " + sha2 + " f.txt", "filename f.txt",
		"\tline four",
	}, "\n") + "\n"
	b, err := parseBlame([]byte(out))
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Lines) != 4 || b.Lines[0] != sha1 || b.Lines[1] != sha1 || b.Lines[2] != sha2 || b.Lines[3] != uncommittedSHA {
		t.Errorf("lines = %v", b.Lines)
	}
	if c := b.Commits[sha1]; c.Author != "Ann" || c.Email != "ann@x" || c.Time != 1700000000 || c.Summary != "first commit" {
		t.Errorf("sha1 = %+v", c)
	}
	if c := b.Commits[sha2]; c.Author != "Bob" || c.Summary != "second" {
		t.Errorf("sha2 = %+v", c)
	}
	if c := b.Commits[uncommittedSHA]; !c.Uncommitted || c.Author != "You" || c.Summary != "Uncommitted changes" {
		t.Errorf("uncommitted = %+v", c)
	}
	if _, err := parseBlame([]byte(sha1 + " x y\n")); err == nil {
		t.Error("bad header accepted")
	}
}

func TestBlameFixture(t *testing.T) {
	repo, _ := openFixture(t)
	ctx := context.Background()

	// utils.ts at c3: line 2 changed in c3, lines 1 and 3 from c1 (rename followed)
	b, err := repo.BlameFile(ctx, Selection{Commit: "v0.1.0"}, "src/utils.ts")
	if err != nil {
		t.Fatal(err)
	}
	c3, _ := repo.ResolveCommit(ctx, "v0.1.0")
	c1, _ := repo.ResolveCommit(ctx, "main~4")
	if len(b.Lines) != 3 || b.Lines[1] != c3 || b.Lines[0] != c1 || b.Lines[2] != c1 {
		t.Errorf("blame lines = %v (c1=%s c3=%s)", b.Lines, c1, c3)
	}
	if b.Commits[c3].Summary != "c3: rename util, drop python helper, odd filenames" || b.Commits[c3].Author != "Fixture Author" || b.Rev != c3 {
		t.Errorf("c3 = %+v rev=%s", b.Commits[c3], b.Rev)
	}

	// working tree: the staged README line is uncommitted
	wb, err := repo.BlameFile(ctx, Selection{Worktree: ModeAll}, "README.md")
	if err != nil {
		t.Fatal(err)
	}
	last := wb.Lines[len(wb.Lines)-1]
	if !wb.Commits[last].Uncommitted || wb.Rev != "" {
		t.Errorf("working tree blame = %+v rev=%q", wb.Commits[last], wb.Rev)
	}

	if _, err := repo.BlameFile(ctx, Selection{Commit: "main"}, "../x"); err == nil {
		t.Error("bad path accepted")
	}
	if _, err := repo.BlameFile(ctx, Selection{Commit: "main"}, "does-not-exist"); err == nil {
		t.Error("missing file accepted")
	}
}
