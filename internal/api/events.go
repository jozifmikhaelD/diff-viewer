package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jozifmikhaelD/diff-viewer/internal/watch"
)

// heartbeatInterval keeps idle SSE connections alive through proxies.
var heartbeatInterval = 15 * time.Second

// handleEvents streams watch events as server-sent events:
//
//	event: change
//	data: {"worktree":"/path","kind":"worktree"|"refs"}
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if s.bus == nil {
		writeError(w, http.StatusNotImplemented, "live updates disabled")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, "retry: 2000\n\n")
	flusher.Flush()

	events, unsubscribe := s.bus.Subscribe()
	defer unsubscribe()
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case ev, ok := <-events:
			if !ok {
				return
			}
			data, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			_, _ = fmt.Fprintf(w, "event: change\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

// Bus exposes the event bus (nil when live updates are disabled).
func (s *Server) Bus() *watch.Bus { return s.bus }
