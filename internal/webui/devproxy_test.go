package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDevProxy(t *testing.T) {
	var gotHost, gotPath string
	vite := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost, gotPath = r.Host, r.URL.Path
		_, _ = w.Write([]byte("vite"))
	}))

	h, err := DevProxy(vite.URL)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://localhost:8091/src/main.tsx", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "vite" {
		t.Fatalf("code=%d body=%q", rec.Code, rec.Body.String())
	}
	if gotPath != "/src/main.tsx" || gotHost != strings.TrimPrefix(vite.URL, "http://") {
		t.Errorf("Vite saw host=%q path=%q", gotHost, gotPath)
	}

	// Vite not running: say so, rather than a bare 502.
	vite.Close()
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://localhost:8091/", nil))
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "pnpm dev") {
		t.Errorf("with Vite down: code=%d body=%q", rec.Code, rec.Body.String())
	}

	for _, bad := range []string{"", "localhost:5173", "ftp://x", "http://"} {
		if _, err := DevProxy(bad); err == nil {
			t.Errorf("DevProxy(%q) accepted", bad)
		}
	}
}
