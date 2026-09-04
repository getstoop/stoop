package voice_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Jhut89/stoop/internal/voice"
)

func TestNodeIPFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "livekit", "node-ip")

	// Absent reads as "": LiveKit works the address out for itself.
	if got, err := voice.ReadNodeIPFile(path); err != nil || got != "" {
		t.Fatalf("missing file = %q, %v; want empty", got, err)
	}
	// Removing one that was never there changes nothing.
	if changed, err := voice.WriteNodeIPFile(path, ""); err != nil || changed {
		t.Fatalf("clearing an absent file: changed=%v err=%v", changed, err)
	}

	changed, err := voice.WriteNodeIPFile(path, "100.64.1.2")
	if err != nil || !changed {
		t.Fatalf("first write: changed=%v err=%v", changed, err)
	}
	if got, _ := voice.ReadNodeIPFile(path); got != "100.64.1.2" {
		t.Fatalf("read back %q", got)
	}
	// The sidecar reads this through a shell, so it must not be 0600 the
	// way the key file is.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("mode = %v, want 0644", info.Mode().Perm())
	}

	// Writing the same address again is not a change — that's the signal
	// for "LiveKit needs restarting", so it must not cry wolf on a boot
	// where nothing moved.
	if changed, err := voice.WriteNodeIPFile(path, "100.64.1.2"); err != nil || changed {
		t.Fatalf("rewriting the same address: changed=%v err=%v", changed, err)
	}
	if changed, err := voice.WriteNodeIPFile(path, "100.64.9.9"); err != nil || !changed {
		t.Fatalf("a new address should count as a change: changed=%v err=%v", changed, err)
	}

	// Turning Tailscale off takes the address away again.
	if changed, err := voice.WriteNodeIPFile(path, ""); err != nil || !changed {
		t.Fatalf("clearing: changed=%v err=%v", changed, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("file should be gone: %v", err)
	}

	// Nonsense never reaches the file.
	for _, bad := range []string{"not-an-ip", "fd7a::1", "100.64.1.2/32"} {
		if _, err := voice.WriteNodeIPFile(path, bad); err == nil {
			t.Fatalf("%q should be refused", bad)
		}
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("a refused write must not create the file")
	}
}
