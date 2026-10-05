package app

import (
	"testing"

	"github.com/getstoop/stoop/internal/config"
)

// LoadTestConfig is the configuration a test boots the app with: the
// database at databaseURL, a scratch storage directory, then env as
// STOOP_* key/value pairs. The app_test package uses it too.
func LoadTestConfig(t *testing.T, databaseURL string, env ...string) config.Config {
	t.Helper()
	t.Setenv("STOOP_DATABASE_URL", databaseURL)
	t.Setenv("STOOP_STORAGE_DIR", t.TempDir())
	for index := 0; index+1 < len(env); index += 2 {
		t.Setenv(env[index], env[index+1])
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}
