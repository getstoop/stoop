package app

import (
	"context"
	"errors"

	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/jobs"
)

// registerImages binds the avatar and icon normalisation to its kind: a
// file that cannot be used is discarded, anything else is retried, and
// the module hears when a try is the last.
func registerImages(registry *jobs.Registry, filesSvc *files.Service) {
	jobs.Register(registry, files.NormaliseImageKind, func(ctx context.Context, job *jobs.Job, args files.NormaliseImageArgs) error {
		err := filesSvc.NormaliseImage(ctx, args, job.Attempt >= job.MaxAttempts)
		if errors.Is(err, files.ErrImageUnusable) {
			return jobs.Discard(err)
		}
		return err
	}, jobs.Options{MaxInFlight: files.NormaliseImageMaxInFlight})
}
