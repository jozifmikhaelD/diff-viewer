package lang

import (
	"path"
	"regexp"
	"strings"
	"sync"
)

// Go resolves imports of packages inside the repository's own module(s) to
// the .go files of the imported package directory.
type Go struct {
	mu      sync.Mutex
	modules map[string]string // dir -> module path ("" when none)
}

var (
	reGoImportBlock  = regexp.MustCompile(`(?s)\bimport\s*\((.*?)\)`)
	reGoImportSingle = regexp.MustCompile(`(?m)^\s*import\s+(?:\w+\s+)?"([^"]+)"`)
	reGoQuoted       = regexp.MustCompile(`"([^"]+)"`)
	reGoModule       = regexp.MustCompile(`(?m)^module\s+(\S+)`)
)

func (g *Go) Handles(p string) bool { return ext(p) == ".go" }

func (g *Go) Imports(p string, src []byte, tree Tree) []string {
	code := string(src)
	var specs []string
	for _, m := range reGoImportBlock.FindAllStringSubmatch(code, -1) {
		for _, q := range reGoQuoted.FindAllStringSubmatch(m[1], -1) {
			specs = append(specs, q[1])
		}
	}
	for _, m := range reGoImportSingle.FindAllStringSubmatch(code, -1) {
		specs = append(specs, m[1])
	}
	dir := path.Dir(p)
	if dir == "." {
		dir = ""
	}
	modDir, modPath := g.moduleFor(dir, tree)
	if modPath == "" {
		return nil
	}
	isTest := strings.HasSuffix(p, "_test.go")
	var out []string
	for _, spec := range dedupe(specs) {
		if spec != modPath && !strings.HasPrefix(spec, modPath+"/") {
			continue
		}
		pkgDir := path.Join(modDir, strings.TrimPrefix(strings.TrimPrefix(spec, modPath), "/"))
		if pkgDir == "." {
			pkgDir = ""
		}
		for _, f := range tree.InDir(pkgDir) {
			if ext(f) != ".go" || f == p {
				continue
			}
			if !isTest && strings.HasSuffix(f, "_test.go") {
				continue
			}
			out = append(out, f)
		}
	}
	return dedupe(out)
}

// moduleFor finds the nearest go.mod at or above dir.
func (g *Go) moduleFor(dir string, tree Tree) (string, string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.modules == nil {
		g.modules = map[string]string{}
	}
	d := dir
	for {
		if mod, ok := g.modules[d]; ok {
			return d, mod
		}
		gomod := "go.mod"
		if d != "" {
			gomod = path.Join(d, "go.mod")
		}
		if tree.Exists(gomod) {
			mod := ""
			if m := reGoModule.FindSubmatch(tree.Read(gomod)); m != nil {
				mod = string(m[1])
			}
			g.modules[d] = mod
			return d, mod
		}
		if d == "" {
			g.modules[dir] = ""
			return "", ""
		}
		d = path.Dir(d)
		if d == "." {
			d = ""
		}
	}
}
