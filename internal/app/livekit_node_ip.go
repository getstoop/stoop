package app

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"time"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/voice"
)

// Keeping LiveKit's advertised address in step with a tailnet node.
//
// LiveKit offers browsers the addresses it can see, and LiveKit only reads it at startup.
// Stoop writes it into the volume the sidecar already shares for the API key pair; the
// compose file's entrypoint starts LiveKit with it and restarts on a
// change.
func nodeIPPath(cfg config.Config) string {
	if cfg.LiveKitNodeIPFile != "" {
		return cfg.LiveKitNodeIPFile
	}
	if cfg.LiveKitKeyFile != "" {
		return filepath.Join(filepath.Dir(cfg.LiveKitKeyFile), "node-ip")
	}
	return filepath.Join(cfg.StorageDir, "livekit", "node-ip")
}

type nodeIPWriter struct {
	path string
	log  *slog.Logger
}

func newNodeIPWriter(cfg config.Config, log *slog.Logger) *nodeIPWriter {
	return &nodeIPWriter{path: nodeIPPath(cfg), log: log}
}

// set records the node's address, or clears it when the node stops. It is
// the tailnet manager's address hook.
func (w *nodeIPWriter) set(ip string) {
	changed, err := voice.WriteNodeIPFile(w.path, ip)
	if err != nil {
		w.log.Error("could not record LiveKit's node address; voice over the tailnet will not work until it is set by hand",
			"path", w.path, "err", err)
		return
	}
	if !changed {
		return
	}
	if ip == "" {
		w.log.Info("cleared LiveKit's node address; it will stop advertising the tailnet when it next starts",
			"path", w.path)
		return
	}
	w.log.Info("recorded LiveKit's node address; LiveKit restarts to pick it up",
		"ip", ip, "path", w.path)
}

// liveKitProbe reports whether the sidecar is answering HTTP at all — any
// reply counts, since this is about the process being there, not about
// what it says.
func liveKitProbe(rawURL string) func(context.Context) bool {
	if rawURL == "" {
		return nil
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil
	}
	switch u.Scheme {
	case "ws":
		u.Scheme = "http"
	case "wss":
		u.Scheme = "https"
	}
	client := &http.Client{Timeout: 2 * time.Second}
	target := u.String()
	return func(ctx context.Context) bool {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return false
		}
		resp, err := client.Do(req)
		if err != nil {
			return false
		}
		_ = resp.Body.Close()
		return true
	}
}
