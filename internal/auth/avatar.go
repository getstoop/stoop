package auth

import (
	"context"
	"fmt"

	"github.com/getstoop/stoop/internal/dbgen"
)

// SetAvatar points a user at a new avatar file (or clears it with "") and
// returns the file id it replaced, "" if none. Exposed for the files
// module's port; the files module owns the file rows and blobs and deletes
// the old one after this returns.
func (s *Service) SetAvatar(ctx context.Context, userID, fileID string) (previous string, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback after commit is a no-op
	qtx := s.q.WithTx(tx)
	prev, err := qtx.GetUserAvatarForUpdate(ctx, userID)
	if err != nil {
		return "", notFoundOr(err, "user")
	}
	var next *string
	if fileID != "" {
		next = &fileID
	}
	if err := qtx.SetUserAvatar(ctx, dbgen.SetUserAvatarParams{ID: userID, AvatarFileID: next}); err != nil {
		return "", fmt.Errorf("set avatar: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	return deref(prev), nil
}

// ReferencedFiles implements the files module's sweep port: which of
// these files are someone's current avatar.
func (s *Service) ReferencedFiles(ctx context.Context, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	return s.q.ReferencedAvatarFileIDs(ctx, ids)
}
