package cftunnel

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
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
	path := cftunneltest.Use(t, "ok")
	c := New(Options{Path: path, Token: "secret"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()

	st := waitState(t, c, "running")
	if st.Error != "" {
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
	path := cftunneltest.Use(t, "reject")
	c := New(Options{Path: path, Token: "secret"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	if st := waitState(t, c, "error"); st.Error != "Cloudflare rejected the token." {
		t.Errorf("error = %q", st.Error)
	}
}

func TestConnector_ExitsSilently(t *testing.T) {
	path := cftunneltest.Use(t, "crash")
	c := New(Options{Path: path, Token: "secret"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	if st := waitState(t, c, "error"); !strings.Contains(st.Error, "exit status 1") {
		t.Errorf("error = %q", st.Error)
	}
}

func TestConnector_WontStart(t *testing.T) {
	// Executable, but not a program.
	path := filepath.Join(t.TempDir(), "cloudflared")
	if err := os.WriteFile(path, []byte("not a program\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	c := New(Options{Path: path, Token: "secret"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	if st := waitState(t, c, "error"); st.Error == "" {
		t.Errorf("status = %+v", st)
	}
}

func TestConnector_Missing(t *testing.T) {
	c := New(Options{Path: "/nonexistent/cloudflared", Token: "secret"}, quiet)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.Run(ctx)
	waitState(t, c, "missing")
}
