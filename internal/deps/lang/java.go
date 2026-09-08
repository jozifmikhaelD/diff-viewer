package lang

import (
	"path"
	"regexp"
	"strings"
	"sync"
)

// Java resolves `import a.b.C;` (and Kotlin imports) to files declaring
// `package a.b` whose name is C, regardless of source-root layout.
type Java struct {
	once  sync.Once
	byFQN map[string][]string // "a.b.C" -> files; "a.b" -> all files in package
}

var (
	reJavaPackage = regexp.MustCompile(`(?m)^\s*package\s+([\w.]+)\s*;?`)
	reJavaImport  = regexp.MustCompile(`(?m)^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;?`)
)

func (j *Java) Handles(p string) bool {
	e := ext(p)
	return e == ".java" || e == ".kt" || e == ".kts" || e == ".scala"
}

func (j *Java) Imports(p string, src []byte, tree Tree) []string {
	j.buildIndex(tree)
	var out []string
	for _, m := range reJavaImport.FindAllStringSubmatch(string(src), -1) {
		fqn := m[1]
		if strings.HasSuffix(fqn, ".*") {
			for _, f := range j.byFQN[strings.TrimSuffix(fqn, ".*")] {
				if f != p {
					out = append(out, f)
				}
			}
			continue
		}
		// Try the full name, then progressively shorter prefixes (static
		// member imports, nested classes).
		parts := strings.Split(fqn, ".")
		for n := len(parts); n >= 2; n-- {
			if files, ok := j.byFQN[strings.Join(parts[:n], ".")]; ok {
				for _, f := range files {
					if f != p {
						out = append(out, f)
					}
				}
				break
			}
		}
	}
	return dedupe(out)
}

// buildIndex scans every JVM source file once for its package declaration.
func (j *Java) buildIndex(tree Tree) {
	j.once.Do(func() {
		j.byFQN = map[string][]string{}
		var walk func(dir string)
		walk = func(dir string) {
			for _, f := range tree.InDir(dir) {
				if len(tree.InDir(f)) > 0 {
					walk(f)
					continue
				}
				if !j.Handles(f) {
					continue
				}
				m := reJavaPackage.FindSubmatch(tree.Read(f))
				if m == nil {
					continue
				}
				pkg := string(m[1])
				name := strings.TrimSuffix(path.Base(f), path.Ext(f))
				j.byFQN[pkg+"."+name] = append(j.byFQN[pkg+"."+name], f)
				j.byFQN[pkg] = append(j.byFQN[pkg], f)
			}
		}
		walk("")
	})
}
