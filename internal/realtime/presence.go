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
	// grace is how long someone stays online after their last connection
	// closes, and how long a move to only mobile connections waits before
	// it is announced, so an app sent to the background, a dropped
	// network or a reloaded tab doesn't flicker. Zero announces at once.
	grace time.Duration
	// settled announces what a grace timer decided: offline in spaces, or
	// still online with only mobile connections left.
	settled func(userID string, spaceIDs []string, online bool)
}

type presenceEntry struct {
	// conns is how many connections the person holds, and mobileConns how
	// many of them a mobile app opened. With none left the entry lingers
	// for the grace period before the person is announced offline.
	conns       int
	mobileConns int
	// mobile is what others were last told: every connection is mobile.
	mobile bool
	spaces map[string]struct{}
	// dnd is whether the person is on do not disturb. until is when it
	// ends (nil for no end), and timer is what ends it.
	dnd   bool
	until *time.Time
	timer *time.Timer
	// settle is the grace timer, and settling counts them, so one that
	// was stopped too late to keep it from firing does nothing.
	settle   *time.Timer
	settling uint64
}

func newPresence() *presence {
	return &presence{users: map[string]*presenceEntry{}}
}

// connect records a connection, mobile when a mobile app opened it. It
// returns the spaces the user is newly counted in (all of them for their
// first connection, and for a later one any space joined since that
// another connection has not recorded yet), and whether they stopped
// being only on mobile, which is announced at once. A connection that
// leaves them only on mobile, as one made while an earlier connection's
// grace runs, waits out the grace like a close does.
func (p *presence) connect(userID string, spaceIDs []string, mobile bool) (added []string, mobileChanged bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry := p.users[userID]
	if entry == nil {
		entry = &presenceEntry{spaces: map[string]struct{}{}, mobile: mobile}
		p.users[userID] = entry
	}
	for _, spaceID := range spaceIDs {
		if _, counted := entry.spaces[spaceID]; !counted {
			entry.spaces[spaceID] = struct{}{}
			added = append(added, spaceID)
		}
	}
	entry.conns++
	if mobile {
		entry.mobileConns++
	}
	p.stopSettle(entry)
	onlyMobile := entry.mobileConns == entry.conns
	if entry.mobile && !onlyMobile {
		entry.mobile = false
		mobileChanged = true
	} else if !entry.mobile && onlyMobile {
		p.armSettle(userID, entry)
	}
	return added, mobileChanged
}

// disconnect records a closed connection. now skips the grace period, for
// a socket closed because its session ended. When the person is offline at
// once, the spaces they were visible in across every connection are
// returned, joins made while connected included; nil while they are still
// online or their grace runs. toMobile is whether they are now only on
// mobile, which with no grace is announced at once too.
func (p *presence) disconnect(userID string, mobile, now bool) (offline []string, toMobile bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil {
		return nil, false
	}
	e.conns--
	if mobile {
		e.mobileConns--
	}
	if e.conns > 0 {
		if e.mobile || e.mobileConns != e.conns {
			return nil, false
		}
		if p.grace <= 0 {
			e.mobile = true
			return nil, true
		}
		p.armSettle(userID, e)
		return nil, false
	}
	if now || p.grace <= 0 {
		return p.drop(userID, e), false
	}
	p.armSettle(userID, e)
	return nil, false
}

// armSettle starts the grace timer, replacing one already running.
// Called with p.mu held.
func (p *presence) armSettle(userID string, entry *presenceEntry) {
	p.stopSettle(entry)
	entry.settling++
	generation := entry.settling
	entry.settle = time.AfterFunc(p.grace, func() { p.settleNow(userID, generation) })
}

// stopSettle stops the grace timer, if one runs. Called with p.mu held.
func (p *presence) stopSettle(entry *presenceEntry) {
	if entry.settle != nil {
		entry.settle.Stop()
		entry.settle = nil
	}
	entry.settling++
}

