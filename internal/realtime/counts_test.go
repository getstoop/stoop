package realtime

import (
	"testing"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
)

func TestGatewayCounts(t *testing.T) {
	g := &Gateway{presence: newPresence(), voice: newVoiceState()}
	if g.ConnectionCount() != 0 || g.OnlineUserCount() != 0 || g.VoiceParticipantCount() != 0 || g.VoiceRoomCount() != 0 {
		t.Fatal("a fresh gateway counts nothing")
	}

	g.presence.connect("ada", nil)
	g.presence.connect("ada", nil)
	g.presence.connect("bea", nil)
	if got := g.ConnectionCount(); got != 3 {
		t.Errorf("connections = %d, want 3", got)
	}
	if got := g.OnlineUserCount(); got != 2 {
		t.Errorf("online users = %d, want 2", got)
	}
	g.presence.disconnect("ada")
	if got, want := g.ConnectionCount(), 2; got != want {
		t.Errorf("connections after one close = %d, want %d", got, want)
	}
	if got := g.OnlineUserCount(); got != 2 {
		t.Errorf("online users after one close = %d, want 2", got)
	}

	g.voice.set("ada", 1, "s", &realtimev1.VoiceState{ChannelId: "general"})
	g.voice.set("bea", 2, "s", &realtimev1.VoiceState{ChannelId: "general"})
	g.voice.set("casey", 3, "s", &realtimev1.VoiceState{ChannelId: "music"})
	if got := g.VoiceParticipantCount(); got != 3 {
		t.Errorf("voice participants = %d, want 3", got)
	}
	if got := g.VoiceRoomCount(); got != 2 {
		t.Errorf("voice rooms = %d, want 2", got)
	}
	g.voice.clear("casey", 3, "")
	if got := g.VoiceRoomCount(); got != 1 {
		t.Errorf("voice rooms after a leave = %d, want 1", got)
	}
}
