package realtime

import (
	"context"
	"slices"
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
	// private: the roster goes to the channel's people, not the space.
	private bool
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
func (v *voiceState) set(userID string, conn uint64, spaceID string, private bool, vs *realtimev1.VoiceState) (left *voiceEntry, now *voiceEntry) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if prev := v.users[userID]; prev != nil && prev.channel != vs.ChannelId {
		left = prev
	}
	now = &voiceEntry{
		conn: conn, spaceID: spaceID, channel: vs.ChannelId, private: private,
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

// clearInChannel drops userID's voice state if it is in channelID.
func (v *voiceState) clearInChannel(userID, channelID string) *voiceEntry {
	return v.clearIf(userID, func(entry *voiceEntry) bool { return entry.channel == channelID })
}

// occupied reports whether anyone is in channelID.
func (v *voiceState) occupied(channelID string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	for _, entry := range v.users {
		if entry.channel == channelID {
			return true
		}
	}
	return false
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

// participantsIn lists everyone in a voice channel of the given spaces:
// those in public channels, and those in private ones by channel.
func (v *voiceState) participantsIn(spaceIDs []string) (public []*realtimev1.VoiceParticipant, private map[string][]*realtimev1.VoiceParticipant) {
	want := make(map[string]struct{}, len(spaceIDs))
	for _, s := range spaceIDs {
		want[s] = struct{}{}
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	for id, entry := range v.users {
		if _, ok := want[entry.spaceID]; !ok {
			continue
		}
		if !entry.private {
			public = append(public, entry.participant(id))
			continue
		}
		if private == nil {
			private = map[string][]*realtimev1.VoiceParticipant{}
		}
		private[entry.channel] = append(private[entry.channel], entry.participant(id))
	}
	return public, private
}

// participantsInChannel lists everyone in one voice channel.
func (v *voiceState) participantsInChannel(channelID string) []*realtimev1.VoiceParticipant {
	v.mu.Lock()
	defer v.mu.Unlock()
	var out []*realtimev1.VoiceParticipant
	for id, entry := range v.users {
		if entry.channel == channelID {
			out = append(out, entry.participant(id))
		}
	}
	return out
}

// voiceRoster is who userID may see in voice in the given spaces. A
// private channel's people are looked up only when someone is in it.
func (g *Gateway) voiceRoster(ctx context.Context, userID string, spaceIDs []string) []*realtimev1.VoiceParticipant {
	roster, private := g.voice.participantsIn(spaceIDs)
	for channelID, participants := range private {
		if g.inChannel(ctx, channelID, userID) {
			roster = append(roster, participants...)
		}
	}
	return roster
}

// inChannel reports whether userID is one of a private channel's people;
// false when that can't be found out.
func (g *Gateway) inChannel(ctx context.Context, channelID, userID string) bool {
	people, _, err := g.channels.ChannelPeople(ctx, channelID)
	if err != nil {
		g.log.Error("resolve channel people", "err", err)
		return false
	}
	return slices.Contains(people, userID)
}

// handleVoiceState applies a client's self-report and broadcasts the
// resulting changes to the space(s) involved.
func (g *Gateway) handleVoiceState(ctx context.Context, userID string, conn uint64, sub *events.Subscription, vs *realtimev1.VoiceState) {
	if vs.ChannelId == "" {
		g.publishLeft(userID, g.voice.clearOwnedBy(userID, conn))
		return
	}
	spaceID, private, err := g.channels.VoiceChannelSpace(ctx, vs.ChannelId)
	if err != nil {
		g.log.Error("resolve voice channel", "err", err)
		return
	}
	// Unknown channel, a text channel, a space this connection isn't
	// subscribed to (so not a member of), or a private channel the person
	// isn't in: ignore the report.
	if spaceID == "" || !sub.Has(events.SpaceTopic(spaceID)) {
		return
	}
	if private && !g.inChannel(ctx, vs.ChannelId, userID) {
		return
	}
	left, now := g.voice.set(userID, conn, spaceID, private, vs)
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

// channelDeleted empties a deleted voice channel. Every connection that
// could see it hears the event; only the first to get here finds anyone
// to drop. Someone taken out of a private channel hears the same event
// while the channel lives on, and then only they leave its voice.
func (g *Gateway) channelDeleted(userID, channelID string) {
	if !g.voice.occupied(channelID) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), g.lookupTimeout)
	defer cancel()
	spaceID, _, err := g.channels.VoiceChannelSpace(ctx, channelID)
	if err != nil {
		g.log.Error("resolve voice channel", "err", err)
		return
	}
	if spaceID != "" {
		g.publishLeft(userID, g.voice.clearInChannel(userID, channelID))
		return
	}
	for id, e := range g.voice.clearChannel(channelID) {
		g.publishVoice(id, e, false)
	}
}

// publishVoice announces a join, a change or a leave: to the space for a
// public channel, to the channel's people for a private one. The person
// themself always hears it, in the channel or just taken out of it.
func (g *Gateway) publishVoice(userID string, entry *voiceEntry, joined bool) {
	event := voiceStateChanged(entry.participant(userID), joined)
	if !entry.private {
		g.bus.Publish(events.SpaceTopic(entry.spaceID), event)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), g.lookupTimeout)
	defer cancel()
	people, _, err := g.channels.ChannelPeople(ctx, entry.channel)
	if err != nil {
		g.log.Error("resolve channel people", "err", err)
	}
	if !slices.Contains(people, userID) {
		people = append(people, userID)
	}
	for _, id := range people {
		g.bus.Publish(events.UserTopic(id), event)
	}
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
