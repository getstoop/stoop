package app

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/instance"
	"github.com/getstoop/stoop/internal/voice"
)

type memoryKeyStore struct {
	saved  instance.LiveKitCredentials
	writes int
}

func (store *memoryKeyStore) LiveKitKeys(context.Context) (instance.LiveKitCredentials, error) {
	return store.saved, nil
}

func (store *memoryKeyStore) SetLiveKitKeys(_ context.Context, keys instance.LiveKitCredentials) error {
	store.saved = keys
	store.writes++
	return nil
}

func TestLiveKitKeys(t *testing.T) {
	envPair := voice.Keys{APIKey: "env", APISecret: "env-secret-env-secret-env-secret-0"}
	savedPair := voice.Keys{APIKey: "saved", APISecret: "saved-secret-saved-secret-saved-0"}
	filePair := voice.Keys{APIKey: "file", APISecret: "file-secret-file-secret-file-secr0"}

	cases := []struct {
		name string
		// voiceOff and noURL leave voice unconfigured.
		voiceOff, noURL bool
		env, saved      voice.Keys
		// inFile is what the sidecar's key file already holds.
		inFile voice.Keys
		// want is the pair expected; zero means "a freshly minted one".
		want       voice.Keys
		wantNone   bool
		wantWrites int
	}{
		{name: "no LiveKit URL", noURL: true, wantNone: true},
		{name: "voice off", voiceOff: true, env: envPair, wantNone: true},
		{name: "environment wins", env: envPair, saved: savedPair, inFile: filePair, want: envPair},
		{name: "saved pair reused", saved: savedPair, inFile: filePair, want: savedPair},
		// A key file that outlives its settings row (a wiped dev database,
		// an older backup) is adopted: a new pair would leave the running
		// sidecar rejecting every token until someone restarted it.
		{name: "key file adopted", inFile: filePair, want: filePair, wantWrites: 1},
		{name: "minted", wantWrites: 1},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "livekit", "keys.yaml")
			if test.inFile.Valid() {
				if err := voice.WriteKeyFile(path, test.inFile); err != nil {
					t.Fatal(err)
				}
			}
			cfg := config.Config{
				LiveKitURL: "ws://livekit:7880", Voice: !test.voiceOff, LiveKitKeyFile: path,
				LiveKitAPIKey: test.env.APIKey, LiveKitAPISecret: test.env.APISecret,
			}
			if test.noURL {
				cfg.LiveKitURL = ""
			}
			store := &memoryKeyStore{saved: instance.LiveKitCredentials{APIKey: test.saved.APIKey, APISecret: test.saved.APISecret}}

			got, err := livekitKeys(context.Background(), cfg, store, slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err != nil {
				t.Fatal(err)
			}
			if test.wantNone {
				if got != (voice.Keys{}) || store.writes != 0 {
					t.Fatalf("got %+v with %d writes, want no pair and nothing saved", got, store.writes)
				}
				return
			}
			if !got.Valid() {
				t.Fatalf("got an unusable pair %+v", got)
			}
			if test.want.Valid() && got != test.want {
				t.Errorf("got %+v, want %+v", got, test.want)
			}
			if !test.want.Valid() && (got == envPair || got == savedPair || got == filePair) {
				t.Errorf("got %+v, want a freshly minted pair", got)
			}
			if store.writes != test.wantWrites {
				t.Errorf("saved %d times, want %d", store.writes, test.wantWrites)
			}
			if test.wantWrites > 0 && (store.saved.APIKey != got.APIKey || store.saved.APISecret != got.APISecret) {
				t.Errorf("saved %+v, want the pair in use", store.saved)
			}
			// The sidecar reads whatever pair is in use from the key file.
			if inFile, err := voice.ReadKeyFile(path); err != nil || inFile != got {
				t.Errorf("key file holds %+v (%v), want %+v", inFile, err, got)
			}
		})
	}
}
