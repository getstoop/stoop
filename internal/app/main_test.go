package app_test

import (
	"os"
	"testing"

	"github.com/getstoop/stoop/internal/cftunnel/cftunneltest"
)

// Run as a fake child process when the tunnel connector or the jobs
// supervisor starts this binary.
func TestMain(m *testing.M) {
	if os.Getenv(cftunneltest.Env) != "" {
		cftunneltest.Main()
	}
	if os.Getenv(fakeJobsEnv) != "" {
		fakeJobsMain()
	}
	os.Exit(m.Run())
}
