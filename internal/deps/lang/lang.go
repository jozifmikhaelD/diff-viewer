// Package lang extracts import specifiers from source files and resolves them
// to repository paths.
package lang

import (
	"path"
	"strings"
)

// Tree answers existence questions about the snapshot being indexed.
type Tree interface {
	Exists(p string) bool
	// InDir lists files directly inside dir (repo-relative, forward slashes).
	InDir(dir string) []string
	// Read returns file content for languages that need to inspect other files
	// (tsconfig, go.mod, Java package declarations). May return nil.
	Read(p string) []byte
}

// Resolver handles one language family.
type Resolver interface {
	// Handles reports whether the resolver owns this file.
	Handles(p string) bool
	// Imports returns repo paths imported by file p with content src.
	// Unresolvable (external) specifiers are dropped.
	Imports(p string, src []byte, t Tree) []string
}

// All returns every resolver in priority order.
func All() []Resolver {
	return []Resolver{&TypeScript{}, &Python{}, &Go{}, &Java{}}
}

// For finds the resolver owning p, if any.
func For(p string, rs []Resolver) Resolver {
	for _, r := range rs {
		if r.Handles(p) {
			return r
		}
	}
	return nil
}

func ext(p string) string { return strings.ToLower(path.Ext(p)) }

// cleanJoin joins and normalises, refusing to escape the repo root.
func cleanJoin(dir, rel string) (string, bool) {
	p := path.Clean(path.Join(dir, rel))
	if p == ".." || strings.HasPrefix(p, "../") {
		return "", false
	}
	if p == "." {
		p = ""
	}
	return p, true
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := in[:0]
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
