// Package config persists small user preferences such as recently opened
// repositories under the OS config directory (~/.config/void on Linux and
// macOS unless XDG_CONFIG_HOME / VOID_CONFIG_DIR override it).
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// MaxRecent bounds the recent-repos list.
const MaxRecent = 20

// Recent is one recently opened repository.
type Recent struct {
	Path     string    `json:"path"`
	LastOpen time.Time `json:"lastOpen"`
}

// Config is the on-disk document.
type Config struct {
	Recent []Recent `json:"recent"`
}

// Store reads and writes a Config file.
type Store struct {
	path string
	mu   sync.Mutex
}

// Dir returns the config directory, honouring VOID_CONFIG_DIR, then
// XDG_CONFIG_HOME, then ~/.config.
func Dir() (string, error) {
	if d := os.Getenv("VOID_CONFIG_DIR"); d != "" {
		return d, nil
	}
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return filepath.Join(x, "void"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "void"), nil
}

// Default opens the store in Dir().
func Default() (*Store, error) {
	d, err := Dir()
	if err != nil {
		return nil, err
	}
	return New(filepath.Join(d, "config.json")), nil
}

// New creates a Store at path (created on first write).
func New(path string) *Store { return &Store{path: path} }

// Path is the backing file.
func (s *Store) Path() string { return s.path }

// Load reads the config; a missing file yields an empty Config.
func (s *Store) Load() (*Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() (*Config, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return &Config{}, nil
	}
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		// A corrupt file should not break startup; start over.
		return &Config{}, nil
	}
	return &c, nil
}

func (s *Store) save(c *Config) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Touch records path as opened now and returns the updated list, most recent
// first. Paths are deduplicated, entries whose directory no longer exists are
// dropped so they cannot crowd out real ones, and the list is capped at MaxRecent.
func (s *Store) Touch(path string, now time.Time) ([]Recent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.load()
	if err != nil {
		return nil, err
	}
	kept := make([]Recent, 0, len(c.Recent)+1)
	kept = append(kept, Recent{Path: path, LastOpen: now})
	for _, r := range c.Recent {
		if r.Path == path {
			continue
		}
		if st, err := os.Stat(r.Path); err != nil || !st.IsDir() {
			continue
		}
		kept = append(kept, r)
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].LastOpen.After(kept[j].LastOpen) })
	if len(kept) > MaxRecent {
		kept = kept[:MaxRecent]
	}
	c.Recent = kept
	if err := s.save(c); err != nil {
		return nil, err
	}
	return kept, nil
}

// Forget removes path from the list.
func (s *Store) Forget(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, err := s.load()
	if err != nil {
		return err
	}
	kept := c.Recent[:0]
	for _, r := range c.Recent {
		if r.Path != path {
			kept = append(kept, r)
		}
	}
	c.Recent = kept
	return s.save(c)
}
