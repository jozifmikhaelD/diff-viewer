package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/jozifmikhaelD/diff-viewer/internal/config"
	"github.com/jozifmikhaelD/diff-viewer/internal/git"
	"github.com/jozifmikhaelD/diff-viewer/internal/watch"
)

// Options configures optional server features.
type Options struct {
	// Config persists recent repositories; nil disables the recent list.
	Config *config.Store
	// Watch enables file watching for the open repository's worktrees.
	Watch bool
}

// repoState is everything that depends on which repository is open.
type repoState struct {
	repo    *git.Repo
	repos   map[string]*git.Repo
	cancel  context.CancelFunc // stops this repo's watchers
	watchWG sync.WaitGroup
}

// openRepo replaces the current repository: validates the path, restarts
// watchers, records the path as recent, and invalidates cached worktrees.
func (s *Server) openRepo(ctx context.Context, path string) (*git.Repo, error) {
	repo, err := git.Open(ctx, path)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	prev := s.state
	s.state = s.newState(repo)
	s.mu.Unlock()
	if prev != nil && prev.cancel != nil {
		prev.cancel()
	}
	if s.opts.Config != nil {
		if _, err := s.opts.Config.Touch(repo.Root, time.Now()); err != nil {
			log.Printf("config: record recent repo: %v", err)
		}
	}
	return repo, nil
}

func (s *Server) newState(repo *git.Repo) *repoState {
	st := &repoState{repo: repo, repos: map[string]*git.Repo{repo.Root: repo}}
	if s.opts.Watch && s.bus != nil {
		ctx, cancel := context.WithCancel(context.Background())
		st.cancel = cancel
		startWatchers(ctx, repo, s.bus, &st.watchWG)
	}
	return st
}

// startWatchers watches every worktree of repo until ctx is cancelled.
func startWatchers(ctx context.Context, repo *git.Repo, bus *watch.Bus, wg *sync.WaitGroup) {
	wts, err := repo.Worktrees(ctx)
	if err != nil {
		log.Printf("watch: list worktrees: %v", err)
		wts = []git.Worktree{{Path: repo.Root}}
	}
	for _, wt := range wts {
		if wt.Bare || wt.Prunable {
			continue
		}
		r, err := git.Open(ctx, wt.Path)
		if err != nil {
			log.Printf("watch %s: %v", wt.Path, err)
			continue
		}
		w := watch.New(r.Root, r.GitDir, r.CommonDir, bus, watch.Options{})
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := w.Run(ctx); err != nil {
				log.Printf("watch %s: %v", r.Root, err)
			}
		}()
	}
}

// RecentResponse lists recently opened repositories, most recent first.
type RecentResponse struct {
	Recent []config.Recent `json:"recent"`
}

func (s *Server) handleRecent(w http.ResponseWriter, _ *http.Request) {
	if s.opts.Config == nil {
		writeJSON(w, http.StatusOK, RecentResponse{Recent: []config.Recent{}})
		return
	}
	c, err := s.opts.Config.Load()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Drop entries that no longer exist on disk so the list stays useful.
	kept := make([]config.Recent, 0, len(c.Recent))
	for _, r := range c.Recent {
		if st, err := os.Stat(r.Path); err == nil && st.IsDir() {
			kept = append(kept, r)
		}
	}
	writeJSON(w, http.StatusOK, RecentResponse{Recent: kept})
}

type openRequest struct {
	Path string `json:"path"`
}

// handleOpen switches the server to another repository (POST {"path": ...}).
// Only local paths are accepted; the response is the new /api/repo document.
func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	var req openRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&req); err != nil || req.Path == "" {
		writeError(w, http.StatusBadRequest, "body must be {\"path\": \"/repo\"}")
		return
	}
	path := expandHome(req.Path)
	st, err := os.Stat(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, "no such directory: "+req.Path)
		return
	case errors.Is(err, os.ErrPermission):
		writeError(w, http.StatusForbidden, "permission denied: "+req.Path)
		return
	case err != nil:
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case !st.IsDir():
		writeError(w, http.StatusBadRequest, "not a directory: "+req.Path)
		return
	}
	if _, err := s.openRepo(r.Context(), path); err != nil {
		if errors.Is(err, git.ErrNotRepo) {
			writeError(w, http.StatusBadRequest, req.Path+" is not a git repository")
			return
		}
		writeGitError(w, err)
		return
	}
	s.handleRepo(w, r)
}

func expandHome(p string) string {
	if len(p) > 1 && p[0] == '~' && (p[1] == '/' || p[1] == filepath.Separator) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return filepath.Clean(p)
}
