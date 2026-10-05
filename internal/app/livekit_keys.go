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
// where a LiveKit sidecar can read it. See docs/architecture/voice.md →
// Credentials are minted, not configured.
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
		// The wiped-database case: adopt what the sidecar already uses.
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
