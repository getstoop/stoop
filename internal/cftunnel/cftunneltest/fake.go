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
	// bad token does.
	Env = "STOOP_FAKE_CLOUDFLARED"
	// OriginEnv is the port the fake's tunnel points at.
	OriginEnv = "STOOP_FAKE_CLOUDFLARED_ORIGIN"
	// Hostname is the public hostname the fake's tunnel carries.
	Hostname = "chat.example.com"
)

// Use makes this test binary the fake and returns its path.
func Use(t *testing.T, mode, originPort string) string {
	t.Helper()
	t.Setenv(Env, mode)
	t.Setenv(OriginEnv, originPort)
	return os.Args[0]
}

// Main runs the fake and never returns.
func Main() {
	fail := func(msg string) {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]string{"level": "error", "message": msg})
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
	mux.HandleFunc("/config", func(w http.ResponseWriter, _ *http.Request) {
		// Another service first, so picking by origin is exercised.
		_, _ = fmt.Fprintf(w, `{"version":1,"config":{"ingress":[
			{"hostname":"photos.example.com","service":"http://localhost:2342"},
			{"hostname":%q,"service":"http://localhost:%s"},
			{"hostname":"","service":"http_status:404"}]}}`, Hostname, os.Getenv(OriginEnv))
	})
	go func() { _ = http.Serve(l, mux) }()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, os.Interrupt)
	<-stop
	os.Exit(0)
}
