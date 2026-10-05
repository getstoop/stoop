package app

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/db/dbtest"
)

// A start-up that fails after the pool opens must close it: these two
// settings fail late in New, past the migrations.
func TestFailedStartupClosesThePool(t *testing.T) {
	cases := map[string][2]string{
		"bad Vite dev server": {"STOOP_DEV_WEB_URL", "not a url"},
		"bad LiveKit URL":     {"STOOP_LIVEKIT_URL", "ws://[::1"},
	}
	for name, setting := range cases {
		t.Run(name, func(t *testing.T) {
			databaseURL := dbtest.NewURL(t)
			t.Setenv("STOOP_DATABASE_URL", databaseURL)
			t.Setenv("STOOP_STORAGE_DIR", t.TempDir())
			t.Setenv(setting[0], setting[1])
			cfg, err := config.Load()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := New(context.Background(), cfg, slog.New(slog.NewTextHandler(io.Discard, nil))); err == nil {
				t.Fatalf("%s=%q should fail start-up", setting[0], setting[1])
			}

			observer, err := pgxpool.New(context.Background(), databaseURL)
			if err != nil {
				t.Fatal(err)
			}
			defer observer.Close()
			deadline := time.Now().Add(5 * time.Second)
			for {
				var others int
				if err := observer.QueryRow(context.Background(),
					`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`,
				).Scan(&others); err != nil {
					t.Fatal(err)
				}
				if others == 0 {
					return
				}
				if time.Now().After(deadline) {
					t.Fatalf("%d connections still open after a failed start-up", others)
				}
				time.Sleep(50 * time.Millisecond)
			}
		})
	}
}
