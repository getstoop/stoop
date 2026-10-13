package realtime_test

import (
	"context"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

// privateVoiceChannels is a space "s1" with a public voice channel "porch" and a
// private one "den", whose people and existence a test changes.
type privateVoiceChannels struct {
	lock          sync.Mutex
	people        []string
	deleted       bool
	peopleLookups atomic.Int64
	voiceLookups  atomic.Int64
}

func (channels *privateVoiceChannels) VoiceChannelSpace(_ context.Context, channelID string) (string, bool, error) {
	channels.voiceLookups.Add(1)
	channels.lock.Lock()
	defer channels.lock.Unlock()
	switch {
	case channelID == "porch":
		return "s1", false, nil
	case channelID == "den" && !channels.deleted:
		return "s1", true, nil
	}
	return "", false, nil
}

func (channels *privateVoiceChannels) ChannelPeople(_ context.Context, channelID string) ([]string, bool, error) {
	channels.peopleLookups.Add(1)
	channels.lock.Lock()
	defer channels.lock.Unlock()
	if channelID != "den" {
		return nil, false, nil
	}
	if channels.deleted {
		return nil, true, nil
	}
	return slices.Clone(channels.people), true, nil
}

func (channels *privateVoiceChannels) set(people ...string) {
	channels.lock.Lock()
	defer channels.lock.Unlock()
	channels.people = people
}

// A private voice channel's roster goes to its people only: live changes,
// the snapshot at connect, and who is there when someone is added. Taking
// someone out of the channel takes them out of its voice; a public voice
// channel asks nothing about people.
func TestPrivateVoiceRosterReachesItsPeopleOnly(t *testing.T) {
	channels := &privateVoiceChannels{people: []string{"ada", "bea"}}
	_, bus, srv := newTestGateway(t, fakeMembers{
		"ada": {"s1"}, "bea": {"s1"}, "cal": {"s1"}, "dee": {"s1"},
	}, channels)
	connect := func(user string) *client {
		connection := dial(t, srv, user)
		if connection.next(time.Second).GetReady() == nil {
			t.Fatalf("no ready frame for %s", user)
		}
		return connection
	}
	ada, bea, cal, dee := connect("ada"), connect("bea"), connect("cal"), connect("dee")
	voice := func(event *realtimev1.ServerEvent) bool { return event.GetVoiceStateChanged() != nil }
	in := func(event *realtimev1.ServerEvent) (user, channel string, joined bool) {
		change := event.GetVoiceStateChanged()
		return change.GetParticipant().GetUserId(), change.GetParticipant().GetChannelId(), change.GetJoined()
	}

	// A public report costs no people lookup.
	dee.send(voiceEvent("porch", false))
	if event := cal.waitFor(voice); event == nil {
		t.Fatal("a public voice join went missing")
	}
	ada.waitFor(voice)
	bea.waitFor(voice)
	if lookups := channels.peopleLookups.Load(); lookups != 0 {
		t.Errorf("a public voice report made %d people lookups, want none", lookups)
	}

	// bea joins the den: ada sees it. cal, outside it, is not told, and
	// cal's own report of joining it is ignored.
	bea.send(voiceEvent("den", false))
	if user, channel, joined := in(ada.waitFor(voice)); user != "bea" || channel != "den" || !joined {
		t.Fatalf("ada saw %s in %s (joined %v), want bea joining den", user, channel, joined)
	}
	cal.send(voiceEvent("den", false))
	dee.send(voiceEvent("porch", true))
	if user, channel, _ := in(cal.waitFor(voice)); user != "dee" || channel != "porch" {
		t.Fatalf("someone outside the den was sent %s in %s, want only dee on the porch", user, channel)
	}
	if user, _, _ := in(ada.waitFor(voice)); user != "dee" {
		t.Fatalf("ada was sent %s, want dee: cal's report for the den must reach nobody", user)
	}

	// The snapshot at connect follows the same rule.
	roster := func(user string) []string {
		connection := dial(t, srv, user)
		defer func() { _ = connection.conn.Close(websocket.StatusNormalClosure, "") }()
		var names []string
		for _, participant := range connection.next(time.Second).GetReady().GetVoiceParticipants() {
			names = append(names, participant.UserId+" in "+participant.ChannelId)
		}
		slices.Sort(names)
		return names
	}
	if got, want := roster("ada"), []string{"bea in den", "dee in porch"}; !slices.Equal(got, want) {
		t.Errorf("snapshot for someone in the den = %v, want %v", got, want)
	}
	if got, want := roster("cal"), []string{"dee in porch"}; !slices.Equal(got, want) {
		t.Errorf("snapshot for someone outside the den = %v, want %v", got, want)
	}

	// cal is added: the channel arrives, then who is in its voice.
	channels.set("ada", "bea", "cal")
	bus.Publish(events.UserTopic("cal"), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelCreated{
			ChannelCreated: &chatv1.Channel{Id: "den", SpaceId: "s1", Private: true, Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE},
		},
	}))
	if user, channel, joined := in(cal.waitFor(voice)); user != "bea" || channel != "den" || !joined {
		t.Fatalf("someone added to the den was sent %s in %s, want bea already there", user, channel)
	}

	// bea is taken out: she leaves its voice, and the others stay as they
	// were.
	cal.send(voiceEvent("den", false))
	ada.waitFor(voice)
	cal.waitFor(voice)
	channels.set("ada", "cal")
	removed := events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{
			ChannelDeleted: &realtimev1.ChannelDeleted{SpaceId: "s1", ChannelId: "den"},
		},
	})
	bus.Publish(events.UserTopic("bea"), removed)
	if user, channel, joined := in(ada.waitFor(voice)); user != "bea" || channel != "den" || joined {
		t.Fatalf("ada saw %s in %s (joined %v), want bea leaving den", user, channel, joined)
	}
	if got, want := roster("ada"), []string{"cal in den", "dee in porch"}; !slices.Equal(got, want) {
		t.Errorf("after the removal, snapshot = %v, want %v", got, want)
	}

	// The channel is deleted: everyone in its voice is dropped.
	channels.lock.Lock()
	channels.deleted = true
	channels.lock.Unlock()
	bus.Publish(events.UserTopic("ada"), removed)
	ownLeave := func(event *realtimev1.ServerEvent) bool {
		user, _, joined := in(event)
		return voice(event) && user == "cal" && !joined
	}
	if cal.waitFor(ownLeave) == nil {
		t.Fatal("cal never heard their own leave from the deleted channel")
	}
	if got, want := roster("ada"), []string{"dee in porch"}; !slices.Equal(got, want) {
		t.Errorf("after the delete, snapshot = %v, want %v", got, want)
	}

	// Deleting a public voice channel with someone in it asks nothing.
	voiceBefore, peopleBefore := channels.voiceLookups.Load(), channels.peopleLookups.Load()
	bus.Publish(events.SpaceTopic("s1"), events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelDeleted{
			ChannelDeleted: &realtimev1.ChannelDeleted{SpaceId: "s1", ChannelId: "porch"},
		},
	}))
	deeLeft := func(event *realtimev1.ServerEvent) bool {
		user, channel, joined := in(event)
		return voice(event) && user == "dee" && channel == "porch" && !joined
	}
	if cal.waitFor(deeLeft) == nil {
		t.Fatal("a deleted public voice channel was not emptied")
	}
	if extra := channels.voiceLookups.Load() - voiceBefore + channels.peopleLookups.Load() - peopleBefore; extra != 0 {
		t.Errorf("deleting a public voice channel made %d lookups, want none", extra)
	}
}
