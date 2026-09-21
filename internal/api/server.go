// Package api serves the JSON API and the embedded frontend.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jozifmikhaelD/diff-viewer/internal/deps"
	"github.com/jozifmikhaelD/diff-viewer/internal/git"
	"github.com/jozifmikhaelD/diff-viewer/internal/watch"
)

const (
	defaultLogLimit = 200
	maxLogLimit     = 1000
)

// Server is the HTTP handler for void.
type Server struct {
	static  fs.FS
	version string
	mux     *http.ServeMux
	opts    Options

	bus     *watch.Bus // nil disables /api/events
	indexer *deps.Indexer

	mu    sync.Mutex
	state *repoState // the open repository and its worktrees
}

// New builds a Server for repo, serving static assets from static. bus may be
// nil, in which case live updates are disabled.
func New(repo *git.Repo, static fs.FS, version string, bus *watch.Bus) *Server {
	return NewWithOptions(repo, static, version, bus, Options{})
}

// NewWithOptions is New with recent-repo persistence and watcher management.
func NewWithOptions(repo *git.Repo, static fs.FS, version string, bus *watch.Bus, opts Options) *Server {
	s := &Server{
		static: static, version: version, mux: http.NewServeMux(), bus: bus, opts: opts,
		indexer: deps.NewIndexer(8),
	}
	s.state = s.newState(repo)
	if opts.Config != nil {
		if _, err := opts.Config.Touch(repo.Root, time.Now()); err != nil {
			log.Printf("config: record recent repo: %v", err)
		}
	}
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/repo", s.handleRepo)
	s.mux.HandleFunc("GET /api/log", s.handleLog)
	s.mux.HandleFunc("GET /api/changeset", s.handleChangeset)
	s.mux.HandleFunc("GET /api/diff", s.handleDiff)
	s.mux.HandleFunc("GET /api/events", s.handleEvents)
	s.mux.HandleFunc("GET /api/deps", s.handleDeps)
	s.mux.HandleFunc("GET /api/blame", s.handleBlame)
	s.mux.HandleFunc("GET /api/recent", s.handleRecent)
	s.mux.HandleFunc("POST /api/open", s.handleOpen)
	s.mux.HandleFunc("GET /api/fs/complete", s.handleFSComplete)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "unknown api route")
	})
	s.mux.HandleFunc("/", s.handleStatic)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// current returns the open repository.
func (s *Server) current() *git.Repo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.repo
}

// Close stops watchers for the open repository.
func (s *Server) Close() {
	s.mu.Lock()
	st := s.state
	s.mu.Unlock()
	if st != nil && st.cancel != nil {
		st.cancel()
		st.watchWG.Wait()
	}
}

type healthResponse struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{OK: true, Version: s.version})
}

// WorktreeInfo is a worktree plus its working-tree status.
type WorktreeInfo struct {
	git.Worktree
	Current     bool                `json:"current"` // the worktree void was launched in
	Status      *git.WorktreeStatus `json:"status,omitempty"`
	StatusError string              `json:"statusError,omitempty"`
}

// RepoResponse describes the repository and all of its worktrees.
type RepoResponse struct {
	Root          string         `json:"root"`
	CommonDir     string         `json:"commonDir"`
	DefaultBranch string         `json:"defaultBranch"`
	Worktrees     []WorktreeInfo `json:"worktrees"`
}

func (s *Server) handleRepo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo := s.current()
	wts, err := repo.Worktrees(ctx)
	if err != nil {
		writeGitError(w, err)
		return
	}
	resp := RepoResponse{
		Root:          repo.Root,
		CommonDir:     repo.CommonDir,
		DefaultBranch: repo.DefaultBranch(ctx),
		Worktrees:     make([]WorktreeInfo, len(wts)),
	}
	var wg sync.WaitGroup
	for i, wt := range wts {
		info := WorktreeInfo{Worktree: wt, Current: wt.Path == repo.Root}
		resp.Worktrees[i] = info
		if wt.Bare || wt.Prunable {
			continue
		}
		wg.Add(1)
		go func(i int, wt git.Worktree) {
			defer wg.Done()
			repo, err := s.openWorktree(ctx, wt.Path)
			if err == nil {
				var st git.WorktreeStatus
				if st, err = repo.Status(ctx); err == nil {
					resp.Worktrees[i].Status = &st
					return
				}
			}
			resp.Worktrees[i].StatusError = err.Error()
		}(i, wt)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, resp)
}

// LogResponse is one page of history.
type LogResponse struct {
	Commits []git.Commit `json:"commits"`
	HasMore bool         `json:"hasMore"`
	Skip    int          `json:"skip"`
	Limit   int          `json:"limit"`
}

