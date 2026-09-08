// Package api serves the JSON API and the embedded frontend.
package api

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"

	"void/internal/git"
)

// Server is the HTTP handler for void.
type Server struct {
	repo    *git.Repo
	static  fs.FS
	version string
	mux     *http.ServeMux
}

// New builds a Server for repo, serving static assets from static.
func New(repo *git.Repo, static fs.FS, version string) *Server {
	s := &Server{repo: repo, static: static, version: version, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/repo", s.handleRepo)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "unknown api route")
	})
	s.mux.HandleFunc("/", s.handleStatic)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

type healthResponse struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{OK: true, Version: s.version})
}

// RepoResponse describes the opened repository. M1 extends this with
// worktrees, refs and the default branch.
type RepoResponse struct {
	Root           string `json:"root"`
	GitDir         string `json:"gitDir"`
	CommonDir      string `json:"commonDir"`
	LinkedWorktree bool   `json:"linkedWorktree"`
}

func (s *Server) handleRepo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, RepoResponse{
		Root:           s.repo.Root,
		GitDir:         s.repo.GitDir,
		CommonDir:      s.repo.CommonDir,
		LinkedWorktree: s.repo.IsLinkedWorktree(),
	})
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
