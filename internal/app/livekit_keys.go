package app

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/voice"
)

// keyStore is where livekitKeys keeps the pair it settles on.
type keyStore interface {
	LiveKitKeys(ctx context.Context) (instance.LiveKitCredentials, error)
	SetLiveKitKeys(ctx context.Context, keys instance.LiveKitCredentials) error
}

// livekitKeys settles which API key pair signs room tokens, and leaves it
// where a LiveKit sidecar can read it.
//
// The environment wins, for anyone who already configured a pair by hand.
// Otherwise a saved pair is reused, and failing that one is minted and
// saved — so a fresh install has working voice without the operator
// copying a secret between two files, which was the single most common
// way to end up with working chat and a voice join that dies at 15s.
//
// The file is written every time (not only when minting) so that an
// environment-configured server also feeds the sidecar from one place.
// Nothing is minted while LiveKit is unconfigured or voice is turned off
// (STOOP_VOICE=false): no pair, no voice.
func livekitKeys(ctx context.Context, cfg config.Config, store keyStore, log *slog.Logger) (voice.Keys, error) {
	if cfg.LiveKitURL == "" || !cfg.Voice {
		return voice.Keys{}, nil
	}
	path := cfg.LiveKitKeyFile
	if path == "" {
		path = filepath.Join(cfg.StorageDir, "livekit", "keys.yaml")
	}
	keys := voice.Keys{APIKey: cfg.LiveKitAPIKey, APISecret: cfg.LiveKitAPISecret}
	if !keys.Valid() {
		saved, err := store.LiveKitKeys(ctx)
		if err != nil {
			return voice.Keys{}, fmt.Errorf("read saved LiveKit keys: %w", err)
		}
		keys = voice.Keys{APIKey: saved.APIKey, APISecret: saved.APISecret}
	}
	if !keys.Valid() {
		// A key file but no saved pair means the settings were lost
		// without the sidecar being restarted — a wiped database in
		// development, or Postgres restored from an older backup. Adopt
		// what the sidecar is already using rather than minting a pair it
		// would reject until someone restarted it.
		if adopted, err := voice.ReadKeyFile(path); err == nil && adopted.Valid() {
			keys = adopted
			if err := store.SetLiveKitKeys(ctx, instance.LiveKitCredentials{
				APIKey: keys.APIKey, APISecret: keys.APISecret,
			}); err != nil {
				return voice.Keys{}, fmt.Errorf("save adopted LiveKit keys: %w", err)
			}
			log.Info("adopted the LiveKit API key pair already in the key file", "api_key", keys.APIKey, "path", path)
		}
	}
	if !keys.Valid() {
		minted, err := voice.GenerateKeys()
		if err != nil {
			return voice.Keys{}, err
		}
		if err := store.SetLiveKitKeys(ctx, instance.LiveKitCredentials{
			APIKey: minted.APIKey, APISecret: minted.APISecret,
		}); err != nil {
			return voice.Keys{}, fmt.Errorf("save minted LiveKit keys: %w", err)
		}
		keys = minted
		log.Info("minted a LiveKit API key pair for this server", "api_key", keys.APIKey)
	}
	if err := voice.WriteKeyFile(path, keys); err != nil {
		// Not fatal: a sidecar configured its own way still works, and
		// refusing to boot over a key file would be worse than saying so.
		log.Warn("could not write the LiveKit key file; the sidecar needs the same pair some other way",
			"path", path, "error", err)
	}
	return keys, nil
}
