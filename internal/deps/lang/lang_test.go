package lang

import (
	"path"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// mapTree is a Tree over an in-memory file map.
type mapTree map[string]string

func (m mapTree) Exists(p string) bool { _, ok := m[p]; return ok }
func (m mapTree) Read(p string) []byte { return []byte(m[p]) }
func (m mapTree) InDir(dir string) []string {
	seen := map[string]bool{}
	var out []string
	for p := range m {
		d := path.Dir(p)
		if d == "." {
			d = ""
		}
		var child string
		switch {
		case d == dir:
			child = p
		case dir == "" && d != "":
			child = strings.SplitN(p, "/", 2)[0]
		case strings.HasPrefix(d, dir+"/"):
			child = path.Join(dir, strings.SplitN(strings.TrimPrefix(p, dir+"/"), "/", 2)[0])
		default:
			continue
		}
		if !seen[child] {
			seen[child] = true
			out = append(out, child)
		}
	}
	sort.Strings(out)
	return out
}

func sorted(s []string) []string { sort.Strings(s); return s }

func TestTypeScript(t *testing.T) {
	tree := mapTree{
		"tsconfig.json":             `{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "~lib": ["lib/index.ts"] } } } // c`,
		"src/app.ts":                "import { greet } from './util';\nimport x from \"./comp/Button.js\";\nimport '@/styles/main.css';\nimport { a } from '@/services/api';\nconst y = require('./legacy.cjs');\nexport * from './types';\nimport('./lazy');\nimport react from 'react';\nimport { z } from '~lib';\nimport type { T } from './types';\n// import './commented';\n/* import './block'; */\nimport json from 'config/data.json';",
		"src/util.ts":               "",
		"src/comp/Button.tsx":       "",
		"src/styles/main.css":       "",
		"src/services/api/index.ts": "",
		"src/legacy.cjs":            "",
		"src/types.d.ts":            "",
		"src/lazy/index.tsx":        "",
		"src/commented.ts":          "",
		"lib/index.ts":              "",
		"config/data.json":          "",
		"pkg/sub/tsconfig.json":     `{ "extends": "../../tsconfig.json", "compilerOptions": { "baseUrl": ".", "paths": { "#x/*": ["./x/*"] } } }`,
		"pkg/sub/x/thing.ts":        "",
		"pkg/sub/main.ts":           "import a from '#x/thing';\nimport b from '@/util';",
	}
	ts := &TypeScript{}
	got := sorted(ts.Imports("src/app.ts", []byte(tree["src/app.ts"]), tree))
	want := []string{"config/data.json", "lib/index.ts", "src/comp/Button.tsx", "src/lazy/index.tsx", "src/legacy.cjs", "src/services/api/index.ts", "src/styles/main.css", "src/types.d.ts", "src/util.ts"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
	got = sorted(ts.Imports("pkg/sub/main.ts", []byte(tree["pkg/sub/main.ts"]), tree))
	if want := []string{"pkg/sub/x/thing.ts", "src/util.ts"}; !reflect.DeepEqual(got, want) {
		t.Errorf("nested tsconfig: got %v want %v", got, want)
	}
	if got := ts.Imports("src/util.ts", []byte("import '../../../etc/passwd';"), tree); len(got) != 0 {
		t.Errorf("escaped root: %v", got)
	}
	if !ts.Handles("a.vue") || ts.Handles("a.py") {
		t.Error("Handles wrong")
	}
}

func TestPython(t *testing.T) {
	tree := mapTree{
		"app/main.py":              "import os\nimport app.models, json\nfrom app.services import users\nfrom . import config\nfrom .helpers.text import slug\nfrom ..shared import util  # comment\nfrom app.services.users import User\nfrom typing import List",
		"app/__init__.py":          "",
		"app/models.py":            "",
		"app/config.py":            "",
		"app/helpers/text.py":      "",
		"app/services/__init__.py": "",
		"app/services/users.py":    "",
		"shared/util.py":           "",
		"src/pkg/thing.py":         "",
		"src/pkg/user.py":          "import pkg.thing\nfrom pkg import thing",
	}
	got := sorted(Python{}.Imports("app/main.py", []byte(tree["app/main.py"]), tree))
	// `from . import config` also names the package itself; `from ..shared` climbs to the repo root.
	want := []string{"app/__init__.py", "app/config.py", "app/helpers/text.py", "app/models.py", "app/services/__init__.py", "app/services/users.py", "shared/util.py"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
	if got := (Python{}).Imports("a.py", []byte("from ...nowhere import x"), mapTree{"a.py": ""}); len(got) != 0 {
		t.Errorf("escaped root: %v", got)
	}
	// src-root layout resolves via top-level dirs
	got = sorted(Python{}.Imports("src/pkg/user.py", []byte(tree["src/pkg/user.py"]), tree))
	if want := []string{"src/pkg/thing.py"}; !reflect.DeepEqual(got, want) {
		t.Errorf("src layout: got %v want %v", got, want)
	}
}

func TestGo(t *testing.T) {
	tree := mapTree{
		"go.mod":                      "module example.com/void\n\ngo 1.25\n",
		"cmd/void/main.go":            "package main\n\nimport (\n\t\"fmt\"\n\n\t\"example.com/void/internal/api\"\n\tg \"example.com/void/internal/git\"\n)\n",
		"internal/api/server.go":      "package api\nimport \"example.com/void/internal/git\"",
		"internal/api/server_test.go": "package api",
		"internal/git/git.go":         "package git",
		"internal/git/log.go":         "package git",
		"internal/git/git_test.go":    "package git\nimport \"example.com/void/internal/api\"",
		"other/nomod.go":              "package other\nimport \"example.com/void/internal/git\"",
	}
	g := &Go{}
	got := sorted(g.Imports("cmd/void/main.go", []byte(tree["cmd/void/main.go"]), tree))
	want := []string{"internal/api/server.go", "internal/git/git.go", "internal/git/log.go"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
	// test files may import test files; non-test files skip _test.go
	got = sorted(g.Imports("internal/git/git_test.go", []byte(tree["internal/git/git_test.go"]), tree))
	if want := []string{"internal/api/server.go", "internal/api/server_test.go"}; !reflect.DeepEqual(got, want) {
		t.Errorf("test import: got %v want %v", got, want)
	}
	// module resolution still works for a file under the same go.mod
	if got := g.Imports("other/nomod.go", []byte(tree["other/nomod.go"]), tree); len(got) != 2 {
		t.Errorf("same module: %v", got)
	}
	noMod := mapTree{"a.go": "package a\nimport \"x/y\""}
	if got := (&Go{}).Imports("a.go", []byte(noMod["a.go"]), noMod); len(got) != 0 {
		t.Errorf("no go.mod: %v", got)
	}
}

func TestJava(t *testing.T) {
	tree := mapTree{
		"app/src/main/java/com/acme/App.java":          "package com.acme;\nimport com.acme.model.User;\nimport com.acme.util.*;\nimport static com.acme.util.Strings.trim;\nimport java.util.List;\nimport com.acme.model.User.Builder;",
		"app/src/main/java/com/acme/model/User.java":   "package com.acme.model;",
		"lib/src/main/kotlin/com/acme/util/Strings.kt": "package com.acme.util\n",
		"lib/src/main/kotlin/com/acme/util/Numbers.kt": "package com.acme.util",
		"app/src/main/java/com/acme/Other.java":        "package com.acme;",
	}
	got := sorted((&Java{}).Imports("app/src/main/java/com/acme/App.java", []byte(tree["app/src/main/java/com/acme/App.java"]), tree))
	want := []string{"app/src/main/java/com/acme/model/User.java", "lib/src/main/kotlin/com/acme/util/Numbers.kt", "lib/src/main/kotlin/com/acme/util/Strings.kt"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
}

func TestFor(t *testing.T) {
	rs := All()
	if r := For("x.tsx", rs); r == nil {
		t.Error("tsx unhandled")
	}
	if r := For("x.rs", rs); r != nil {
		t.Error("rs should be unhandled")
	}
}
