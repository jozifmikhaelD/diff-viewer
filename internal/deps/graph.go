package deps

import (
	"sort"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
)

// Node is a file in the dependency graph.
type Node struct {
	Path      string         `json:"path"`
	Changed   bool           `json:"changed"`
	Status    git.FileStatus `json:"status,omitempty"`
	Additions int            `json:"additions"`
	Deletions int            `json:"deletions"`
	Depth     int            `json:"depth"` // 0 for changed files
}

// Edge means From imports To.
type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Graph is the neighbourhood of a changeset.
type Graph struct {
	Nodes     []Node `json:"nodes"`
	Edges     []Edge `json:"edges"`
	Truncated bool   `json:"truncated"` // node cap reached
	Indexed   int    `json:"indexed"`   // files with resolvable imports in the snapshot
}

// BuildGraph expands from the changed files through imports and importers up
// to depth hops. cur is the index of the changeset's "to" side; old (may be
// nil) supplies edges for deleted files, whose importers are now broken.
func BuildGraph(cur, old *Index, changed []git.FileChange, depth, maxNodes int) *Graph {
	if maxNodes <= 0 {
		maxNodes = 300
	}
	g := &Graph{Nodes: []Node{}, Edges: []Edge{}, Indexed: len(cur.Imports)}
	// Old names of renamed files map to their new names so the old index's
	// edges attach to the node the user sees.
	renamed := map[string]string{}
	for _, fc := range changed {
		if fc.OldPath != "" && fc.OldPath != fc.Path {
			renamed[fc.OldPath] = fc.Path
		}
	}
	name := func(p string) string {
		if n, ok := renamed[p]; ok {
			return n
		}
		return p
	}
	byPath := map[string]int{}
	add := func(n Node) bool {
		n.Path = name(n.Path)
		if i, ok := byPath[n.Path]; ok {
			if n.Depth < g.Nodes[i].Depth {
				g.Nodes[i].Depth = n.Depth
			}
			return true
		}
		if len(g.Nodes) >= maxNodes {
			g.Truncated = true
			return false
		}
		byPath[n.Path] = len(g.Nodes)
		g.Nodes = append(g.Nodes, n)
		return true
	}
	neighbours := func(p string) []string {
		var out []string
		if cur.Files[p] {
			out = append(out, cur.Imports[p]...)
			out = append(out, cur.Importers[p]...)
		} else if old != nil && old.Files[p] {
			out = append(out, old.Imports[p]...)
			out = append(out, old.Importers[p]...)
		}
		for i := range out {
			out[i] = name(out[i])
		}
		return out
	}

	frontier := make([]string, 0, len(changed))
	for _, fc := range changed {
		add(Node{Path: fc.Path, Changed: true, Status: fc.Status, Additions: fc.Additions, Deletions: fc.Deletions})
		frontier = append(frontier, fc.Path)
		if fc.OldPath != "" && fc.OldPath != fc.Path && old != nil && old.Files[fc.OldPath] && depth > 0 {
			// importers of the old name are affected by the rename
			for _, imp := range old.Importers[fc.OldPath] {
				if _, seen := byPath[name(imp)]; !seen && add(Node{Path: imp, Depth: 1}) {
					frontier = append(frontier, name(imp))
				}
			}
		}
	}
	for d := 1; d <= depth; d++ {
		var next []string
		for _, p := range frontier {
			for _, n := range neighbours(p) {
				if _, seen := byPath[n]; seen {
					continue
				}
				if add(Node{Path: n, Depth: d}) {
					next = append(next, n)
				}
			}
		}
		frontier = next
	}

	edgeSet := map[Edge]bool{}
	addEdge := func(from, to string) {
		from, to = name(from), name(to)
		_, okF := byPath[from]
		_, okT := byPath[to]
		if okF && okT && from != to {
			edgeSet[Edge{From: from, To: to}] = true
		}
	}
	for _, n := range g.Nodes {
		if cur.Files[n.Path] {
			for _, to := range cur.Imports[n.Path] {
				addEdge(n.Path, to)
			}
			continue
		}
		if old == nil {
			continue
		}
		// deleted files (and old names of renamed ones): edges come from the old index
		oldName := n.Path
		for o, nn := range renamed {
			if nn == n.Path {
				oldName = o
			}
		}
		for _, to := range old.Imports[oldName] {
			addEdge(n.Path, to)
		}
		for _, from := range old.Importers[oldName] {
			addEdge(from, n.Path)
		}
	}
	for e := range edgeSet {
		g.Edges = append(g.Edges, e)
	}
	sort.Slice(g.Edges, func(i, j int) bool {
		if g.Edges[i].From != g.Edges[j].From {
			return g.Edges[i].From < g.Edges[j].From
		}
		return g.Edges[i].To < g.Edges[j].To
	})
	return g
}
