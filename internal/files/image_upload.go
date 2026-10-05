package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	filesv1 "github.com/getstoop/stoop/gen/stoop/files/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// Avatars and icons are accepted here and normalised by the
// normalise_image job (normalise.go): the request refuses what is cheap to
// refuse, stores the bytes as sent under a pending row and queues the job.
// The account or space still shows its old image until the job swaps the
// pointer. See docs/architecture/files.md → Images.

func (s *Service) UploadAvatar(ctx context.Context, req *connect.Request[filesv1.UploadAvatarRequest]) (*connect.Response[filesv1.UploadAvatarResponse], error) {
	if id, _ := authctx.From(ctx); id.Kind == authctx.KindBot {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("a bot's avatar is set by a server admin"))
	}
	fileID, err := s.queueAvatar(ctx, NormaliseImageArgs{UserID: authctx.UserID(ctx)}, req.Msg.Data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&filesv1.UploadAvatarResponse{FileId: fileID}), nil
}

// UploadBotAvatar is the admin's path to a bot's face: the same image
// pipeline as UploadAvatar, aimed at a bot the caller manages.
func (s *Service) UploadBotAvatar(ctx context.Context, req *connect.Request[filesv1.UploadBotAvatarRequest]) (*connect.Response[filesv1.UploadBotAvatarResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceIntegrationsManage); err != nil {
		return nil, err
	}
	if err := rowid.Require(req.Msg.UserId, "bot"); err != nil {
		return nil, err
	}
	bot, err := s.avatars.IsBot(ctx, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	if !bot {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("only a bot's avatar can be set for it; people set their own"))
	}
	fileID, err := s.queueAvatar(ctx, NormaliseImageArgs{UserID: req.Msg.UserId, UploaderID: authctx.UserID(ctx)}, req.Msg.Data)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&filesv1.UploadBotAvatarResponse{FileId: fileID}), nil
}

// queueAvatar queues the picture in args.UserID's lane.
func (s *Service) queueAvatar(ctx context.Context, args NormaliseImageArgs, data []byte) (string, error) {
	return s.queueImage(ctx, KindAvatar, args.UserID, nil, data, args, "avatar:"+args.UserID)
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
	fileID, err := s.queueImage(ctx, KindSpaceIcon, authctx.UserID(ctx), &spaceID, req.Msg.Data, NormaliseImageArgs{SpaceID: spaceID}, "space_icon:"+spaceID)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&filesv1.UploadSpaceIconResponse{FileId: fileID}), nil
}

// queueImage refuses what the request can tell cheaply, stores the bytes
// as sent under a pending row and queues the normalise_image job in the
// target's lane, so two uploads for one target apply in arrival order.
func (s *Service) queueImage(ctx context.Context, kind Kind, ownerID string, spaceID *string, data []byte, args NormaliseImageArgs, lane string) (string, error) {
	// The lane runs in sequence order, so the sequence is the moment the
	// request arrived, before anything that takes time.
	sequence := time.Now().UnixNano()
	if s.jobs == nil {
		return "", connect.NewError(connect.CodeUnavailable, errors.New("the job queue is not running"))
	}
	contentType, err := validateImage(data)
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, err)
	}
	file, err := s.storePendingImage(ctx, kind, ownerID, spaceID, data, contentType)
	if err != nil {
		return "", err
	}
	args.FileID = file.ID
	if _, err := s.jobs.EnqueueInLane(ctx, NormaliseImageKind, args, lane, sequence); err != nil {
		s.discard(ctx, file)
		return "", fmt.Errorf("queue %s: %w", NormaliseImageKind, err)
	}
	return file.ID, nil
}

// storePendingImage writes the upload's own bytes and records the pending
// row, with the quota checked on their size. Quota failures are
// ResourceExhausted.
func (s *Service) storePendingImage(ctx context.Context, kind Kind, ownerID string, spaceID *string, data []byte, contentType string) (dbgen.File, error) {
	size := int64(len(data))
	if err := s.checkQuota(ctx, size); err != nil {
		return dbgen.File{}, quotaError(err)
	}
	id := rowid.New()
	key := storageKey(kind, id)
	if err := s.store.Put(ctx, key, bytes.NewReader(data), size, contentType); err != nil {
		return dbgen.File{}, fmt.Errorf("store blob: %w", err)
	}
	sum := sha256.Sum256(data)
	file, err := s.recordPendingFile(ctx, dbgen.CreatePendingFileParams{
		ID: id, Kind: string(kind), OwnerID: ownerID, SpaceID: spaceID,
		ContentType: contentType, Size: size, Sha256: sum[:], StorageKey: key,
	})
	if err != nil {
		if derr := s.store.Delete(ctx, key); derr != nil {
			s.log.Warn("orphan blob after failed insert", "key", key, "err", derr)
		}
		if errors.Is(err, ErrStorageFull) {
			return dbgen.File{}, quotaError(err)
		}
		return dbgen.File{}, fmt.Errorf("record file: %w", err)
	}
	return file, nil
}
