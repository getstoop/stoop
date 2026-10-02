package app_test

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// STOOP_VOICE=false beside a configured LiveKit: no key pair is written,
// the instance says voice is unavailable, and voice channels can't be
// made or joined.
func TestE2EVoiceOff(t *testing.T) {
	keyFile := filepath.Join(t.TempDir(), "keys.yaml")
	livekit := []string{"STOOP_LIVEKIT_URL", "http://127.0.0.1:7880", "STOOP_LIVEKIT_KEY_FILE", keyFile}

	h := newHarness(t, append(livekit, "STOOP_VOICE", "false")...)
	casey := h.person("casey")
	stoop, _ := h.space(casey, "The Stoop")

	if _, err := os.Stat(keyFile); !os.IsNotExist(err) {
		t.Errorf("a key file was written with voice off (stat: %v)", err)
	}
	status := h.rpc("", "stoop.instance.v1.InstanceService/GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if on, _ := status.body["voiceAvailable"].(bool); on {
		t.Error("voiceAvailable is true with voice off")
	}
	reach := h.rpc(casey, "stoop.instance.v1.InstanceService/GetReachability", map[string]any{}).expect(t, "ok")
	if off, _ := reach.body["voiceOff"].(bool); !off {
		t.Errorf("voiceOff is not set on the Hosting reading: %s", reach.raw)
	}
	h.rpc(casey, "stoop.chat.v1.ChatService/CreateChannel", map[string]any{"spaceId": stoop, "name": "hangout", "kind": "CHANNEL_KIND_VOICE"}).
		expect(t, "failed_precondition", "voice is turned off")
	h.rpc(casey, "stoop.voice.v1.VoiceService/JoinVoiceChannel", map[string]any{"channelId": stoop}).
		expect(t, "unavailable")
	res, err := http.Get(h.srv.URL + "/livekit/")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("the signaling proxy answered %d with voice off, want 503", res.StatusCode)
	}

	// The same server with voice left on mints and writes the pair.
	keyFile = filepath.Join(t.TempDir(), "keys.yaml")
	livekit[3] = keyFile
	on := newHarness(t, append(livekit, "STOOP_VOICE", "true")...)
	if _, err := os.Stat(keyFile); err != nil {
		t.Errorf("no key file with voice on: %v", err)
	}
	status = on.rpc("", "stoop.instance.v1.InstanceService/GetInstanceStatus", map[string]any{}).expect(t, "ok")
	if avail, _ := status.body["voiceAvailable"].(bool); !avail {
		t.Error("voiceAvailable is false with LiveKit configured and voice on")
	}
}
