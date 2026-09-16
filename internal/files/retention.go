package files

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Attachment retention: attachments older than the instance's
// attachment_retention_days lose their bytes and their name, and keep a
// row marked expired so the message can still say a file was there.
// Pinned messages' files, avatars, icons and preview images are kept. See
// docs/architecture/files.md#retention.

const retentionSweepDelay = 4 * time.Minute

// RetentionInterval is how often the attachment retention sweep runs.
const RetentionInterval = time.Hour

func retentionCutoff(now time.Time, days int) time.Time {
	return now.Add(-time.Duration(days) * 24 * time.Hour)
}

// kept is the files retention never touches beyond their kind: those on
// pinned messages. Never nil, since the queries treat NULL as "keep all".
func (s *Service) kept(ctx context.Context) ([]string, error) {
	ids, err := s.spaces.PinnedFileIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("pinned files: %w", err)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, nil
}

// CountExpiringAttachments is what SweepAttachments would expire at now
// with a period of days. Exposed for the instance module's
// PreviewRetention.
func (s *Service) CountExpiringAttachments(ctx context.Context, now time.Time, days int) (int64, int64, error) {
	if days <= 0 {
		return 0, 0, nil
	}
	keep, err := s.kept(ctx)
	if err != nil {
		return 0, 0, err
	}
	row, err := s.q.CountExpiringAttachments(ctx, dbgen.CountExpiringAttachmentsParams{
		Before: retentionCutoff(now, days), Keep: keep,
	})
	return row.Files, row.Bytes, err
}

// SweepAttachments expires the attachments the retention setting no
// longer keeps, as of now, and reports how many went. The blob goes
// first: a row marked expired whose blob couldn't be deleted would never
// be looked at again.
func (s *Service) SweepAttachments(ctx context.Context, now time.Time) (int64, error) {
	if s.policy == nil {
		return 0, nil
	}
	days, err := s.policy.AttachmentRetentionDays(ctx)
	if err != nil || days <= 0 {
		return 0, err
	}
	keep, err := s.kept(ctx)
	if err != nil {
		return 0, err
	}
	var expired int64
	for {
		rows, err := s.q.ListExpiringAttachments(ctx, dbgen.ListExpiringAttachmentsParams{
			Before: retentionCutoff(now, days), Keep: keep, Limit: sweepBatch,
		})
		if err != nil {
			return expired, fmt.Errorf("list expiring attachments: %w", err)
		}
		ids := make([]string, 0, len(rows))
		for _, r := range rows {
			if err := s.store.Delete(ctx, r.StorageKey); err != nil && !errors.Is(err, blob.ErrNotFound) {
				s.log.Warn("could not delete an expiring attachment", "key", r.StorageKey, "err", err)
				continue
			}
			ids = append(ids, r.ID)
		}
		if err := s.q.ExpireFiles(ctx, ids); err != nil {
			return expired, fmt.Errorf("expire attachments: %w", err)
		}
		expired += int64(len(ids))
		// A batch where every blob failed would come back unchanged.
		if len(rows) < sweepBatch || len(ids) == 0 {
			break
		}
	}
	if expired > 0 {
		s.log.Info("attachments past retention expired", "expired", expired, "days", days)
	}
	return expired, nil
}

// RunAttachmentSweeper runs SweepAttachments hourly until ctx ends.
func (s *Service) RunAttachmentSweeper(ctx context.Context) {
	run := func() {
		if _, err := s.SweepAttachments(ctx, time.Now()); err != nil && ctx.Err() == nil {
			s.log.Warn("attachment retention sweep failed", "err", err)
		}
	}
	select {
	case <-ctx.Done():
		return
	case <-time.After(retentionSweepDelay):
		run()
	}
	t := time.NewTicker(RetentionInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}
