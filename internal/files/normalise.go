package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Avatars and icons are normalised off the request: UploadAvatar and
// UploadSpaceIcon refuse what is cheap to refuse, store the bytes as a
// pending file and queue a normalise_image job; the job re-encodes the
// file, readies the row, points the account or space at it and announces
// the change. See docs/architecture/files.md → Images.

// NormaliseImageKind is the job kind internal/app registers for
// NormaliseImage, with NormaliseImageMaxInFlight as its cap.
const NormaliseImageKind = "normalise_image"

// NormaliseImageMaxInFlight bounds the decodes running at once across
// every dispatcher: one, so the largest decode the bound allows fits the
// jobs container's memory limit with room.
const NormaliseImageMaxInFlight = 1

// NormaliseImageArgs names the pending file and who shows it once it is
// ready: exactly one of UserID (an avatar) and SpaceID (a space icon) is
// set.
type NormaliseImageArgs struct {
	FileID  string `json:"file_id"`
	UserID  string `json:"user_id,omitempty"`
	SpaceID string `json:"space_id,omitempty"`
}

// ErrImageUnusable is NormaliseImage's permanent failure: the bytes did
// not decode, or the file or its target is gone. The pending file is
// already discarded when it is returned; the job must not be retried.
var ErrImageUnusable = errors.New("image cannot be normalised")

// NormaliseImage performs one normalise_image job: decode, centre-crop,
// scale to the kind's size, re-encode as PNG, replace the blob, ready the
// row, point the user or space at it, delete the file it replaced and
// publish the event clients refetch on. A failure wrapping
// ErrImageUnusable is permanent; any other is retried unless lastAttempt
// is set, in which case the pending file is discarded first.
func (s *Service) NormaliseImage(ctx context.Context, args NormaliseImageArgs, lastAttempt bool) error {
	file, err := s.q.GetFile(ctx, args.FileID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: file %s is gone", ErrImageUnusable, args.FileID)
		}
		return s.failNormalise(ctx, args.FileID, lastAttempt, fmt.Errorf("get file: %w", err))
	}
	// A retry after a crash between readying and the pointer swap finds
	// the row ready already and only has the swap left.
	if file.Pending {
		file, err = s.readyImage(ctx, file)
		if err != nil {
			return s.failNormalise(ctx, args.FileID, lastAttempt, err)
		}
	}
	previous, err := s.pointAt(ctx, file, args)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeNotFound {
			s.discard(ctx, file)
			return fmt.Errorf("%w: %w", ErrImageUnusable, err)
		}
		return s.failNormalise(ctx, args.FileID, lastAttempt, err)
	}
	if previous != file.ID {
		s.deleteFile(ctx, previous)
	}
	if args.UserID != "" {
		s.announceAvatar(ctx, args.UserID)
	}
	return nil
}

// readyImage re-encodes a pending file's bytes to the kind's size,
// replaces the blob (the store writes atomically) and readies the row.
// Bytes that will not decode are permanent: the file is discarded and the
// error wraps ErrImageUnusable.
func (s *Service) readyImage(ctx context.Context, file dbgen.File) (dbgen.File, error) {
	reader, _, err := s.store.Open(ctx, file.StorageKey)
	if err != nil {
		return dbgen.File{}, fmt.Errorf("open blob: %w", err)
	}
	data, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil {
		return dbgen.File{}, fmt.Errorf("read blob: %w", err)
	}
	encoded, err := processImage(data, imageSize(Kind(file.Kind)))
	if err != nil {
		s.discard(ctx, file)
		return dbgen.File{}, fmt.Errorf("%w: %w", ErrImageUnusable, err)
	}
	if err := s.store.Put(ctx, file.StorageKey, bytes.NewReader(encoded), int64(len(encoded)), "image/png"); err != nil {
		return dbgen.File{}, fmt.Errorf("store blob: %w", err)
	}
	sum := sha256.Sum256(encoded)
	ready, err := s.q.ReadyPendingFile(ctx, dbgen.ReadyPendingFileParams{
		ID: file.ID, ContentType: "image/png", Size: int64(len(encoded)), Sha256: sum[:],
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.discard(ctx, file)
			return dbgen.File{}, fmt.Errorf("%w: file %s is gone", ErrImageUnusable, file.ID)
		}
		return dbgen.File{}, fmt.Errorf("ready file: %w", err)
	}
	return ready, nil
}

// imageSize is the square an avatar or icon is scaled to.
func imageSize(kind Kind) int {
	if kind == KindSpaceIcon {
		return SpaceIconSize
	}
	return AvatarSize
}

// pointAt makes the file the target's current image through the owning
// module's port and returns the id it replaced.
func (s *Service) pointAt(ctx context.Context, file dbgen.File, args NormaliseImageArgs) (previous string, err error) {
	if args.SpaceID != "" {
		return s.spaces.SetSpaceIcon(ctx, args.SpaceID, file.ID)
	}
	return s.avatars.SetAvatar(ctx, args.UserID, file.ID)
}

// announceAvatar tells every space the account is in to refetch it, and
// the account's own devices, which hear it whatever spaces it is in.
func (s *Service) announceAvatar(ctx context.Context, userID string) {
	spaceIDs, err := s.spaces.ListSpaceIDs(ctx, userID)
	if err != nil {
		s.log.Warn("avatar changed but spaces not notified", "user_id", userID, "err", err)
	}
	for _, spaceID := range spaceIDs {
		s.publishMemberUpdated(events.SpaceTopic(spaceID), spaceID, userID)
	}
	s.publishMemberUpdated(events.UserTopic(userID), "", userID)
}

func (s *Service) publishMemberUpdated(topic, spaceID, userID string) {
	s.bus.Publish(topic, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_MemberUpdated{
			MemberUpdated: &realtimev1.MemberUpdated{SpaceId: spaceID, UserId: userID},
		},
	}))
}

// failNormalise returns a transient error for the dispatcher to retry; on
// the last attempt the file goes first, so no pending file is left behind.
func (s *Service) failNormalise(ctx context.Context, fileID string, lastAttempt bool, err error) error {
	if lastAttempt {
		s.deleteUnlessReferenced(ctx, fileID)
	}
	return err
}

// deleteUnlessReferenced removes the file a last attempt leaves behind,
// unless a target already points at it: the swap landed and only a step
// after it failed. A reference check that fails leaves the file to the
// sweep.
func (s *Service) deleteUnlessReferenced(ctx context.Context, fileID string) {
	referenced, err := s.referenced(ctx, []string{fileID})
	if err != nil {
		s.log.Warn("could not check whether the file is referenced; left for the sweep", "file_id", fileID, "err", err)
		return
	}
	if !referenced[fileID] {
		s.deleteFile(ctx, fileID)
	}
}
