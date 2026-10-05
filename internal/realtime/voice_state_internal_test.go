package realtime

import (
	"testing"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
)

func TestVoiceStateClears(t *testing.T) {
	voice := newVoiceState()
	voice.set("ada", 1, "s1", &realtimev1.VoiceState{ChannelId: "general"})

	// Another tab closing leaves the state its owner reported.
	if left := voice.clearOwnedBy("ada", 2); left != nil {
		t.Errorf("connection 2 cleared connection 1's state: %+v", left)
	}
	// Removal from another space leaves it too.
	if left := voice.clearInSpace("ada", "s2"); left != nil {
		t.Errorf("leaving s2 cleared voice in s1: %+v", left)
	}
	// Removal from its own space clears it, whichever connection owns it.
	if left := voice.clearInSpace("ada", "s1"); left == nil || left.channel != "general" {
		t.Errorf("leaving s1 = %+v, want the general entry", left)
	}

	voice.set("ada", 1, "s1", &realtimev1.VoiceState{ChannelId: "general"})
	if left := voice.clearOwnedBy("ada", 1); left == nil {
		t.Error("the owning connection closing should clear the state")
	}
	if voice.participantCount() != 0 {
		t.Errorf("participants = %d, want 0", voice.participantCount())
	}
}
