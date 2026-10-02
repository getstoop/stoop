package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// StoreLinkPreviewImage re-encodes a fetched preview image (fit within
// LinkPreviewMaxDim, metadata stripped; an animation stays a GIF at its
// own size) and stores it as a link_preview file. ownerID is the user whose message triggered the fetch — previews
// are shared by URL, but every file has an owner. Implements chat's
// PreviewImages port.
func (s *Service) StoreLinkPreviewImage(ctx context.Context, ownerID string, data []byte) (id string, width, height int, err error) {
	encoded, contentType, w, h, err := processImageFit(data, LinkPreviewMaxDim)
	if err != nil {
		return "", 0, 0, err
	}
	uid := rowid.New()
	key := storageKey(KindLinkPreview, uid)
	if err := s.store.Put(ctx, key, bytes.NewReader(encoded), int64(len(encoded)), contentType); err != nil {
		return "", 0, 0, fmt.Errorf("store blob: %w", err)
	}
	sum := sha256.Sum256(encoded)
	if _, err := s.q.CreateFile(ctx, dbgen.CreateFileParams{
		ID: uid, Kind: string(KindLinkPreview), OwnerID: ownerID,
		ContentType: contentType, Size: int64(len(encoded)), Sha256: sum[:], StorageKey: key, Name: "",
	}); err != nil {
		if derr := s.store.Delete(ctx, key); derr != nil {
			s.log.Warn("orphan blob after failed insert", "key", key, "err", derr)
		}
		return "", 0, 0, fmt.Errorf("record file: %w", err)
	}
	return uid, w, h, nil
}
