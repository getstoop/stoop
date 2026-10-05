package instance

import (
	"context"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// keyLiveKit holds the API key pair Stoop signs room tokens with. It
// is minted on first boot when the environment supplies none, so
// nobody has to copy a secret between two files by hand.
const keyLiveKit = "livekit"

// LiveKitCredentials is a LiveKit API key pair as this module stores it.
// The voice module has its own type; internal/app translates, because
// modules don't import each other.
type LiveKitCredentials struct {
	APIKey    string `json:"api_key"`
	APISecret string `json:"api_secret"`
}

// LiveKitKeys returns the saved LiveKit credentials, if any. The secret
// never leaves the server through the API — only this in-process call and
// the key file the sidecar reads.
func (s *Service) LiveKitKeys(ctx context.Context) (LiveKitCredentials, error) {
	var k LiveKitCredentials
	if _, err := s.readJSON(ctx, keyLiveKit, &k); err != nil {
		return LiveKitCredentials{}, err
	}
	return k, nil
}

// SetLiveKitKeys stores a pair, so a minted one survives a restart.
func (s *Service) SetLiveKitKeys(ctx context.Context, k LiveKitCredentials) error {
	return s.writeJSON(ctx, keyLiveKit, k)
}

// LiveKitStatus is whether the voice sidecar is up, and where.
type LiveKitStatus struct {
	Running bool
	URL     string
}

// LiveKitReporter is the instance module's port onto the voice sidecar's
// state, wired in internal/app (which is the only place that knows both
// the configuration and the Tailscale node).
type LiveKitReporter interface {
	LiveKitStatus(ctx context.Context) LiveKitStatus
}

// UseLiveKit connects the reporter; nil means nothing is known and the
// admin page shows voice as unconfigured.
func (s *Service) UseLiveKit(r LiveKitReporter) { s.livekit = r }

func (status LiveKitStatus) toProto() *instancev1.LiveKitStatus {
	return &instancev1.LiveKitStatus{Running: status.Running, Url: status.URL}
}
