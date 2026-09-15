package realtime

import (
	"context"
	"sync"
	"time"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
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
	// dnd is whether the person is on do not disturb. until is when it
	// ends (nil for no end), and timer is what ends it.
	dnd   bool
	until *time.Time
	timer *time.Timer
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
		e = &presenceEntry{spaces: map[string]struct{}{}}
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
		if e.timer != nil {
			e.timer.Stop()
		}
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

// setDnd records do not disturb for someone online; true when it changed
// what others see. An end in the future arms a timer that turns it off and
// calls ended; an end already past reads as off. Someone with no
// connection is dropped: their next connect reads it again.
func (p *presence) setDnd(userID string, on bool, until *time.Time, ended func()) bool {
	now := time.Now()
	if !on || (until != nil && !until.After(now)) {
		on, until = false, nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil {
		return false
	}
	if e.timer != nil {
		e.timer.Stop()
		e.timer = nil
	}
	changed := e.dnd != on
	e.dnd, e.until = on, until
	if until != nil {
		end := *until
		e.timer = time.AfterFunc(end.Sub(now), func() {
			if p.endDnd(userID, end) {
				ended()
			}
		})
	}
	return changed
}

// endDnd turns off do not disturb that has reached end; false when it was
// changed again after the timer was armed.
func (p *presence) endDnd(userID string, end time.Time) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil || !e.dnd || e.until == nil || !e.until.Equal(end) {
		return false
	}
	e.dnd, e.until, e.timer = false, nil, nil
	return true
}

// dndOf is whether an online user is on do not disturb.
func (p *presence) dndOf(userID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.users[userID]; e != nil {
		return e.dnd
	}
	return false
}

// spacesOf is every space a user's connections are counted in.
func (p *presence) spacesOf(userID string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil {
		return nil
	}
	out := make([]string, 0, len(e.spaces))
	for s := range e.spaces {
		out = append(out, s)
	}
	return out
}

// presencesIn lists users online in any of the given spaces with whether
// each is on do not disturb; the same set as onlineIn.
func (p *presence) presencesIn(spaceIDs []string) []*realtimev1.UserPresence {
	var out []*realtimev1.UserPresence
	for _, id := range p.onlineIn(spaceIDs) {
		out = append(out, &realtimev1.UserPresence{UserId: id, Dnd: p.dndOf(id)})
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
