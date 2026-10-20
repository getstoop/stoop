package realtime

import (
	"context"
	"log/slog"
	"testing"
	"time"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/events"
)

func TestAddSpaceReportsANewSpaceOnce(t *testing.T) {
	presence := newPresence()
	if presence.addSpace("ada", "s1") {
		t.Error("someone offline should not be counted in a space")
	}
	presence.connect("ada", []string{"s1"}, false)
	if presence.addSpace("ada", "s1") {
		t.Error("a space ada is already counted in is not new")
	}
	if !presence.addSpace("ada", "s2") {
		t.Error("the first connection to hear the join should announce it")
	}
	if presence.addSpace("ada", "s2") {
		t.Error("a second connection hearing the same join should not announce it again")
	}
}

// A second tab that connects after a join is saved, but before the first
// tab hears SpaceJoined, announces the person in the new space; the late
// SpaceJoined then finds it counted and stays quiet.
func TestJoinRacingASecondConnectionAnnouncesOnce(t *testing.T) {
	bus := events.NewInProcBus()
	gateway := &Gateway{bus: bus, presence: newPresence(), voice: newVoiceState(), log: slog.Default()}
	newSpace := bus.Subscribe(events.SpaceTopic("s2"))
	defer newSpace.Close()
	ctx := context.Background()

	gateway.connectPresence(ctx, "ada", []string{"s1"}, false)
	gateway.connectPresence(ctx, "ada", []string{"s1", "s2"}, false)
	firstTab := bus.Subscribe(events.UserTopic("ada"))
	defer firstTab.Close()
	gateway.applyControlEvent("ada", firstTab, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceJoined{SpaceJoined: &realtimev1.SpaceJoined{Space: &chatv1.Space{Id: "s2"}}},
	}))

	announced := 0
	for len(newSpace.Events()) > 0 {
		if changed := (<-newSpace.Events()).GetPresenceChanged(); changed != nil && changed.UserId == "ada" && changed.Online {
			announced++
		}
	}
	if announced != 1 {
		t.Errorf("ada announced online in s2 %d times, want 1", announced)
	}
}

// removingLookup stands in for the do not disturb lookup, and removes ada
// from s2 while it runs, as the other tab applying a MemberRemoved would.
type removingLookup struct{ presence *presence }

func (lookup removingLookup) DoNotDisturb(context.Context, string) (bool, *time.Time, error) {
	lookup.presence.removeSpace("ada", "s2")
	return false, nil, nil
}

// A removal applied while a connecting tab waits on its lookup is not
// undone by that tab announcing the person online in the space.
func TestRemovalDuringConnectIsNotAnnounced(t *testing.T) {
	bus := events.NewInProcBus()
	gateway := &Gateway{bus: bus, presence: newPresence(), voice: newVoiceState(), log: slog.Default()}
	removedSpace := bus.Subscribe(events.SpaceTopic("s2"))
	defer removedSpace.Close()
	ctx := context.Background()

	gateway.connectPresence(ctx, "ada", []string{"s1"}, false)
	gateway.UseDoNotDisturb(removingLookup{gateway.presence})
	gateway.connectPresence(ctx, "ada", []string{"s1", "s2"}, false)

	for len(removedSpace.Events()) > 0 {
		if changed := (<-removedSpace.Events()).GetPresenceChanged(); changed != nil && changed.Online {
			t.Errorf("ada was announced online in s2 after her removal: %+v", changed)
		}
	}
}

// A phone that connects while a computer's grace runs takes over the
// presence only once that grace is out: the computer may yet come back.
func TestPhoneDuringAComputersGraceWaitsItOut(t *testing.T) {
	presence := newPresence()
	presence.grace = 50 * time.Millisecond
	settled := make(chan bool, 4)
	presence.settled = func(_ string, _ []string, online bool) { settled <- online }

	presence.connect("ada", []string{"s1"}, false)
	presence.disconnect("ada", false, false)
	if _, changed := presence.connect("ada", nil, true); changed {
		t.Error("a phone joining a computer's grace was announced at once")
	}
	if presence.mobileOf("ada") {
		t.Error("ada read as mobile before the computer's grace ran out")
	}
	select {
	case online := <-settled:
		if !online || !presence.mobileOf("ada") {
			t.Errorf("after the grace: online %v, mobile %v; want both", online, presence.mobileOf("ada"))
		}
	case <-time.After(time.Second):
		t.Fatal("the grace never settled")
	}
	select {
	case online := <-settled:
		t.Errorf("a second settle: online %v", online)
	case <-time.After(150 * time.Millisecond):
	}
}
