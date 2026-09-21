package deps

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
	"github.com/jozifmikhaelD/diff-viewer/internal/testutil"
)

func TestBuildIndexAndGraph(t *testing.T) {
	src := MapSource{
		"src/app.ts":    "import { greet } from './util';\nimport { log } from './log';",
		"src/util.ts":   "import { fmt } from './fmt';",
		"src/fmt.ts":    "",
		"src/log.ts":    "",
		"src/other.ts":  "import './fmt';",
		"README.md":     "",
		"lib/helper.py": "",
	}
	ix := NewIndexer(2)
	idx, err := ix.Build(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(idx.Imports["src/app.ts"], []string{"src/log.ts", "src/util.ts"}) {
		t.Errorf("app imports = %v", idx.Imports["src/app.ts"])
	}
	if !reflect.DeepEqual(idx.Importers["src/fmt.ts"], []string{"src/other.ts", "src/util.ts"}) {
		t.Errorf("fmt importers = %v", idx.Importers["src/fmt.ts"])
	}
	if _, ok := idx.Imports["lib/helper.py"]; !idx.Files["README.md"] || !ok {
		t.Errorf("files/imports bookkeeping: %v %v", idx.Files, idx.Imports)
	}

	changed := []git.FileChange{{Path: "src/util.ts", Status: git.StatusModified, Additions: 1, Deletions: 1}}
	g0 := BuildGraph(idx, nil, changed, 0, 0)
	if len(g0.Nodes) != 1 || len(g0.Edges) != 0 || !g0.Nodes[0].Changed {
		t.Errorf("depth0 = %+v", g0)
	}
	g1 := BuildGraph(idx, nil, changed, 1, 0)
	paths := func(g *Graph) []string {
		var out []string
		for _, n := range g.Nodes {
			out = append(out, n.Path)
		}
		return out
	}
	if !reflect.DeepEqual(paths(g1), []string{"src/util.ts", "src/fmt.ts", "src/app.ts"}) {
		t.Errorf("depth1 nodes = %v", paths(g1))
	}
	if !reflect.DeepEqual(g1.Edges, []Edge{{"src/app.ts", "src/util.ts"}, {"src/util.ts", "src/fmt.ts"}}) {
		t.Errorf("depth1 edges = %v", g1.Edges)
	}
	g2 := BuildGraph(idx, nil, changed, 2, 0)
	if len(g2.Nodes) != 5 { // + log.ts (via app) + other.ts (via fmt)
		t.Errorf("depth2 nodes = %v", paths(g2))
	}
	if g2.Nodes[len(g2.Nodes)-1].Depth != 2 || g2.Indexed != 6 {
		t.Errorf("depth/indexed = %d/%d", g2.Nodes[len(g2.Nodes)-1].Depth, g2.Indexed)
	}
	capped := BuildGraph(idx, nil, changed, 2, 2)
	if !capped.Truncated || len(capped.Nodes) != 2 {
		t.Errorf("cap = %+v", capped)
	}
}

func TestGraphUsesOldIndexForDeletedAndRenamed(t *testing.T) {
	ctx := context.Background()
	ix := NewIndexer(4)
	old, _ := ix.Build(ctx, MapSource{
		"src/app.ts":  "import { greet } from './util';",
		"src/util.ts": "import './gone';",
		"src/gone.ts": "",
	})
	cur, _ := ix.Build(ctx, MapSource{
		"src/app.ts":   "import { greet } from './utils';",
		"src/utils.ts": "",
	})
	changed := []git.FileChange{
		{Path: "src/utils.ts", OldPath: "src/util.ts", Status: git.StatusRenamed},
		{Path: "src/gone.ts", Status: git.StatusDeleted},
	}
	g := BuildGraph(cur, old, changed, 1, 0)
	var nodes []string
	for _, n := range g.Nodes {
		nodes = append(nodes, n.Path)
	}
	// app imports the renamed file (old importer of util.ts and current importer of utils.ts);
	// the old name util.ts imported gone.ts, shown against the new name.
	if !reflect.DeepEqual(nodes, []string{"src/utils.ts", "src/app.ts", "src/gone.ts"}) {
		t.Errorf("nodes = %v", nodes)
	}
	want := []Edge{{"src/app.ts", "src/utils.ts"}, {"src/utils.ts", "src/gone.ts"}}
	if !reflect.DeepEqual(g.Edges, want) {
		t.Errorf("edges = %v want %v", g.Edges, want)
	}
}

func TestIndexerCacheAndFixture(t *testing.T) {
	ctx := context.Background()
	base := testutil.Fixture(t)
	repo, err := git.Open(ctx, filepath.Join(base, "repo"))
	if err != nil {
		t.Fatal(err)
	}
	ix := NewIndexer(2)
	src, err := NewRevSource(ctx, repo, "v0.1.0")
	if err != nil {
		t.Fatal(err)
	}
	if src.Key() == "" || len(src.Key()) != 40 {
		t.Fatalf("tree key = %q", src.Key())
	}
	idx, err := ix.Build(ctx, src)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(idx.Imports["src/app.ts"], []string{"src/utils.ts"}) {
		t.Errorf("app imports at c3 = %v", idx.Imports["src/app.ts"])
	}
	if ix.Cached(src.Key()) != idx {
		t.Error("index not cached")
	}
	again, _ := ix.Build(ctx, src)
	if again != idx {
		t.Error("cache miss on identical tree")
	}
	// same tree via a different rev name shares the cache entry
	same, _ := NewRevSource(ctx, repo, "main~2")
	if same.Key() != src.Key() {
		t.Errorf("tree keys differ for identical trees: %s vs %s", same.Key(), src.Key())
	}
	// eviction keeps at most n entries
	for _, rev := range []string{"main", "feature"} {
		s, _ := NewRevSource(ctx, repo, rev)
		if _, err := ix.Build(ctx, s); err != nil {
			t.Fatal(err)
		}
	}
	if ix.Cached(src.Key()) != nil {
		t.Error("oldest entry not evicted")
	}
	// ReadMany fetches blobs in one process, reporting missing ones by omission
	feat, _ := NewRevSource(ctx, repo, "feature")
	blobs, err := feat.ReadMany(ctx, []string{"src/feature.ts", "nope.txt", "README.md"})
	if err != nil {
		t.Fatal(err)
	}
	if len(blobs) != 2 || len(blobs["src/feature.ts"]) == 0 || blobs["README.md"] == nil {
		t.Errorf("ReadMany = %d blobs", len(blobs))
	}
	fi, _ := ix.Build(ctx, feat)
	if !reflect.DeepEqual(fi.Imports["src/feature.ts"], []string{"src/app.ts"}) {
		t.Errorf("feature imports = %v", fi.Imports["src/feature.ts"])
	}
}

func TestOverlaySource(t *testing.T) {
	ctx := context.Background()
	base := testutil.Fixture(t)
	repo, _ := git.Open(ctx, filepath.Join(base, "repo"))
	head, _ := NewRevSource(ctx, repo, "HEAD")
	ov := &OverlaySource{Base: head, Root: repo.Root,
		Changed: map[string]bool{"src/app.ts": true, "notes.txt": true},
		Deleted: map[string]bool{"README.md": true}}
	files, err := ov.Files(ctx)
	if err != nil {
		t.Fatal(err)
	}
	set := map[string]bool{}
	for _, f := range files {
		set[f] = true
	}
	if set["README.md"] || !set["notes.txt"] || !set["src/app.ts"] {
		t.Errorf("files = %v", files)
	}
	data, ok, _ := ov.Read(ctx, "src/app.ts")
	if !ok || !contains(data, "// unstaged edit") {
		t.Errorf("overlay read did not come from disk: %q", data)
	}
	if _, ok, _ := ov.Read(ctx, "README.md"); ok {
		t.Error("deleted file readable")
	}
	if ov.Key() != "" {
		t.Error("overlay must not be cached")
	}
}

func contains(b []byte, s string) bool {
	return len(b) > 0 && string(b) != "" && indexOf(string(b), s) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
