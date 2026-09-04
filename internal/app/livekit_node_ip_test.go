package app

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/Jhut89/stoop/internal/config"
	"github.com/Jhut89/stoop/internal/voice"
)

// The address goes beside the key file by default, because that is the
// volume the sidecar can already see — so the compose file needs one
// setting, not two.
func TestNodeIPPath(t *testing.T) {
	if got := nodeIPPath(config.Config{StorageDir: "/data"}); got != filepath.Join("/data", "livekit", "node-ip") {
		t.Errorf("with no key file = %q", got)
	}
	if got := nodeIPPath(config.Config{StorageDir: "/data", LiveKitKeyFile: "/livekit-keys/keys.yaml"}); got != "/livekit-keys/node-ip" {
		t.Errorf("beside the key file = %q", got)
	}
	if got := nodeIPPath(config.Config{
		StorageDir: "/data", LiveKitKeyFile: "/livekit-keys/keys.yaml",
		LiveKitNodeIPFile: "/elsewhere/ip",
	}); got != "/elsewhere/ip" {
		t.Errorf("explicit setting = %q", got)
	}
}

// The address file is what LiveKit's entrypoint reads at startup, so
// writing it is the whole job — and writing the same value twice must not
// count as a change, or the entrypoint would restart LiveKit for nothing.
func TestNodeIPWriter(t *testing.T) {
	cfg := config.Config{StorageDir: t.TempDir()}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	w := newNodeIPWriter(cfg, log)
	w.set("100.64.1.2")
	if got, _ := voice.ReadNodeIPFile(nodeIPPath(cfg)); got != "100.64.1.2" {
		t.Fatalf("file holds %q", got)
	}

	// The node going away takes the address with it, so LiveKit stops
	// advertising a tailnet it is no longer on.
	w.set("")
	if got, _ := voice.ReadNodeIPFile(nodeIPPath(cfg)); got != "" {
		t.Fatalf("file should be gone, holds %q", got)
	}

	// A write that can't happen is logged, not fatal.
	broken := newNodeIPWriter(config.Config{LiveKitNodeIPFile: filepath.Join(t.TempDir(), "x")}, log)
	broken.set("not-an-ip")
	if _, err := os.Stat(broken.path); !os.IsNotExist(err) {
		t.Fatal("a refused write must not create the file")
	}
}
