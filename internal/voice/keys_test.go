package voice_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/getstoop/stoop/internal/voice"
)

func TestGenerateKeys(t *testing.T) {
	a, err := voice.GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	if !a.Valid() {
		t.Fatalf("generated pair is not valid: %+v", a)
	}
	if len(a.APISecret) < 32 {
		t.Errorf("LiveKit needs a secret of at least 32 characters, got %d", len(a.APISecret))
	}
	b, err := voice.GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	if a.APIKey == b.APIKey || a.APISecret == b.APISecret {
		t.Error("two mints produced the same credentials")
	}
	for _, k := range []voice.Keys{{}, {APIKey: "APIabc"}, {APIKey: "APIabc", APISecret: "short"}} {
		if k.Valid() {
			t.Errorf("%+v reported valid", k)
		}
	}
}

// LiveKit refuses a key file others can read, so the mode matters as much
// as the contents.
func TestWriteKeyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "livekit", "keys.yaml")
	k, err := voice.GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	if err := voice.WriteKeyFile(path, k); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("key file mode is %o, want 600 (LiveKit refuses others-readable)", mode)
	}
	if mode := dirMode(t, filepath.Dir(path)); mode != 0o700 {
		t.Errorf("key directory mode is %o, want 700", mode)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := k.APIKey + ": " + k.APISecret + "\n"; string(raw) != want {
		t.Errorf("key file is %q, want %q", raw, want)
	}
	back, err := voice.ReadKeyFile(path)
	if err != nil || back != k {
		t.Errorf("round trip: %+v %v", back, err)
	}

	// Rewriting replaces it in place, leaving no temp files behind.
	k2, _ := voice.GenerateKeys()
	if err := voice.WriteKeyFile(path, k2); err != nil {
		t.Fatal(err)
	}
	back, _ = voice.ReadKeyFile(path)
	if back != k2 {
		t.Errorf("rewrite: %+v", back)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("expected only keys.yaml, got %d entries", len(entries))
	}

	if err := voice.WriteKeyFile(filepath.Join(dir, "nope.yaml"), voice.Keys{}); err == nil {
		t.Error("an incomplete pair was written")
	}
}

func dirMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}
