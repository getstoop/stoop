package cftunnel

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/cftunnel/cftunneltest"
)

func TestMain(m *testing.M) {
	if os.Getenv(cftunneltest.Env) != "" {
		cftunneltest.Main()
	}
	os.Exit(m.Run())
}

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func waitState(t *testing.T, c *Connector, want string) Status {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if st := c.Status(); st.State == want {
			return st
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("state = %+v, want %s", c.Status(), want)
	return Status{}
}

func TestConnector_RunsAndStops(t *testing.T) {
	path := cftunneltest.Use(t, "ok", "8080")
	c := New(Options{Path: path, Token: "secret", OriginPort: "8080"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()

	st := waitState(t, c, "running")
	if st.URL != "https://"+cftunneltest.Hostname || st.Error != "" {
		t.Errorf("status = %+v", st)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("connector did not stop")
	}
}

func TestConnector_RejectedToken(t *testing.T) {
	path := cftunneltest.Use(t, "reject", "8080")
	c := New(Options{Path: path, Token: "secret", OriginPort: "8080"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	if st := waitState(t, c, "error"); st.Error != "Cloudflare rejected the token." {
		t.Errorf("error = %q", st.Error)
	}
}

func TestConnector_Missing(t *testing.T) {
	c := New(Options{Path: "/nonexistent/cloudflared", Token: "secret"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	waitState(t, c, "missing")
}

func TestPublicURL(t *testing.T) {
	cases := []struct{ name, ingress, want string }{
		{"by origin", `[{"hostname":"a.example.com","service":"http://localhost:3000"},{"hostname":"b.example.com","service":"http://127.0.0.1:8080/"}]`, "https://b.example.com"},
		{"the only one, through a proxy", `[{"hostname":"a.example.com","service":"http://caddy:80"},{"hostname":"","service":"http_status:404"}]`, "https://a.example.com"},
		{"no guess among several", `[{"hostname":"a.example.com","service":"http://caddy:80"},{"hostname":"b.example.com","service":"http://x:1"}]`, ""},
		{"skips wildcards and the catch-all", `[{"hostname":"*.example.com","service":"http://localhost:8080"},{"hostname":"","service":"http_status:404"}]`, ""},
	}
	for _, tc := range cases {
		var b configBody
		if err := json.Unmarshal([]byte(`{"config":{"ingress":`+tc.ingress+`}}`), &b); err != nil {
			t.Fatal(err)
		}
		if got := b.publicURL("8080"); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
