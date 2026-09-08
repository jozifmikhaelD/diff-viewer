package api

import (
	"net/http"
	"testing"
	"testing/fstest"

	"void/internal/deps"
)

func paths(g deps.Graph) []string {
	var out []string
	for _, n := range g.Nodes {
		out = append(out, n.Path)
	}
	return out
}

func TestDepsEndpoint(t *testing.T) {
	s := newTestServer(t, fstest.MapFS{})

	// feature branch vs main: feature.ts (added) imports app.ts (unchanged neighbour)
	g := decode[deps.Graph](t, get(t, s, "/api/deps?from=main&to=feature&mergeBase=1&depth=1"), http.StatusOK)
	var hasApp, hasEdge bool
	for _, n := range g.Nodes {
		hasApp = hasApp || (n.Path == "src/app.ts" && !n.Changed && n.Depth == 1)
	}
	for _, e := range g.Edges {
		hasEdge = hasEdge || (e.From == "src/feature.ts" && e.To == "src/app.ts")
	}
	if !hasApp || !hasEdge || len(g.Nodes) != 3 {
		t.Errorf("feature graph = %+v", g)
	}

	// depth 0: changed files only, no edges to outsiders
	g0 := decode[deps.Graph](t, get(t, s, "/api/deps?from=main&to=feature&mergeBase=1&depth=0"), http.StatusOK)
	if len(g0.Nodes) != 2 || len(g0.Edges) != 0 {
		t.Errorf("depth0 = %+v", g0)
	}

	// c3 renamed util->utils and app.ts was updated in the same commit: edge app->utils
	c3 := decode[deps.Graph](t, get(t, s, "/api/deps?commit=v0.1.0"), http.StatusOK)
	var appToUtils bool
	for _, e := range c3.Edges {
		appToUtils = appToUtils || (e.From == "src/app.ts" && e.To == "src/utils.ts")
	}
	if !appToUtils || len(c3.Nodes) != 5 {
		t.Errorf("c3 graph = %v edges %v", paths(c3), c3.Edges)
	}

	// working tree: app.ts has an unstaged edit; it imports utils.ts (neighbour)
	wt := decode[deps.Graph](t, get(t, s, "/api/deps?worktree=all"), http.StatusOK)
	var utilsNeighbour bool
	for _, n := range wt.Nodes {
		utilsNeighbour = utilsNeighbour || (n.Path == "src/utils.ts" && n.Depth == 1)
	}
	if !utilsNeighbour {
		t.Errorf("worktree graph = %v", paths(wt))
	}

	for target, want := range map[string]int{
		"/api/deps?commit=main&depth=5": http.StatusBadRequest,
		"/api/deps":                     http.StatusBadRequest,
		"/api/deps?commit=nope":         http.StatusNotFound,
	} {
		if rec := get(t, s, target); rec.Code != want {
			t.Errorf("%s: %d want %d: %s", target, rec.Code, want, rec.Body.String())
		}
	}
}
