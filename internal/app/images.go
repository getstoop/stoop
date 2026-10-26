package app

import (
	"context"
	"errors"

	"github.com/getstoop/stoop/internal/files"
	"github.com/getstoop/stoop/internal/jobs"
)

// registerImages binds the avatar and icon normalisation and the
// attachment thumbnails to their kinds: a file that cannot be used is
// discarded, anything else is retried, and normalisation hears when a
// try is the last.
func registerImages(registry *jobs.Registry, filesSvc *files.Service) {
	jobs.Register(registry, files.NormaliseImageKind, func(ctx context.Context, job *jobs.Job, args files.NormaliseImageArgs) error {
		err := filesSvc.NormaliseImage(ctx, args, job.Attempt >= job.MaxAttempts)
		if errors.Is(err, files.ErrImageUnusable) {
			return jobs.Discard(err)
		}
		return err
	}, jobs.Options{MaxInFlight: files.NormaliseImageMaxInFlight})
	jobs.Register(registry, files.ThumbnailAttachmentKind, func(ctx context.Context, _ *jobs.Job, args files.ThumbnailAttachmentArgs) error {
		err := filesSvc.ThumbnailAttachment(ctx, args)
		if errors.Is(err, files.ErrNoThumbnail) {
			return jobs.Discard(err)
		}
		return err
	}, jobs.Options{MaxInFlight: files.ThumbnailAttachmentMaxInFlight})
}
