// Package deps builds an import graph over a repository tree and answers
// neighbourhood queries for a changeset.
package deps

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/jozifmikhaelD/diff-viewer/internal/git"
)

// Source is a snapshot of a tree: the files in it and their contents.
type Source interface {
	// Files lists every path in the snapshot (forward slashes, repo-relative).
	Files(ctx context.Context) ([]string, error)
	// Read returns a file's content; ok is false when it does not exist.
	Read(ctx context.Context, path string) (data []byte, ok bool, err error)
	// Key identifies the snapshot for caching (tree hash, or "" to disable).
	Key() string
}

// MapSource is an in-memory Source for tests.
type MapSource map[string]string

func (m MapSource) Files(context.Context) ([]string, error) {
	out := make([]string, 0, len(m))
	for p := range m {
		out = append(out, p)
	}
	return out, nil
}

func (m MapSource) Read(_ context.Context, p string) ([]byte, bool, error) {
	s, ok := m[p]
	return []byte(s), ok, nil
}

func (m MapSource) Key() string { return "" }

// RevSource reads a committed tree via git.
type RevSource struct {
	Repo *git.Repo
	Rev  string // commit or tree
	key  string
}

// NewRevSource resolves rev's tree hash so equal trees share a cache entry.
func NewRevSource(ctx context.Context, repo *git.Repo, rev string) (*RevSource, error) {
	out, err := repo.Run(ctx, "rev-parse", "--verify", "--quiet", rev+"^{tree}")
	if err != nil {
		return nil, err
	}
	return &RevSource{Repo: repo, Rev: rev, key: strings.TrimSpace(string(out))}, nil
}

func (s *RevSource) Key() string { return s.key }

func (s *RevSource) Files(ctx context.Context) ([]string, error) {
	out, err := s.Repo.Run(ctx, "ls-tree", "-r", "-z", "--name-only", s.key)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, p := range bytes.Split(out, []byte{0}) {
		if len(p) > 0 {
			files = append(files, string(p))
		}
	}
	return files, nil
}

func (s *RevSource) Read(ctx context.Context, path string) ([]byte, bool, error) {
	out, err := s.Repo.Run(ctx, "cat-file", "blob", s.key+":"+path)
	if err != nil {
		var gerr *git.Error
		if errors.As(err, &gerr) && (strings.Contains(gerr.Stderr, "does not exist") || strings.Contains(gerr.Stderr, "Not a valid object") || strings.Contains(gerr.Stderr, "not a blob")) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return out, true, nil
}

// ReadMany fetches several blobs in one `cat-file --batch` process.
func (s *RevSource) ReadMany(ctx context.Context, paths []string) (map[string][]byte, error) {
	if len(paths) == 0 {
		return map[string][]byte{}, nil
	}
	var in bytes.Buffer
	for _, p := range paths {
		in.WriteString(s.key + ":" + p + "\n")
	}
	out, err := s.Repo.RunInput(ctx, in.Bytes(), "cat-file", "--batch")
	if err != nil {
		return nil, err
	}
	res := make(map[string][]byte, len(paths))
	rest := out
	for _, p := range paths {
		nl := bytes.IndexByte(rest, '\n')
		if nl < 0 {
			break
		}
		header := string(rest[:nl])
		rest = rest[nl+1:]
		if strings.HasSuffix(header, " missing") {
			continue
		}
		f := strings.Fields(header)
		if len(f) != 3 {
			break
		}
		size := 0
		for _, c := range f[2] {
			size = size*10 + int(c-'0')
		}
		if size > len(rest) {
			break
		}
		res[p] = rest[:size]
		rest = rest[size:]
		if len(rest) > 0 && rest[0] == '\n' {
			rest = rest[1:]
		}
	}
	return res, nil
}

// OverlaySource layers on-disk (or in-memory) files over a base snapshot:
// used for the working tree, where HEAD is the base and changed files come
// from disk. Deleted paths are hidden.
type OverlaySource struct {
	Base    Source
	Root    string          // directory to read overlay files from
	Changed map[string]bool // paths whose content comes from Root
	Deleted map[string]bool // paths absent from the snapshot
}

func (o *OverlaySource) Key() string { return "" } // never cached: disk state is volatile

func (o *OverlaySource) Files(ctx context.Context) ([]string, error) {
	base, err := o.Base.Files(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []string
	for _, p := range base {
		if o.Deleted[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	for p := range o.Changed {
		if !seen[p] && !o.Deleted[p] {
			out = append(out, p)
		}
	}
	return out, nil
}

func (o *OverlaySource) Read(ctx context.Context, p string) ([]byte, bool, error) {
	if o.Deleted[p] {
		return nil, false, nil
	}
	if o.Changed[p] {
		data, err := os.ReadFile(filepath.Join(o.Root, filepath.FromSlash(p)))
		if errors.Is(err, os.ErrNotExist) {
			return nil, false, nil
		}
		return data, err == nil, err
	}
	return o.Base.Read(ctx, p)
}
