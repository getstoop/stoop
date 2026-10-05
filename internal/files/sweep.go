package files

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Storage hygiene: the sweep. A self-hosted disk fills quietly — uploads
// that were never sent, attachments whose channel or space is gone,
// avatars and icons replaced mid-crash, blobs whose row insert failed — so
// the sweep walks the files table and the store and removes what nothing
// points at. Which files are still pointed at is the owning modules'
// knowledge, asked through ports; files never reads their tables.

const (
	// DefaultSweepGrace is how old an unreferenced file must be before the
	// sweep takes it: an upload is unreferenced between the multipart
	// POST and the SendMessage that claims it, and a day is more than any
	// draft lives.
	DefaultSweepGrace = 24 * time.Hour
	sweepBatch        = 500
	unclaimedCursor   = "00000000-0000-0000-0000-000000000000"
)

// UseSweepGrace overrides how old an unreferenced file must be to go.
func (s *Service) UseSweepGrace(d time.Duration) {
	if d > 0 {
		s.grace = d
	}
}

// SweepReport is what one pass removed.
type SweepReport struct {
	Files      int   // rows (and their blobs) nothing referenced
	Bytes      int64 // their size
	StrayBlobs int   // blobs in the store with no row
	StrayBytes int64
	Errors     int // removals that failed and were logged
}

// Sweep removes unreferenced files and stray blobs older than the grace
// period. Safe to run at any time: a file younger than the grace period
// is never touched, and a referenced one never is.
func (s *Service) Sweep(ctx context.Context) (SweepReport, error) {
	var rep SweepReport
	before := time.Now().Add(-s.grace)

	// Rows first: page by id, ask the owners which are still pointed at.
	after := unclaimedCursor
	for {
		rows, err := s.q.ListFilesOlderThan(ctx, dbgen.ListFilesOlderThanParams{
			Before: before, AfterID: after, Limit: sweepBatch,
		})
		if err != nil {
			return rep, fmt.Errorf("list files: %w", err)
		}
		if len(rows) == 0 {
			break
		}
		after = rows[len(rows)-1].ID
		ids := make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		referenced, err := s.referenced(ctx, ids)
		if err != nil {
			return rep, err
		}
		for _, f := range rows {
			if referenced[f.ID] {
				continue
			}
			if _, err := s.q.DeleteFile(ctx, f.ID); err != nil {
				s.log.Warn("sweep: could not delete file row", "file_id", f.ID, "err", err)
				rep.Errors++
				continue
			}
			if err := s.store.Delete(ctx, f.StorageKey); err != nil && !errors.Is(err, blob.ErrNotFound) {
				s.log.Warn("sweep: could not delete blob", "key", f.StorageKey, "err", err)
				rep.Errors++
				continue
			}
			rep.Files++
			rep.Bytes += f.Size
		}
		if len(rows) < sweepBatch {
			break
		}
	}

	// Then the store: any blob old enough that no row names.
	var keys []string
	sizes := map[string]int64{}
	flush := func() error {
		if len(keys) == 0 {
			return nil
		}
		known, err := s.q.ListStorageKeysAmong(ctx, keys)
		if err != nil {
			return fmt.Errorf("match blobs to rows: %w", err)
		}
		have := make(map[string]bool, len(known))
		for _, k := range known {
			have[k] = true
		}
		for _, k := range keys {
			if have[k] {
				continue
			}
			if err := s.store.Delete(ctx, k); err != nil && !errors.Is(err, blob.ErrNotFound) {
				s.log.Warn("sweep: could not delete stray blob", "key", k, "err", err)
				rep.Errors++
				continue
			}
			rep.StrayBlobs++
			rep.StrayBytes += sizes[k]
		}
		keys = keys[:0]
		clear(sizes)
		return nil
	}
	err := s.store.Walk(ctx, func(key string, st blob.Stat) error {
		if st.ModTime.After(before) {
			return nil
		}
		keys = append(keys, key)
		sizes[key] = st.Size
		if len(keys) >= sweepBatch {
			return flush()
		}
		return nil
	})
	if err != nil {
		return rep, fmt.Errorf("walk store: %w", err)
	}
	if err := flush(); err != nil {
		return rep, err
	}

	if rep.Files > 0 || rep.StrayBlobs > 0 || rep.Errors > 0 {
		s.log.Info("files swept", "files", rep.Files, "bytes", rep.Bytes,
			"stray_blobs", rep.StrayBlobs, "stray_bytes", rep.StrayBytes, "errors", rep.Errors)
	}
	return rep, nil
}

// referenced asks each owning module which of the ids it still points at.
func (s *Service) referenced(ctx context.Context, ids []string) (map[string]bool, error) {
	out := make(map[string]bool, len(ids))
	fromChat, err := s.spaces.ReferencedFiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("chat references: %w", err)
	}
	fromAuth, err := s.avatars.ReferencedFiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("auth references: %w", err)
	}
	for _, id := range fromChat {
		out[id] = true
	}
	for _, id := range fromAuth {
		out[id] = true
	}
	return out, nil
}

// SweepFilesKind is the job kind internal/app registers for Sweep.
const SweepFilesKind = "sweep_files"

// SweepFiles queues one sweep_files job and returns its id; the
// Diagnostics tab shows the pass.
func (s *Service) SweepFiles(ctx context.Context, _ *connect.Request[filesv1.SweepFilesRequest]) (*connect.Response[filesv1.SweepFilesResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceFilesManage); err != nil {
		return nil, err
	}
	if s.jobs == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("the job queue is not running"))
	}
	id, err := s.jobs.Enqueue(ctx, SweepFilesKind, nil)
	if err != nil {
		return nil, fmt.Errorf("queue file sweep: %w", err)
	}
	return connect.NewResponse(&filesv1.SweepFilesResponse{JobId: id}), nil
}
