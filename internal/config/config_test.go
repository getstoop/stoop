package config

import (
	"strings"
	"testing"
)

func TestLoad_Tailscale(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "postgres://x")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Tailscale || cfg.TailscaleFunnel || cfg.TailscaleHostname != "stoop" {
		t.Errorf("defaults = %+v", cfg)
	}

	t.Setenv("STOOP_TAILSCALE", "true")
	t.Setenv("STOOP_TAILSCALE_HOSTNAME", "porch")
	t.Setenv("STOOP_TAILSCALE_AUTHKEY", "tskey-auth-x")
	t.Setenv("STOOP_TAILSCALE_CONTROL_URL", "https://headscale.example.com")
	t.Setenv("STOOP_TAILSCALE_FUNNEL", "1")
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Tailscale || !cfg.TailscaleFunnel || cfg.TailscaleHostname != "porch" ||
		cfg.TailscaleAuthKey != "tskey-auth-x" || cfg.TailscaleControlURL != "https://headscale.example.com" {
		t.Errorf("cfg = %+v", cfg)
	}

	t.Setenv("STOOP_TAILSCALE", "false")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STOOP_TAILSCALE_FUNNEL") {
		t.Errorf("funnel without tailscale should be rejected, got %v", err)
	}

	t.Setenv("STOOP_TAILSCALE_FUNNEL", "")
	t.Setenv("STOOP_TAILSCALE", "maybe")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STOOP_TAILSCALE") {
		t.Errorf("bad bool should be rejected, got %v", err)
	}
}

func TestLoad_TURN(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "postgres://x")
	t.Setenv("STOOP_TURN_URLS", "turn:t.example.com:3478?transport=udp, turns:t.example.com:5349")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STOOP_TURN_USERNAME") {
		t.Errorf("TURN without credentials should be rejected, got %v", err)
	}
	t.Setenv("STOOP_TURN_USERNAME", "u")
	t.Setenv("STOOP_TURN_CREDENTIAL", "p")
	t.Setenv("STOOP_STUN_URLS", "stun:t.example.com:3478")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.TURNURLs) != 2 || cfg.TURNURLs[1] != "turns:t.example.com:5349" || len(cfg.STUNURLs) != 1 {
		t.Errorf("cfg = %+v", cfg)
	}

	t.Setenv("STOOP_CLOUDFLARE_TURN_KEY_ID", "k")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STOOP_CLOUDFLARE_TURN_API_TOKEN") {
		t.Errorf("half a Cloudflare config should be rejected, got %v", err)
	}
	t.Setenv("STOOP_CLOUDFLARE_TURN_API_TOKEN", "tok")
	if cfg, err = Load(); err != nil || cfg.CloudflareTURNKeyID != "k" || cfg.CloudflareTURNAPIToken != "tok" {
		t.Errorf("cfg = %+v, err = %v", cfg, err)
	}
}

func TestLoad_PublicURL(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "postgres://x")
	for _, bad := range []string{"chat.example.com", "ftp://x", "https://", "https://chat.example.com/stoop"} {
		t.Setenv("STOOP_PUBLIC_URL", bad)
		if _, err := Load(); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	t.Setenv("STOOP_PUBLIC_URL", "https://chat.example.com/")
	t.Setenv("STOOP_TRUST_PROXY", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicURL != "https://chat.example.com" || !cfg.TrustProxy {
		t.Errorf("cfg = %+v", cfg)
	}
	if got := cfg.AllowedWSOrigins; len(got) != 3 || got[2] != "chat.example.com" {
		t.Errorf("public host must be an allowed WS origin, got %v", got)
	}
}

func TestLoad_RateLimits(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "postgres://x")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AuthRateLimit != 20 || cfg.SignalingRateLimit != 30 {
		t.Errorf("defaults = auth %d, signaling %d; want 20, 30", cfg.AuthRateLimit, cfg.SignalingRateLimit)
	}
	t.Setenv("STOOP_AUTH_RATE_LIMIT", "0")
	t.Setenv("STOOP_SIGNALING_RATE_LIMIT", "120")
	if cfg, err = Load(); err != nil {
		t.Fatal(err)
	}
	if cfg.AuthRateLimit != 0 || cfg.SignalingRateLimit != 120 {
		t.Errorf("got auth %d, signaling %d; want 0, 120", cfg.AuthRateLimit, cfg.SignalingRateLimit)
	}
	for _, bad := range []string{"-1", "lots", "1.5"} {
		t.Setenv("STOOP_AUTH_RATE_LIMIT", bad)
		if _, err := Load(); err == nil {
			t.Errorf("STOOP_AUTH_RATE_LIMIT=%q should be rejected", bad)
		}
	}
}

func TestLoad_LiveKitMedia(t *testing.T) {
	t.Setenv("STOOP_DATABASE_URL", "postgres://x")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LiveKitMediaHost != "127.0.0.1" || cfg.LiveKitTCPPort != 7881 ||
		cfg.LiveKitUDPStart != 50000 || cfg.LiveKitUDPEnd != 50100 || !cfg.TailscaleVoice {
		t.Fatalf("defaults should match LiveKit's own: %+v", cfg)
	}

	t.Setenv("STOOP_LIVEKIT_MEDIA_HOST", "livekit")
	t.Setenv("STOOP_LIVEKIT_TCP_PORT", "7882")
	t.Setenv("STOOP_LIVEKIT_UDP_PORTS", "60000-60010")
	t.Setenv("STOOP_TAILSCALE_VOICE", "false")
	if cfg, err = Load(); err != nil {
		t.Fatal(err)
	}
	if cfg.LiveKitMediaHost != "livekit" || cfg.LiveKitTCPPort != 7882 ||
		cfg.LiveKitUDPStart != 60000 || cfg.LiveKitUDPEnd != 60010 || cfg.TailscaleVoice {
		t.Fatalf("overrides not applied: %+v", cfg)
	}

	// A single port is a range of one.
	t.Setenv("STOOP_LIVEKIT_UDP_PORTS", "51000")
	if cfg, err = Load(); err != nil {
		t.Fatal(err)
	}
	if cfg.LiveKitUDPStart != 51000 || cfg.LiveKitUDPEnd != 51000 {
		t.Fatalf("single port should be a one-port range, got %d-%d", cfg.LiveKitUDPStart, cfg.LiveKitUDPEnd)
	}

	for _, bad := range []string{"50100-50000", "0-10", "50000-70000", "fifty thousand", ""} {
		t.Setenv("STOOP_LIVEKIT_UDP_PORTS", bad)
		if bad == "" {
			// An empty value falls back to the default rather than failing.
			if cfg, err = Load(); err != nil || cfg.LiveKitUDPStart != 50000 {
				t.Fatalf("empty range should fall back to the default, got %d (%v)", cfg.LiveKitUDPStart, err)
			}
			continue
		}
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STOOP_LIVEKIT_UDP_PORTS") {
			t.Fatalf("%q should be rejected, got %v", bad, err)
		}
	}

	// A range wide enough to be a typo is refused rather than obeyed.
	t.Setenv("STOOP_LIVEKIT_UDP_PORTS", "1000-60000")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "most that will be carried") {
		t.Fatalf("an oversized range should be refused, got %v", err)
	}

	t.Setenv("STOOP_LIVEKIT_UDP_PORTS", "50000-50100")
	t.Setenv("STOOP_LIVEKIT_TCP_PORT", "0")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STOOP_LIVEKIT_TCP_PORT") {
		t.Fatalf("port 0 should be refused, got %v", err)
	}
}
