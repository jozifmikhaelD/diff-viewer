package deps

import (
	"context"
	"path"
	"sort"
	"strings"
	"sync"

	"github.com/jozifmikhaelD/diff-viewer/internal/deps/lang"
)

// Index is the import graph of one snapshot.
type Index struct {
	Key       string
	Files     map[string]bool
	Imports   map[string][]string // file -> files it imports
	Importers map[string][]string // file -> files importing it
}

func newIndex(key string) *Index {
	return &Index{Key: key, Files: map[string]bool{}, Imports: map[string][]string{}, Importers: map[string][]string{}}
}

// Indexer builds Index values with a small cache keyed by tree hash.
type Indexer struct {
	mu    sync.Mutex
	cache map[string]*Index
	order []string // insertion order for eviction
	max   int
}

// NewIndexer creates an Indexer caching up to n snapshots.
func NewIndexer(n int) *Indexer {
	if n <= 0 {
		n = 8
	}
	return &Indexer{cache: map[string]*Index{}, max: n}
}

// Cached returns a cached index for key, if any.
func (ix *Indexer) Cached(key string) *Index {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	return ix.cache[key]
}

func (ix *Indexer) store(idx *Index) {
	if idx.Key == "" {
		return
	}
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if _, ok := ix.cache[idx.Key]; !ok {
		ix.order = append(ix.order, idx.Key)
		for len(ix.order) > ix.max {
			delete(ix.cache, ix.order[0])
			ix.order = ix.order[1:]
		}
	}
	ix.cache[idx.Key] = idx
}

// Build indexes src, reusing a cached snapshot when available.
func (ix *Indexer) Build(ctx context.Context, src Source) (*Index, error) {
	if key := src.Key(); key != "" {
		if idx := ix.Cached(key); idx != nil {
			return idx, nil
		}
	}
	files, err := src.Files(ctx)
	if err != nil {
		return nil, err
	}
	idx := newIndex(src.Key())
	tree := newTreeView(ctx, src, files)
	resolvers := lang.All()

	// Read all handled files up front, in one process when the source allows it.
	var handled []string
	for _, f := range files {
		idx.Files[f] = true
		if lang.For(f, resolvers) != nil {
			handled = append(handled, f)
		}
	}
	if rs, ok := src.(*RevSource); ok {
		const batch = 500
		for i := 0; i < len(handled); i += batch {
			end := min(i+batch, len(handled))
			blobs, err := rs.ReadMany(ctx, handled[i:end])
			if err != nil {
				return nil, err
			}
			for p, data := range blobs {
				tree.prime(p, data)
			}
		}
	}
	for _, f := range handled {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		r := lang.For(f, resolvers)
		imports := r.Imports(f, tree.Read(f), tree)
		sort.Strings(imports)
		idx.Imports[f] = imports
		for _, to := range imports {
			idx.Importers[to] = append(idx.Importers[to], f)
		}
	}
	for k := range idx.Importers {
		sort.Strings(idx.Importers[k])
	}
	ix.store(idx)
	return idx, nil
}

// treeView adapts a Source to lang.Tree with directory listings and a content memo.
type treeView struct {
	ctx      context.Context
	src      Source
	exists   map[string]bool
	children map[string][]string
	mu       sync.Mutex
	content  map[string][]byte
}

func newTreeView(ctx context.Context, src Source, files []string) *treeView {
	t := &treeView{ctx: ctx, src: src, exists: map[string]bool{}, children: map[string][]string{}, content: map[string][]byte{}}
	seen := map[string]bool{}
	for _, f := range files {
		t.exists[f] = true
		child := f
		for {
			dir := path.Dir(child)
			if dir == "." {
				dir = ""
			}
			edge := dir + "\x00" + child
			if !seen[edge] {
				seen[edge] = true
				t.children[dir] = append(t.children[dir], child)
			}
			if dir == "" {
				break
			}
			child = dir
		}
	}
	for d := range t.children {
		sort.Strings(t.children[d])
	}
	return t
}

func (t *treeView) Exists(p string) bool { return t.exists[p] }

func (t *treeView) InDir(dir string) []string { return t.children[strings.TrimSuffix(dir, "/")] }

func (t *treeView) prime(p string, data []byte) {
	t.mu.Lock()
	t.content[p] = data
	t.mu.Unlock()
}

func (t *treeView) Read(p string) []byte {
	t.mu.Lock()
	data, ok := t.content[p]
	t.mu.Unlock()
	if ok {
		return data
	}
	data, _, _ = t.src.Read(t.ctx, p)
	if data == nil {
		data = []byte{}
	}
	t.prime(p, data)
	return data
}
