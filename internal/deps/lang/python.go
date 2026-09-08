package lang

import (
	"path"
	"regexp"
	"strings"
)

// Python resolves `import a.b` and `from .x import y` statements to modules
// or packages within the repository.
type Python struct{}

var (
	rePyFrom   = regexp.MustCompile(`(?m)^\s*from\s+([\w.]+)\s+import\s+([^\n#]+)`)
	rePyImport = regexp.MustCompile(`(?m)^\s*import\s+([\w.,\s]+?)(?:\s+as\s+\w+)?\s*(?:#.*)?$`)
)

func (Python) Handles(p string) bool { return ext(p) == ".py" }

func (Python) Imports(p string, src []byte, tree Tree) []string {
	code := string(src)
	dir := path.Dir(p)
	if dir == "." {
		dir = ""
	}
	var out []string
	for _, m := range rePyFrom.FindAllStringSubmatch(code, -1) {
		module, names := m[1], m[2]
		base, ok := pyModuleDir(dir, module)
		if !ok {
			continue
		}
		if r, ok := pyResolve(base, tree); ok {
			out = append(out, r)
		}
		// `from pkg import submodule` may name modules, not symbols.
		for _, n := range strings.Split(strings.Trim(strings.TrimSpace(names), "()"), ",") {
			n = strings.TrimSpace(strings.SplitN(strings.TrimSpace(n), " ", 2)[0])
			if n == "" || n == "*" {
				continue
			}
			if r, ok := pyResolve(path.Join(base, n), tree); ok {
				out = append(out, r)
			}
		}
	}
	for _, m := range rePyImport.FindAllStringSubmatch(code, -1) {
		for _, mod := range strings.Split(m[1], ",") {
			mod = strings.TrimSpace(strings.SplitN(strings.TrimSpace(mod), " ", 2)[0])
			if mod == "" {
				continue
			}
			base, ok := pyModuleDir(dir, mod)
			if !ok {
				continue
			}
			if r, ok := pyResolve(base, tree); ok {
				out = append(out, r)
			}
		}
	}
	return dedupe(out)
}

// pyModuleDir turns a dotted module into a candidate repo path. Relative
// imports are anchored to the importing file's dir; absolute ones are tried
// from the repo root (callers also try ancestor dirs via pyResolve's search).
func pyModuleDir(dir, module string) (string, bool) {
	dots := 0
	for dots < len(module) && module[dots] == '.' {
		dots++
	}
	rest := strings.ReplaceAll(module[dots:], ".", "/")
	if dots == 0 {
		return "\x00" + rest, true // marker: absolute, search source roots
	}
	up := strings.Repeat("../", dots-1)
	return cleanJoin(dir, up+rest)
}

// pyResolve finds module.py or module/__init__.py. Absolute modules are tried
// from the repo root and then from every top-level directory (common src roots).
func pyResolve(base string, tree Tree) (string, bool) {
	if strings.HasPrefix(base, "\x00") {
		rel := strings.TrimPrefix(base, "\x00")
		roots := []string{""}
		for _, top := range tree.InDir("") {
			if len(tree.InDir(top)) > 0 {
				roots = append(roots, top)
			}
		}
		for _, root := range roots {
			if r, ok := pyResolve(path.Join(root, rel), tree); ok {
				return r, true
			}
		}
		return "", false
	}
	if base == "" {
		return "", false
	}
	if tree.Exists(base + ".py") {
		return base + ".py", true
	}
	if init := path.Join(base, "__init__.py"); tree.Exists(init) {
		return init, true
	}
	return "", false
}
