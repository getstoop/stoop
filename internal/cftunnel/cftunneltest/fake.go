// Package cftunneltest is a stand-in cloudflared. A test binary whose
// TestMain finds Env set calls Main, so the binary can be handed to the
// connector as the cloudflared to run.
package cftunneltest

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"testing"
)

const (
	// Env selects the behaviour: "ok" connects, "reject" fails the way a
	// bad token does, "crash" exits without a word.
	Env = "STOOP_FAKE_CLOUDFLARED"
)

// Use makes this test binary the fake and returns its path.
func Use(t *testing.T, mode string) string {
	t.Helper()
	t.Setenv(Env, mode)
	return os.Args[0]
}

// Main runs the fake and never returns.
func Main() {
	fail := func(msg string) {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]string{"level": "error", "message": msg})
		os.Exit(1)
	}
	if os.Getenv(Env) == "crash" {
		os.Exit(1)
	}
	if os.Getenv(Env) == "reject" || os.Getenv("TUNNEL_TOKEN") == "" {
		fail("Unauthorized: Invalid tunnel secret")
	}
	metrics := ""
	for i, a := range os.Args {
		if a == "--metrics" && i+1 < len(os.Args) {
			metrics = os.Args[i+1]
		}
	}
	l, err := net.Listen("tcp", metrics)
	if err != nil {
		fail(err.Error())
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/ready", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"status":200,"readyConnections":4}`)
	})
	go func() { _ = http.Serve(l, mux) }()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, os.Interrupt)
	<-stop
	os.Exit(0)
}
