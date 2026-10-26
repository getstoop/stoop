package files

import (
	"bytes"
	"context"
	"crypto/sha256"

	"github.com/getstoop/stoop/internal/dbgen"
)

// StoreLinkPreviewImage re-encodes a fetched preview image (fit within
// LinkPreviewMaxDim, metadata stripped; an animation stays a GIF at its
// own size) and stores it as a link_preview file. ownerID is the user whose message triggered the fetch — previews
// are shared by URL, but every file has an owner. The re-encode waits
// for the decode slot, so it never runs beside a job's decode or another
// fetch's. Implements chat's PreviewImages port.
func (s *Service) StoreLinkPreviewImage(ctx context.Context, ownerID string, data []byte) (id string, width, height int, err error) {
	var encoded []byte
	var contentType string
	if waitErr := s.decodeOne(ctx, func() {
		encoded, contentType, width, height, err = processImageFit(data, LinkPreviewMaxDim)
	}); waitErr != nil {
		return "", 0, 0, waitErr
	}
	if err != nil {
		return "", 0, 0, err
	}
	size := int64(len(encoded))
	file, err := s.storeFile(ctx, KindLinkPreview, bytes.NewReader(encoded), size, contentType, func(id, key string) (dbgen.File, error) {
		sum := sha256.Sum256(encoded)
		return s.q.CreateFile(ctx, dbgen.CreateFileParams{
			ID: id, Kind: string(KindLinkPreview), OwnerID: ownerID,
			ContentType: contentType, Size: size, Sha256: sum[:], StorageKey: key, Name: "",
		})
	})
	if err != nil {
		return "", 0, 0, err
	}
	return file.ID, width, height, nil
}
