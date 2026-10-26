package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The thumbnail_attachment job. See docs/architecture/files.md →
// Thumbnails.

// ThumbnailAttachmentKind is the job kind internal/app registers for
// ThumbnailAttachment, with ThumbnailAttachmentMaxInFlight as its cap.
const ThumbnailAttachmentKind = "thumbnail_attachment"

// ThumbnailAttachmentMaxInFlight is one, for the reason
// NormaliseImageMaxInFlight is.
const ThumbnailAttachmentMaxInFlight = 1

// ThumbnailAttachmentArgs names the original attachment.
type ThumbnailAttachmentArgs struct {
	FileID string `json:"file_id"`
}

// ErrNoThumbnail is ThumbnailAttachment's permanent failure: the original
// is gone, expired or won't decode. The job must not be retried.
var ErrNoThumbnail = errors.New("no thumbnail can be made")

// queueThumbnail queues the job for a stored attachment. The upload has
// succeeded whatever happens here: an image without a thumbnail is
// served as it is.
func (s *Service) queueThumbnail(ctx context.Context, fileID string) {
	if s.jobs == nil {
		return
	}
	if _, err := s.jobs.Enqueue(ctx, ThumbnailAttachmentKind, ThumbnailAttachmentArgs{FileID: fileID}); err != nil {
		s.log.Warn("could not queue a thumbnail", "file_id", fileID, "err", err)
	}
}

// ThumbnailAttachment performs one thumbnail_attachment job: decode the
// original from its blob, make the thumbnail and store it as the
// original's attachment_thumbnail row. An image that needs none (small,
// animated, out of shape, over the bound, or one whose thumbnail would
// be no smaller) is a success with nothing stored, as is an original
// that already has one.
func (s *Service) ThumbnailAttachment(ctx context.Context, args ThumbnailAttachmentArgs) error {
	original, err := s.q.GetFile(ctx, args.FileID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: file %s is gone", ErrNoThumbnail, args.FileID)
		}
		return fmt.Errorf("get file: %w", err)
	}
	if Kind(original.Kind) != KindAttachment || original.ExpiredAt != nil {
		return fmt.Errorf("%w: file %s is not a live attachment", ErrNoThumbnail, args.FileID)
	}
	existing, err := s.q.ListThumbnailsOf(ctx, []string{original.ID})
	if err != nil {
		return fmt.Errorf("look up thumbnail: %w", err)
	}
	if len(existing) > 0 {
		return nil
	}
	thumb, err := s.thumbnailOf(ctx, original)
	if errors.Is(err, errNoThumbnailNeeded) {
		return nil
	}
	if err != nil {
		return err
	}
	// A thumbnail no smaller than the original saves nobody anything.
	if int64(len(thumb.data)) >= original.Size {
		return nil
	}
	sum := sha256.Sum256(thumb.data)
	size := int64(len(thumb.data))
	_, err = s.storeFile(ctx, KindAttachmentThumbnail, bytes.NewReader(thumb.data), size, thumb.contentType, func(id, key string) (dbgen.File, error) {
		return s.q.CreateThumbnail(ctx, dbgen.CreateThumbnailParams{
			ID: id, OwnerID: original.OwnerID, SpaceID: original.SpaceID,
			ContentType: thumb.contentType, Size: size, Sha256: sum[:], StorageKey: key,
			ThumbnailOf: original.ID, Width: int32(thumb.width), Height: int32(thumb.height),
		})
	})
	// No row means a retry beat this one to it; storeFile took the blob back.
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

// thumbnailOf reads the original's blob and makes its thumbnail in the
// decode slot (decodeOne). Bytes that won't decode wrap ErrNoThumbnail.
func (s *Service) thumbnailOf(ctx context.Context, original dbgen.File) (thumbnail, error) {
	reader, _, err := s.store.Open(ctx, original.StorageKey)
	if errors.Is(err, blob.ErrNotFound) {
		return thumbnail{}, fmt.Errorf("%w: %w", ErrNoThumbnail, err)
	}
	if err != nil {
		return thumbnail{}, fmt.Errorf("open blob: %w", err)
	}
	defer reader.Close() //nolint:errcheck // read-only handle
	// The fs store hands back the file itself.
	file, ok := reader.(io.ReadSeeker)
	if !ok {
		return thumbnail{}, fmt.Errorf("%w: the store's reader can't seek", ErrNoThumbnail)
	}
	var thumb thumbnail
	if waitErr := s.decodeOne(ctx, func() {
		thumb, err = makeThumbnail(file, original.ContentType)
	}); waitErr != nil {
		return thumbnail{}, waitErr
	}
	if errors.Is(err, errNotAnImage) {
		return thumbnail{}, fmt.Errorf("%w: %w", ErrNoThumbnail, err)
	}
	return thumb, err
}
