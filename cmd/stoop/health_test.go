package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthURL(t *testing.T) {
	for addr, want := range map[string]string{
		"":               "http://127.0.0.1:8080/healthz",
		":8080":          "http://127.0.0.1:8080/healthz",
		"0.0.0.0:9000":   "http://127.0.0.1:9000/healthz",
		"[::]:9000":      "http://127.0.0.1:9000/healthz",
		"10.0.0.5:8081":  "http://10.0.0.5:8081/healthz",
		"localhost:8082": "http://localhost:8082/healthz",
	} {
		if got := healthURL(addr); got != want {
			t.Errorf("healthURL(%q) = %q, want %q", addr, got, want)
		}
	}
}

func TestRunHealth(t *testing.T) {
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Errorf("path = %q, want /healthz", r.URL.Path)
		}
		w.WriteHeader(status)
	}))
	t.Setenv("STOOP_LISTEN_ADDR", strings.TrimPrefix(srv.URL, "http://"))

	var out bytes.Buffer
	if code := runHealth(&out); code != 0 {
		t.Errorf("200: exit %d, %s", code, out.String())
	}
	status = http.StatusServiceUnavailable
	if code := runHealth(&out); code != 1 {
		t.Errorf("503: exit %d, want 1", code)
	}
	srv.Close()
	out.Reset()
	if code := runHealth(&out); code != 1 || !strings.HasPrefix(out.String(), "unhealthy:") {
		t.Errorf("listener gone: exit %d, %q", code, out.String())
	}
}
