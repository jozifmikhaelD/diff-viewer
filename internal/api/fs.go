package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FSEntry is a directory suggestion for the path field.
type FSEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Repo bool   `json:"repo"` // contains a .git entry
}

// FSCompleteResponse lists directories completing a partial path.
type FSCompleteResponse struct {
	Dir     string    `json:"dir"`     // directory that was listed
	Entries []FSEntry `json:"entries"` // matches, git repos first then alphabetical
	More    bool      `json:"more"`    // truncated at the cap
}

const maxFSEntries = 50

// handleFSComplete completes the last segment of ?path= against the
// filesystem, like shell tab completion: a single directory read, no walking.
// Hidden directories are offered only when the typed segment starts with ".".
func (s *Server) handleFSComplete(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("path")
	if raw == "" {
		raw = "~/"
	}
	p := expandHome(raw)
	if strings.HasSuffix(raw, "/") || strings.HasSuffix(raw, string(filepath.Separator)) {
		p += string(filepath.Separator)
	}
	dir, partial := filepath.Split(p)
	if dir == "" {
		dir = "."
	}
	entries, err := os.ReadDir(dir)
	switch {
	case errors.Is(err, os.ErrNotExist):
		writeJSON(w, http.StatusOK, FSCompleteResponse{Dir: dir, Entries: []FSEntry{}})
		return
	case errors.Is(err, os.ErrPermission):
		writeError(w, http.StatusForbidden, "permission denied: "+dir)
		return
	case err != nil:
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	lower := strings.ToLower(partial)
	out := make([]FSEntry, 0, 16)
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && e.Type()&os.ModeSymlink == 0 {
			continue
		}
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(partial, ".") {
			continue
		}
		if !strings.HasPrefix(strings.ToLower(name), lower) {
			continue
		}
		full := filepath.Join(dir, name)
		if e.Type()&os.ModeSymlink != 0 {
			st, err := os.Stat(full)
			if err != nil || !st.IsDir() {
				continue
			}
		}
		_, gitErr := os.Lstat(filepath.Join(full, ".git"))
		out = append(out, FSEntry{Name: name, Path: full, Repo: gitErr == nil})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Repo != out[j].Repo {
			return out[i].Repo
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	resp := FSCompleteResponse{Dir: dir, Entries: out}
	if len(out) > maxFSEntries {
		resp.Entries = out[:maxFSEntries]
		resp.More = true
	}
	writeJSON(w, http.StatusOK, resp)
}
