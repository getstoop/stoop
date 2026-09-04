package realtime

import (
	"context"
	"sync"

	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
)

// presence is the gateway's in-memory view of who is connected. It is
// deliberately not persisted: a restart drops everyone, and everyone
// reconnects. Multi-node deployments would move this behind the bus.
type presence struct {
	mu    sync.Mutex
	users map[string]*presenceEntry
}

type presenceEntry struct {
	conns  int
	spaces map[string]struct{}
	// status is the user's chosen (or automatic) status while online; the
	// last SetStatus from any of their connections wins.
	status realtimev1.PresenceStatus
}

func newPresence() *presence {
	return &presence{users: map[string]*presenceEntry{}}
}

// connect records a connection; true when this made the user online.
func (p *presence) connect(userID string, spaceIDs []string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil {
		e = &presenceEntry{spaces: map[string]struct{}{}, status: realtimev1.PresenceStatus_PRESENCE_STATUS_ONLINE}
		p.users[userID] = e
	}
	for _, s := range spaceIDs {
		e.spaces[s] = struct{}{}
	}
	e.conns++
	return e.conns == 1
}

// disconnect records a closed connection; true when the user went offline.
func (p *presence) disconnect(userID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil {
		return false
	}
	e.conns--
	if e.conns <= 0 {
		delete(p.users, userID)
		return true
	}
	return false
}

func (p *presence) addSpace(userID, spaceID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.users[userID]; e != nil {
		e.spaces[spaceID] = struct{}{}
	}
}

func (p *presence) removeSpace(userID, spaceID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.users[userID]; e != nil {
		delete(e.spaces, spaceID)
	}
}

// setStatus records a user's status; true when it changed (and they are
// online — a status for someone with no connection is dropped).
func (p *presence) setStatus(userID string, st realtimev1.PresenceStatus) bool {
	if st == realtimev1.PresenceStatus_PRESENCE_STATUS_UNSPECIFIED {
		st = realtimev1.PresenceStatus_PRESENCE_STATUS_ONLINE
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil || e.status == st {
		return false
	}
	e.status = st
	return true
}

// statusOf is a user's current status (ONLINE when unknown).
func (p *presence) statusOf(userID string) realtimev1.PresenceStatus {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.users[userID]; e != nil {
		return e.status
	}
	return realtimev1.PresenceStatus_PRESENCE_STATUS_ONLINE
}

// presencesIn lists users online in any of the given spaces with their
// status; the same set as onlineIn.
func (p *presence) presencesIn(spaceIDs []string) []*realtimev1.UserPresence {
	var out []*realtimev1.UserPresence
	for _, id := range p.onlineIn(spaceIDs) {
		out = append(out, &realtimev1.UserPresence{UserId: id, Status: p.statusOf(id)})
	}
	return out
}

// onlineIn lists users online in any of the given spaces.
func (p *presence) onlineIn(spaceIDs []string) []string {
	want := make(map[string]struct{}, len(spaceIDs))
	for _, s := range spaceIDs {
		want[s] = struct{}{}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []string
	for id, e := range p.users {
		for s := range e.spaces {
			if _, ok := want[s]; ok {
				out = append(out, id)
				break
			}
		}
	}
	return out
}

// OnlineUserIDs filters ids down to those with a live connection. Exposed
// for the chat module's presence port (@here).
func (g *Gateway) OnlineUserIDs(_ context.Context, ids []string) ([]string, error) {
	g.presence.mu.Lock()
	defer g.presence.mu.Unlock()
	var out []string
	for _, id := range ids {
		if _, ok := g.presence.users[id]; ok {
			out = append(out, id)
		}
	}
	return out, nil
}
