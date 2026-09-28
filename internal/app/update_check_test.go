package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/instance"
)

func TestUpdateCheckerSkipsLocalBuilds(t *testing.T) {
	for _, v := range []string{"dev", "", "v0.3.0-next", "abc1234"} {
		if newUpdateChecker(v, slog.Default()) != nil {
			t.Errorf("version %q should not be checked", v)
		}
	}
	if newUpdateChecker("v0.2.0", slog.Default()) == nil {
		t.Error("a release should be checked")
	}
}

func TestUpdateChecker(t *testing.T) {
	body, status, hits := `{"schema":1,"latest":"0.3.0"}`, http.StatusOK, 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if ua := r.Header.Get("User-Agent"); ua != "stoop" {
			t.Errorf("User-Agent = %q", ua)
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	defer srv.Close()

	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	c := newUpdateChecker("0.2.0", slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.url, c.now = srv.URL, func() time.Time { return now }
	ctx := context.Background()
	newer := instance.Update{Latest: "0.3.0", Available: true}

	if got := c.LatestRelease(ctx); got != newer {
		t.Fatalf("first check = %+v", got)
	}
	if c.LatestRelease(ctx); hits != 1 {
		t.Errorf("a fresh answer was fetched again: %d requests", hits)
	}

	// A failed read keeps the last answer and retries sooner.
	now = now.Add(updateTTL)
	status = http.StatusBadGateway
	if got := c.LatestRelease(ctx); got != newer || hits != 2 {
		t.Errorf("after a failure = %+v, %d requests", got, hits)
	}
	now = now.Add(updateRetry - time.Second)
	if c.LatestRelease(ctx); hits != 2 {
		t.Errorf("retried before updateRetry: %d requests", hits)
	}

	now = now.Add(time.Second)
	status, body = http.StatusOK, `{"latest":"0.2.0"}`
	if got := c.LatestRelease(ctx); got != (instance.Update{Latest: "0.2.0"}) || hits != 3 {
		t.Errorf("same release = %+v, %d requests", got, hits)
	}

	// Below the supported floor.
	now = now.Add(updateTTL)
	body = `{"latest":"0.4.0","supported":"0.3.0"}`
	if got := c.LatestRelease(ctx); got != (instance.Update{Latest: "0.4.0", Available: true, Outdated: true}) {
		t.Errorf("below the floor = %+v", got)
	}
	now = now.Add(updateTTL)
	body = `{"latest":"0.2.0","supported":"0.2.0"}`
	if got := c.LatestRelease(ctx); got != (instance.Update{Latest: "0.2.0"}) {
		t.Errorf("on the floor = %+v", got)
	}

	// Anything that is not a version is a failed read.
	for _, bad := range []string{`{"latest":"<script>"}`, `{"latest":""}`, `not json`, `{"latest":"0.9.0","supported":"soon"}`} {
		now = now.Add(updateTTL)
		body = bad
		if got := c.LatestRelease(ctx); got.Latest != "0.2.0" || got.Available {
			t.Errorf("body %q gave %+v", bad, got)
		}
	}
}
