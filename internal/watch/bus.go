// Package watch observes worktrees and the git dir and publishes change
// events on a Bus that the API streams to clients.
package watch

import "sync"

// Kind classifies an Event.
type Kind string

const (
	// KindWorktree means tracked or untracked files changed on disk.
	KindWorktree Kind = "worktree"
	// KindRefs means HEAD, the index, or refs changed (commit, checkout, stage...).
	KindRefs Kind = "refs"
)

// Event is a debounced change notification for one worktree.
type Event struct {
	Worktree string `json:"worktree"`
	Kind     Kind   `json:"kind"`
}

// Bus fans events out to subscribers. Slow subscribers drop events rather
// than block publishers; a dropped event only means one extra refetch.
type Bus struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

// NewBus creates an empty Bus.
func NewBus() *Bus { return &Bus{subs: map[chan Event]struct{}{}} }

// Subscribe returns a channel of events and a function to unsubscribe.
func (b *Bus) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 16)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

// Publish delivers e to every subscriber without blocking.
func (b *Bus) Publish(e Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// Subscribers reports the current subscriber count (for tests and health).
func (b *Bus) Subscribers() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs)
}
