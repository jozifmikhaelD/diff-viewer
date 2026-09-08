package lang

import (
	"encoding/json"
	"path"
	"regexp"
	"strings"
	"sync"
)

// TypeScript resolves ES module and CommonJS imports for TS/JS files,
// honouring relative paths, index files, .js→.ts rewrites, and tsconfig
// baseUrl/paths aliases from the nearest tsconfig.json.
type TypeScript struct {
	mu      sync.Mutex
	configs map[string]*tsconfig // dir -> parsed config (nil when absent)
}

var tsExts = map[string]bool{".ts": true, ".tsx": true, ".mts": true, ".cts": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true, ".vue": true, ".svelte": true}

var tsCandidates = []string{".ts", ".tsx", ".d.ts", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".vue", ".svelte"}

var (
	reImportFrom = regexp.MustCompile(`(?m)\b(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},$]*?)\s*from\s*['"]([^'"\n]+)['"]`)
	reImportBare = regexp.MustCompile(`(?m)\bimport\s*['"]([^'"\n]+)['"]`)
	reImportCall = regexp.MustCompile(`\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)`)
	reRequire    = regexp.MustCompile(`\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)`)
	reTSComments = regexp.MustCompile(`(?s:/\*.*?\*/)|(?m:^[ \t]*//[^\n]*)`)
)

func (t *TypeScript) Handles(p string) bool { return tsExts[ext(p)] }

func (t *TypeScript) Imports(p string, src []byte, tree Tree) []string {
	code := reTSComments.ReplaceAllString(string(src), "")
	var specs []string
	for _, re := range []*regexp.Regexp{reImportFrom, reImportBare, reImportCall, reRequire} {
		for _, m := range re.FindAllStringSubmatch(code, -1) {
			specs = append(specs, m[1])
		}
	}
	dir := path.Dir(p)
	if dir == "." {
		dir = ""
	}
	var out []string
	for _, spec := range dedupe(specs) {
		if r, ok := t.resolve(dir, spec, tree); ok {
			out = append(out, r)
		}
	}
	return dedupe(out)
}

func (t *TypeScript) resolve(fromDir, spec string, tree Tree) (string, bool) {
	spec = strings.SplitN(spec, "?", 2)[0] // vite-style suffixes
	if strings.HasPrefix(spec, ".") {
		base, ok := cleanJoin(fromDir, spec)
		if !ok {
			return "", false
		}
		return resolveTSFile(base, tree)
	}
	if strings.HasPrefix(spec, "/") {
		return "", false
	}
	cfg := t.configFor(fromDir, tree)
	if cfg == nil {
		return "", false
	}
	for _, target := range cfg.expand(spec) {
		if r, ok := resolveTSFile(target, tree); ok {
			return r, true
		}
	}
	return "", false
}

// resolveTSFile tries the path as-is, with extensions, .js→.ts rewrites, and as a directory index.
func resolveTSFile(base string, tree Tree) (string, bool) {
	if base == "" {
		return "", false
	}
	if tree.Exists(base) && !isDirLike(base, tree) {
		return base, true
	}
	e := ext(base)
	if e == ".js" || e == ".jsx" || e == ".mjs" || e == ".cjs" {
		stem := strings.TrimSuffix(base, path.Ext(base))
		for _, c := range []string{".ts", ".tsx", ".mts", ".cts"} {
			if tree.Exists(stem + c) {
				return stem + c, true
			}
		}
	}
	for _, c := range tsCandidates {
		if tree.Exists(base + c) {
			return base + c, true
		}
	}
	for _, c := range tsCandidates {
		idx := path.Join(base, "index"+c)
		if tree.Exists(idx) {
			return idx, true
		}
	}
	return "", false
}

func isDirLike(p string, tree Tree) bool { return len(tree.InDir(p)) > 0 }

type tsconfig struct {
	hasBase bool
	baseURL string              // repo-relative dir ("" = repo root when hasBase)
	paths   map[string][]string // pattern -> targets (repo-relative)
}

// configFor finds the nearest tsconfig.json (or jsconfig.json) at or above dir.
func (t *TypeScript) configFor(dir string, tree Tree) *tsconfig {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.configs == nil {
		t.configs = map[string]*tsconfig{}
	}
	if cfg, ok := t.configs[dir]; ok {
		return cfg
	}
	var cfg *tsconfig
	d := dir
	for {
		for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
			p := path.Join(d, name)
			if d == "" {
				p = name
			}
			if tree.Exists(p) {
				cfg = parseTSConfig(d, tree.Read(p), tree)
				break
			}
		}
		if cfg != nil || d == "" {
			break
		}
		d = path.Dir(d)
		if d == "." {
			d = ""
		}
	}
	t.configs[dir] = cfg
	return cfg
}

var reJSONComments = regexp.MustCompile(`(?s:/\*.*?\*/)|//[^\n"]*`)
var reTrailingComma = regexp.MustCompile(`,\s*([}\]])`)

func parseTSConfig(dir string, raw []byte, tree Tree) *tsconfig {
	clean := reTrailingComma.ReplaceAllString(reJSONComments.ReplaceAllString(string(raw), ""), "$1")
	var doc struct {
		Extends         string `json:"extends"`
		CompilerOptions struct {
			BaseURL string              `json:"baseUrl"`
			Paths   map[string][]string `json:"paths"`
		} `json:"compilerOptions"`
	}
	if err := json.Unmarshal([]byte(clean), &doc); err != nil {
		return &tsconfig{}
	}
	cfg := &tsconfig{paths: map[string][]string{}}
	if doc.Extends != "" && strings.HasPrefix(doc.Extends, ".") {
		if parentPath, ok := cleanJoin(dir, doc.Extends); ok {
			if !strings.HasSuffix(parentPath, ".json") {
				parentPath += ".json"
			}
			if tree.Exists(parentPath) {
				parent := parseTSConfig(path.Dir(parentPath), tree.Read(parentPath), tree)
				if parent != nil {
					cfg.hasBase, cfg.baseURL = parent.hasBase, parent.baseURL
					for k, v := range parent.paths {
						cfg.paths[k] = v
					}
				}
			}
		}
	}
	base := dir
	if doc.CompilerOptions.BaseURL != "" {
		if b, ok := cleanJoin(dir, doc.CompilerOptions.BaseURL); ok {
			cfg.hasBase, cfg.baseURL = true, b
			base = b
		}
	} else if cfg.hasBase {
		base = cfg.baseURL
	}
	for pattern, targets := range doc.CompilerOptions.Paths {
		var resolved []string
		for _, tg := range targets {
			if r, ok := cleanJoin(base, tg); ok {
				resolved = append(resolved, r)
			}
		}
		cfg.paths[pattern] = resolved
	}
	return cfg
}

// expand maps a bare specifier through paths aliases and baseUrl.
func (c *tsconfig) expand(spec string) []string {
	var out []string
	for pattern, targets := range c.paths {
		if star := strings.Index(pattern, "*"); star >= 0 {
			prefix, suffix := pattern[:star], pattern[star+1:]
			if strings.HasPrefix(spec, prefix) && strings.HasSuffix(spec, suffix) && len(spec) >= len(prefix)+len(suffix) {
				mid := spec[len(prefix) : len(spec)-len(suffix)]
				for _, tg := range targets {
					out = append(out, strings.Replace(tg, "*", mid, 1))
				}
			}
		} else if pattern == spec {
			out = append(out, targets...)
		}
	}
	if c.hasBase {
		if p, ok := cleanJoin(c.baseURL, spec); ok {
			out = append(out, p)
		}
	}
	return out
}
