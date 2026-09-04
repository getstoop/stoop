package realtime

import (
	"context"
	"sync"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// ChannelLookup is the gateway's port onto the chat module's channels,
// wired in internal/app.
type ChannelLookup interface {
	// VoiceChannelSpace resolves a voice channel to its space; "" means
	// unknown or not voice.
	VoiceChannelSpace(ctx context.Context, channelID string) (spaceID string, err error)
	// DMParticipants lists who is in a direct message; nil for any other
	// channel. Typing in a DM is relayed to them.
	DMParticipants(ctx context.Context, channelID string) ([]string, error)
}

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

// clear drops userID's voice state if conn owns it (conn 0 = any) and,
// when spaceID is non-empty, only if it is in that space. Returns the
// dropped entry or nil.
func (v *voiceState) clear(userID string, conn uint64, spaceID string) *voiceEntry {
	v.mu.Lock()
	defer v.mu.Unlock()
	e := v.users[userID]
	if e == nil || (conn != 0 && e.conn != conn) || (spaceID != "" && e.spaceID != spaceID) {
		return nil
	}
	delete(v.users, userID)
	return e
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
		if left := g.voice.clear(userID, conn, ""); left != nil {
			g.publishVoice(userID, left, false)
		}
		return
	}
	spaceID, err := g.channels.VoiceChannelSpace(ctx, vs.ChannelId)
	if err != nil {
		g.log.Error("resolve voice channel", "err", err)
		return
	}
	// Unknown channel, a text channel, or a space this connection isn't
	// subscribed to (so not a member of): ignore the report.
	if spaceID == "" || !sub.Has("space:"+spaceID) {
		return
	}
	left, now := g.voice.set(userID, conn, spaceID, vs)
	if left != nil {
		g.publishVoice(userID, left, false)
	}
	g.publishVoice(userID, now, true)
}

// leaveVoice drops the state this connection owns (on disconnect) or the
// user's state in one space (on kick / leave / space deletion).
func (g *Gateway) leaveVoice(userID string, conn uint64, spaceID string) {
	if left := g.voice.clear(userID, conn, spaceID); left != nil {
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

func (g *Gateway) publishVoice(userID string, e *voiceEntry, joined bool) {
	g.bus.Publish("space:"+e.spaceID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_VoiceStateChanged{
			VoiceStateChanged: &realtimev1.VoiceStateChanged{
				Participant: e.participant(userID), Joined: joined,
			},
		},
	}))
}
