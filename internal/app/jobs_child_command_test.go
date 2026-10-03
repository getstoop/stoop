package app

import (
	"io"
	"log/slog"
)

// newTestJobsChild is a supervisor over a command that is never started.
func newTestJobsChild() *jobsChild {
	return newJobsChild("stoop", []string{"jobs"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}
