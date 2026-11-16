package realtime

import "sync"

// sessions counts the open sockets of each session, so the server can say
// whether a session's app is in front right now. In memory like presence:
// a restart drops it and everyone reconnects.
type sessions struct {
	mu    sync.Mutex
	conns map[string]int
}

func newSessions() *sessions { return &sessions{conns: map[string]int{}} }

func (s *sessions) open(sessionID string) {
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conns[sessionID]++
}

func (s *sessions) close(sessionID string) {
	if sessionID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conns[sessionID] <= 1 {
		delete(s.conns, sessionID)
		return
	}
	s.conns[sessionID]--
}

// SessionConnected says whether at least one socket opened with this
// session is open on this server now. It turns false as soon as the
// gateway sees the socket close; a peer that vanished without closing is
// seen at the next ping (see realtime.md). An empty id is never connected.
func (g *Gateway) SessionConnected(sessionID string) bool {
	if sessionID == "" {
		return false
	}
	g.sessions.mu.Lock()
	defer g.sessions.mu.Unlock()
	return g.sessions.conns[sessionID] > 0
}
