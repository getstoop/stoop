package app

import (
	"context"
	"testing"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/voice"
)

func configured() voice.Options {
	return voice.Options{
		LiveKitURL:       "http://livekit:7880",
		LiveKitAPIKey:    "APIkey",
		LiveKitAPISecret: "abcdefghijklmnopqrstuvwxyz0123456789",
	}
}

// With no LiveKit there is nothing to dial and nothing running.
func TestLiveKitStatusUnconfigured(t *testing.T) {
	r := newLiveKitReporter(config.Config{}, voice.Options{})
	var dialled bool
	r.alive = func(context.Context) bool { dialled = true; return true }

	if st := r.LiveKitStatus(context.Background()); st.Running {
		t.Fatalf("unconfigured status = %+v", st)
	}
	if dialled {
		t.Fatal("an unconfigured server should not be dialled")
	}
}

// Running or stopped, and the check is cached — the admin page polls
// while the sidecar is down.
func TestLiveKitStatusRunning(t *testing.T) {
	r := newLiveKitReporter(config.Config{LiveKitURL: "http://livekit:7880"}, configured())
	up, dials := true, 0
	r.alive = func(context.Context) bool { dials++; return up }

	st := r.LiveKitStatus(context.Background())
	if !st.Running || st.URL != "http://livekit:7880" {
		t.Fatalf("a live sidecar = %+v", st)
	}
	for range 4 {
		r.LiveKitStatus(context.Background())
	}
	if dials != 1 {
		t.Fatalf("dialled %d times within one TTL, want 1", dials)
	}

	up = false
	r.lastAt = r.lastAt.Add(-reachableTTL)
	if st = r.LiveKitStatus(context.Background()); st.Running {
		t.Fatalf("a stopped sidecar should say so: %+v", st)
	}
}
