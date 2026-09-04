package app

import (
	"path/filepath"
	"testing"

	"github.com/Jhut89/stoop/internal/voice"
)

// A key file that outlives its settings row — a wiped dev database, or
// Postgres restored from a backup older than the mint — must be adopted,
// not replaced. Minting a fresh pair would leave the running sidecar
// rejecting every token until someone restarted it.
func TestAdoptedKeysBeatMinting(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "livekit", "keys.yaml")
	existing, err := voice.GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	if err := voice.WriteKeyFile(path, existing); err != nil {
		t.Fatal(err)
	}
	back, err := voice.ReadKeyFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if back != existing {
		t.Fatalf("key file round trip: %+v, want %+v", back, existing)
	}
	if !back.Valid() {
		t.Error("an adopted pair should be usable as-is")
	}

	// Nothing to adopt when there is no file: the caller mints instead.
	if _, err := voice.ReadKeyFile(filepath.Join(dir, "absent.yaml")); err == nil {
		t.Error("reading a missing key file should fail so the caller mints")
	}
}