// settleNow is a grace timer firing: with no connection back the person
// goes offline, and with only mobile connections left they are announced
// so. A timer stopped or replaced since it was armed does nothing.
func (p *presence) settleNow(userID string, generation uint64) {
	p.mu.Lock()
	entry := p.users[userID]
	if entry == nil || entry.settling != generation {
		p.mu.Unlock()
		return
	}
	entry.settle = nil
	var spaces []string
	online := true
	switch {
	case entry.conns == 0:
		spaces, online = p.drop(userID, entry), false
	case !entry.mobile && entry.mobileConns == entry.conns:
		entry.mobile = true
		spaces = spaceList(entry)
	}
	p.mu.Unlock()
	if spaces != nil && p.settled != nil {
		p.settled(userID, spaces, online)
	}
}

// drop forgets someone gone offline and returns the spaces they were
// visible in. Called with p.mu held.
func (p *presence) drop(userID string, entry *presenceEntry) []string {
	if entry.timer != nil {
		entry.timer.Stop()
	}
	p.stopSettle(entry)
	delete(p.users, userID)
	return spaceList(entry)
}

func spaceList(entry *presenceEntry) []string {
	spaces := make([]string, 0, len(entry.spaces))
	for s := range entry.spaces {
		spaces = append(spaces, s)
	}
	return spaces
}

// addSpace counts an online user in one more space; true when they were
// not already counted there.
func (p *presence) addSpace(userID, spaceID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry := p.users[userID]
	if entry == nil {
		return false
	}
	if _, counted := entry.spaces[spaceID]; counted {
		return false
	}
	entry.spaces[spaceID] = struct{}{}
	return true
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

// mobileOf is whether an online user was last announced as only on mobile.
func (p *presence) mobileOf(userID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := p.users[userID]; e != nil {
		return e.mobile
	}
	return false
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

// countedIn filters spaceIDs down to those the user is still counted in.
func (p *presence) countedIn(userID string, spaceIDs []string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	entry := p.users[userID]
	if entry == nil {
		return nil
	}
	var counted []string
	for _, spaceID := range spaceIDs {
		if _, ok := entry.spaces[spaceID]; ok {
			counted = append(counted, spaceID)
		}
	}
	return counted
}

// spacesOf is every space a user's connections are counted in.
func (p *presence) spacesOf(userID string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	e := p.users[userID]
	if e == nil {
		return nil
	}
	return spaceList(e)
}

// presencesIn lists users online in any of the given spaces with whether
// each is on do not disturb and only on mobile, read under one lock.
func (p *presence) presencesIn(spaceIDs []string) []*realtimev1.UserPresence {
	want := make(map[string]struct{}, len(spaceIDs))
	for _, spaceID := range spaceIDs {
		want[spaceID] = struct{}{}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []*realtimev1.UserPresence
	for userID, entry := range p.users {
		for spaceID := range entry.spaces {
			if _, ok := want[spaceID]; ok {
				out = append(out, &realtimev1.UserPresence{UserId: userID, Dnd: entry.dnd, Mobile: entry.mobile})
				break
			}
		}
	}
	return out
}

// OnlineUserIDs filters ids down to those online, as presence shows them.
// Exposed for the chat module's presence port (@here).
func (g *Gateway) OnlineUserIDs(_ context.Context, ids []string) ([]string, error) {
	return g.presence.onlineAmong(ids), nil
}

// onlineAmong filters userIDs down to those with a live connection, or
// one closed within the grace period: online as everyone else sees them.
func (p *presence) onlineAmong(userIDs []string) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var online []string
	for _, userID := range userIDs {
		if _, ok := p.users[userID]; ok {
			online = append(online, userID)
		}
	}
	return online
}

// ConnectionCount is how many WebSocket sessions are open, and
// OnlineUserCount how many people hold at least one. Both feed the
// Diagnostics tab's gauges.
func (g *Gateway) ConnectionCount() int { return g.presence.connectionCount() }

func (g *Gateway) OnlineUserCount() int { return g.presence.userCount() }

func (p *presence) connectionCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	connections := 0
	for _, entry := range p.users {
		connections += entry.conns
	}
	return connections
}

// userCount leaves out anyone whose grace period runs: they hold no
// connection.
func (p *presence) userCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	users := 0
	for _, entry := range p.users {
		if entry.conns > 0 {
			users++
		}
	}
	return users
}
