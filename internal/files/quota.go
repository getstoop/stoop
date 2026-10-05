package files

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The quota refuses uploads past a cap the operator sets: checkQuota is
// the cheap early answer, insertUnderQuota the one that holds.

// Policy is files' port onto the instance module: the operator's quota.
type Policy interface {
	// StorageQuotaBytes is the cap on total upload storage; 0 is unlimited.
	StorageQuotaBytes(ctx context.Context) (int64, error)
	// MaxUploadBytes is the cap on one uploaded file; 0 means the operator
	// set none and MaxAttachmentBytes applies.
	MaxUploadBytes(ctx context.Context) (int64, error)
	// AttachmentRetentionDays is how long attachments are kept; 0 is
	// forever (retention.go).
	AttachmentRetentionDays(ctx context.Context) (int, error)
}

// UsePolicy wires the quota port. Without one, uploads are unlimited.
func (s *Service) UsePolicy(p Policy) { s.policy = p }

// ErrStorageFull is what an upload gets past the quota; the message
// carries the numbers.
var ErrStorageFull = errors.New("upload storage is full")

// checkQuota fails with ErrStorageFull if adding size would pass the cap.
// It is the cheap early answer before any bytes are accepted; recordFile
// is the one that holds.
func (s *Service) checkQuota(ctx context.Context, size int64) error {
	quota, err := s.quota(ctx)
	if err != nil || quota <= 0 {
		return err
	}
	u, err := s.q.StorageUsage(ctx)
	if err != nil {
		return fmt.Errorf("storage usage: %w", err)
	}
	return fits(u.Bytes, size, quota)
}

func (s *Service) quota(ctx context.Context) (int64, error) {
	if s.policy == nil {
		return 0, nil
	}
	quota, err := s.policy.StorageQuotaBytes(ctx)
	if err != nil {
		return 0, fmt.Errorf("read quota: %w", err)
	}
	return quota, nil
}

func fits(used, size, quota int64) error {
	if used+size > quota {
		return fmt.Errorf("%w (%s of %s used)", ErrStorageFull, FormatBytes(used), FormatBytes(quota))
	}
	return nil
}

// recordFile inserts the file row under the quota (insertUnderQuota). The
// caller has already written the blob; on ErrStorageFull it removes it
// again.
func (s *Service) recordFile(ctx context.Context, params dbgen.CreateFileParams) (dbgen.File, error) {
	return s.insertUnderQuota(ctx, params.Size, func(queries *dbgen.Queries) (dbgen.File, error) {
		return queries.CreateFile(ctx, params)
	})
}

// recordPendingFile is recordFile for an avatar or icon stored as sent,
// which the normalise_image job readies.
func (s *Service) recordPendingFile(ctx context.Context, params dbgen.CreatePendingFileParams) (dbgen.File, error) {
	return s.insertUnderQuota(ctx, params.Size, func(queries *dbgen.Queries) (dbgen.File, error) {
		return queries.CreatePendingFile(ctx, params)
	})
}

// insertUnderQuota runs insert, and with a quota set it does so under an
// advisory lock with the usage summed inside the same transaction, so N
// uploads that each passed checkQuota while the others were in flight
// cannot all land.
func (s *Service) insertUnderQuota(ctx context.Context, size int64, insert func(queries *dbgen.Queries) (dbgen.File, error)) (dbgen.File, error) {
	quota, err := s.quota(ctx)
	if err != nil {
		return dbgen.File{}, err
	}
	if quota <= 0 {
		return insert(s.q)
	}
	var file dbgen.File
	err = db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		qtx := s.q.WithTx(tx)
		if err := qtx.LockStorageQuota(ctx); err != nil {
			return fmt.Errorf("lock quota: %w", err)
		}
		usage, err := qtx.StorageUsage(ctx)
		if err != nil {
			return fmt.Errorf("storage usage: %w", err)
		}
		if err := fits(usage.Bytes, size, quota); err != nil {
			return err
		}
		file, err = insert(qtx)
		return err
	})
	if err != nil {
		return dbgen.File{}, err
	}
	return file, nil
}

// maxUploadBytes is the cap one attachment is measured against
func (s *Service) maxUploadBytes(ctx context.Context) (int64, error) {
	if s.policy == nil {
		return MaxAttachmentBytes, nil
	}
	n, err := s.policy.MaxUploadBytes(ctx)
	if err != nil {
		return 0, fmt.Errorf("read upload limit: %w", err)
	}
	if n <= 0 || n > MaxAttachmentBytes {
		return MaxAttachmentBytes, nil
	}
	return n, nil
}

// FormatBytes renders a size for people: "1.2 GB", "350 MB", "12 kB".
func FormatBytes(n int64) string {
	const k = 1000
	switch {
	case n >= k*k*k:
		return fmt.Sprintf("%.1f GB", float64(n)/(k*k*k))
	case n >= k*k:
		return fmt.Sprintf("%.0f MB", float64(n)/(k*k))
	case n >= k:
		return fmt.Sprintf("%.0f kB", float64(n)/k)
	default:
		return fmt.Sprintf("%d B", n)
	}
}

// quotaError maps ErrStorageFull onto its Connect code; any other error
// passes unchanged.
func quotaError(err error) error {
	if errors.Is(err, ErrStorageFull) {
		return connect.NewError(connect.CodeResourceExhausted, err)
	}
	return err
}
