package realtime

import (
	"context"
	"sync"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// voiceState is the gateway's in-memory view of who is in which voice
// channel. Like presence it is client-reported and not persisted: the
// connection that reported it owns it, and it is dropped when that
// connection closes. LiveKit itself is the source of truth for media.
type voiceState struct {
	mu    sync.Mutex
	users map[string]*voiceEntry
}

type voiceEntry struct {
	conn    uint64 // connection that owns this state
	spaceID string
	channel string
	muted   bool
	deaf    bool
	camera  bool
	screen  bool
}

func newVoiceState() *voiceState {
	return &voiceState{users: map[string]*voiceEntry{}}
}

func (e *voiceEntry) participant(userID string) *realtimev1.VoiceParticipant {
	return &realtimev1.VoiceParticipant{
		SpaceId: e.spaceID, ChannelId: e.channel, UserId: userID,
		Muted: e.muted, Deafened: e.deaf, Camera: e.camera, ScreenSharing: e.screen,
	}
}

// set records userID as in a voice channel via conn. It returns the
// previous entry if that was a different channel (the caller announces
// the leave) and the new one.
func (v *voiceState) set(userID string, conn uint64, spaceID string, vs *realtimev1.VoiceState) (left *voiceEntry, now *voiceEntry) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if prev := v.users[userID]; prev != nil && prev.channel != vs.ChannelId {
		left = prev
	}
	now = &voiceEntry{
		conn: conn, spaceID: spaceID, channel: vs.ChannelId,
		muted: vs.Muted, deaf: vs.Deafened, camera: vs.Camera, screen: vs.ScreenSharing,
	}
	v.users[userID] = now
	return left, now
}

// clearOwnedBy drops userID's voice state if conn reported it; nil when
// there was none or another connection owns it.
func (v *voiceState) clearOwnedBy(userID string, conn uint64) *voiceEntry {
	return v.clearIf(userID, func(entry *voiceEntry) bool { return entry.conn == conn })
}

// clearInSpace drops userID's voice state if it is in spaceID, whichever
// connection reported it; nil when there was none there.
func (v *voiceState) clearInSpace(userID, spaceID string) *voiceEntry {
	return v.clearIf(userID, func(entry *voiceEntry) bool { return entry.spaceID == spaceID })
}

func (v *voiceState) clearIf(userID string, matches func(*voiceEntry) bool) *voiceEntry {
	v.mu.Lock()
	defer v.mu.Unlock()
	entry := v.users[userID]
	if entry == nil || !matches(entry) {
		return nil
	}
	delete(v.users, userID)
	return entry
}

// clearChannel drops everyone in channelID; returns who was dropped.
func (v *voiceState) clearChannel(channelID string) map[string]*voiceEntry {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := map[string]*voiceEntry{}
	for id, e := range v.users {
		if e.channel == channelID {
			out[id] = e
			delete(v.users, id)
		}
	}
	return out
}

// participantsIn lists everyone in a voice channel of the given spaces.
func (v *voiceState) participantsIn(spaceIDs []string) []*realtimev1.VoiceParticipant {
	want := make(map[string]struct{}, len(spaceIDs))
	for _, s := range spaceIDs {
		want[s] = struct{}{}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	var out []*realtimev1.VoiceParticipant
	for id, e := range v.users {
		if _, ok := want[e.spaceID]; ok {
			out = append(out, e.participant(id))
		}
	}
	return out
}

// handleVoiceState applies a client's self-report and broadcasts the
// resulting changes to the space(s) involved.
func (g *Gateway) handleVoiceState(ctx context.Context, userID string, conn uint64, sub *events.Subscription, vs *realtimev1.VoiceState) {
	if vs.ChannelId == "" {
		g.publishLeft(userID, g.voice.clearOwnedBy(userID, conn))
		return
	}
	spaceID, err := g.channels.VoiceChannelSpace(ctx, vs.ChannelId)
	if err != nil {
		g.log.Error("resolve voice channel", "err", err)
		return
	}
	// Unknown channel, a text channel, or a space this connection isn't
	// subscribed to (so not a member of): ignore the report.
	if spaceID == "" || !sub.Has(events.SpaceTopic(spaceID)) {
		return
	}
	left, now := g.voice.set(userID, conn, spaceID, vs)
	if left != nil {
		g.publishVoice(userID, left, false)
	}
	g.publishVoice(userID, now, true)
}

// publishLeft announces that userID left the voice channel in left; nothing
// when left is nil.
func (g *Gateway) publishLeft(userID string, left *voiceEntry) {
	if left != nil {
		g.publishVoice(userID, left, false)
	}
}

// channelDeleted empties a deleted voice channel. Every connection in the
// space sees the event; only the first to get here finds anyone to drop.
func (g *Gateway) channelDeleted(channelID string) {
	for id, e := range g.voice.clearChannel(channelID) {
		g.publishVoice(id, e, false)
	}
}

func (g *Gateway) publishVoice(userID string, entry *voiceEntry, joined bool) {
	g.bus.Publish(events.SpaceTopic(entry.spaceID), voiceStateChanged(entry.participant(userID), joined))
}

func voiceStateChanged(participant *realtimev1.VoiceParticipant, joined bool) *realtimev1.ServerEvent {
	return events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_VoiceStateChanged{
			VoiceStateChanged: &realtimev1.VoiceStateChanged{Participant: participant, Joined: joined},
		},
	})
}

// VoiceParticipantCount is how many people are in a voice channel, and
// VoiceRoomCount how many channels have someone in them. Both feed the
// Diagnostics tab's gauges.
func (g *Gateway) VoiceParticipantCount() int { return g.voice.participantCount() }

func (g *Gateway) VoiceRoomCount() int { return g.voice.roomCount() }

func (v *voiceState) participantCount() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return len(v.users)
}

func (v *voiceState) roomCount() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	rooms := map[string]struct{}{}
	for _, entry := range v.users {
		rooms[entry.channel] = struct{}{}
	}
	return len(rooms)
}
