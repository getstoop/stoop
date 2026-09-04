package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

func (s *Service) UploadAvatar(ctx context.Context, req *connect.Request[filesv1.UploadAvatarRequest]) (*connect.Response[filesv1.UploadAvatarResponse], error) {
	userID := authctx.UserID(ctx)
	f, err := s.storeImage(ctx, KindAvatar, userID, nil, req.Msg.Data, AvatarSize)
	if err != nil {
		return nil, err
	}
	prev, err := s.avatars.SetAvatar(ctx, userID, f.ID)
	if err != nil {
		s.discard(ctx, f)
		return nil, err
	}
	s.deleteFile(ctx, prev)

	// Everyone who can see this user learns to refetch them.
	spaceIDs, err := s.spaces.ListSpaceIDs(ctx, userID)
	if err != nil {
		s.log.Warn("avatar changed but spaces not notified", "user_id", userID, "err", err)
	}
	for _, spaceID := range spaceIDs {
		s.bus.Publish("space:"+spaceID, events.Stamp(&realtimev1.ServerEvent{
			Payload: &realtimev1.ServerEvent_MemberUpdated{
				MemberUpdated: &realtimev1.MemberUpdated{SpaceId: spaceID, UserId: userID},
			},
		}))
	}
	return connect.NewResponse(&filesv1.UploadAvatarResponse{FileId: f.ID}), nil
}

func (s *Service) UploadSpaceIcon(ctx context.Context, req *connect.Request[filesv1.UploadSpaceIconRequest]) (*connect.Response[filesv1.UploadSpaceIconResponse], error) {
	spaceID := req.Msg.SpaceId
	if spaceID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("space_id is required"))
	}
	// Authorise before doing any image work or writing a blob.
	if err := s.spaces.RequireManageSpace(ctx, spaceID); err != nil {
		return nil, err
	}
	f, err := s.storeImage(ctx, KindSpaceIcon, authctx.UserID(ctx), &spaceID, req.Msg.Data, SpaceIconSize)
	if err != nil {
		return nil, err
	}
	prev, err := s.spaces.SetSpaceIcon(ctx, spaceID, f.ID)
	if err != nil {
		s.discard(ctx, f)
		return nil, err
	}
	s.deleteFile(ctx, prev)
	return connect.NewResponse(&filesv1.UploadSpaceIconResponse{FileId: f.ID}), nil
}

// storeImage validates and normalises an image upload, writes the blob,
// and records the file row. Validation failures are InvalidArgument.
func (s *Service) storeImage(ctx context.Context, kind Kind, ownerID string, spaceID *string, data []byte, size int) (dbgen.File, error) {
	encoded, err := processImage(data, size)
	if err != nil {
		return dbgen.File{}, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := s.checkQuota(ctx, int64(len(encoded))); err != nil {
		if errors.Is(err, ErrStorageFull) {
			return dbgen.File{}, connect.NewError(connect.CodeResourceExhausted, err)
		}
		return dbgen.File{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return dbgen.File{}, err
	}
	key := storageKey(kind, id.String())
	if err := s.store.Put(ctx, key, bytes.NewReader(encoded), int64(len(encoded)), "image/png"); err != nil {
		return dbgen.File{}, fmt.Errorf("store blob: %w", err)
	}
	sum := sha256.Sum256(encoded)
	f, err := s.q.CreateFile(ctx, dbgen.CreateFileParams{
		ID: id.String(), Kind: string(kind), OwnerID: ownerID, SpaceID: spaceID,
		ContentType: "image/png", Size: int64(len(encoded)), Sha256: sum[:], StorageKey: key, Name: "",
	})
	if err != nil {
		if derr := s.store.Delete(ctx, key); derr != nil {
			s.log.Warn("orphan blob after failed insert", "key", key, "err", derr)
		}
		return dbgen.File{}, fmt.Errorf("record file: %w", err)
	}
	return f, nil
}

// discard undoes storeImage after a later step failed.
func (s *Service) discard(ctx context.Context, f dbgen.File) {
	if _, err := s.q.DeleteFile(ctx, f.ID); err != nil {
		s.log.Warn("could not delete file row", "file_id", f.ID, "err", err)
	}
	if err := s.store.Delete(ctx, f.StorageKey); err != nil {
		s.log.Warn("could not delete blob", "key", f.StorageKey, "err", err)
	}
}

// deleteFile removes a replaced file's row and blob. Failures are logged,
// not returned: the new file is already in place and an orphan blob is
// harmless (a GC sweep is planned).
func (s *Service) deleteFile(ctx context.Context, id string) {
	if id == "" {
		return
	}
	f, err := s.q.DeleteFile(ctx, id)
	if err != nil {
		s.log.Warn("could not delete replaced file row", "file_id", id, "err", err)
		return
	}
	if err := s.store.Delete(ctx, f.StorageKey); err != nil {
		s.log.Warn("could not delete replaced blob", "key", f.StorageKey, "err", err)
	}
}