func (s *Server) handleLog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	repo, err := s.repoFor(ctx, r)
	if err != nil {
		writeGitError(w, err)
		return
	}
	q := r.URL.Query()
	skip, err := intParam(q.Get("skip"), 0, 0, 1<<30)
	if err != nil {
		writeError(w, http.StatusBadRequest, "skip: "+err.Error())
		return
	}
	limit, err := intParam(q.Get("limit"), defaultLogLimit, 1, maxLogLimit)
	if err != nil {
		writeError(w, http.StatusBadRequest, "limit: "+err.Error())
		return
	}
	opts := git.LogOptions{Ref: q.Get("ref"), Skip: skip, Limit: limit, Author: q.Get("author"), Grep: q.Get("grep")}
	commits, more, err := repo.Log(ctx, opts)
	if err != nil {
		writeGitError(w, err)
		return
	}
	refs, err := repo.Refs(ctx)
	if err != nil {
		writeGitError(w, err)
		return
	}
	for i := range commits {
		commits[i].Refs = refs[commits[i].SHA]
	}
	if commits == nil {
		commits = []git.Commit{}
	}
	writeJSON(w, http.StatusOK, LogResponse{Commits: commits, HasMore: more, Skip: skip, Limit: limit})
}

// errUnknownWorktree is returned for a wt param that is not a listed worktree.
var errUnknownWorktree = errors.New("unknown worktree")

// repoFor resolves the ?wt= query param to an opened worktree. Only paths
// reported by `git worktree list` are accepted, so the API cannot be used to
// probe arbitrary directories.
func (s *Server) repoFor(ctx context.Context, r *http.Request) (*git.Repo, error) {
	wt := r.URL.Query().Get("wt")
	s.mu.Lock()
	st := s.state
	s.mu.Unlock()
	if wt == "" {
		return st.repo, nil
	}
	wt = filepath.Clean(wt)
	s.mu.Lock()
	repo, ok := st.repos[wt]
	s.mu.Unlock()
	if ok {
		return repo, nil
	}
	wts, err := st.repo.Worktrees(ctx)
	if err != nil {
		return nil, err
	}
	for _, w := range wts {
		if filepath.Clean(w.Path) == wt && !w.Bare && !w.Prunable {
			return s.openWorktree(ctx, w.Path)
		}
	}
	return nil, fmt.Errorf("%w: %s", errUnknownWorktree, wt)
}

func (s *Server) openWorktree(ctx context.Context, p string) (*git.Repo, error) {
	p = filepath.Clean(p)
	s.mu.Lock()
	st := s.state
	if repo, ok := st.repos[p]; ok {
		s.mu.Unlock()
		return repo, nil
	}
	s.mu.Unlock()
	repo, err := git.Open(ctx, p)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	st.repos[p] = repo
	s.mu.Unlock()
	return repo, nil
}

func intParam(raw string, def, min, max int) (int, error) {
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, errors.New("not an integer")
	}
	if n < min || n > max {
		return 0, fmt.Errorf("must be between %d and %d", min, max)
	}
	return n, nil
}

// handleStatic serves the embedded SPA: real files as-is, everything else
// falls back to index.html so client-side routes work.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if f, err := s.static.Open(name); err == nil {
		st, statErr := f.Stat()
		_ = f.Close()
		if statErr == nil && !st.IsDir() {
			// Vite names assets by content hash, so they can be cached forever;
			// everything else (index.html, favicon) must be revalidated so a
			// rebuilt binary is picked up on the next reload.
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			http.ServeFileFS(w, r, s.static, name)
			return
		}
	}
	if _, err := fs.Stat(s.static, "index.html"); errors.Is(err, fs.ErrNotExist) {
		http.Error(w, "frontend not built: run `make web` (or `make dev` for live reload)", http.StatusServiceUnavailable)
		return
	}
	// Serve index.html for the SPA route; rewrite the path so ServeFileFS
	// does not redirect based on the requested URL.
	w.Header().Set("Cache-Control", "no-cache")
	r.URL.Path = "/"
	http.ServeFileFS(w, r, s.static, "index.html")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("api: encode response: %v", err)
	}
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorResponse{Error: msg})
}

// writeGitError maps git-layer errors to HTTP statuses.
func writeGitError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errUnknownWorktree), errors.Is(err, git.ErrBadRef), errors.Is(err, git.ErrBadMode), errors.Is(err, git.ErrBadSelection):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, git.ErrNotRepo), errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		var gerr *git.Error
		if errors.As(err, &gerr) && (strings.Contains(gerr.Stderr, "unknown revision") || strings.Contains(gerr.Stderr, "bad revision") || strings.Contains(gerr.Stderr, "Not a valid")) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		log.Printf("api: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
