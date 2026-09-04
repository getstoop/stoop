package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"

	"github.com/google/uuid"

	"github.com/Jhut89/stoop/internal/dbgen"
)

// StoreLinkPreviewImage re-encodes a fetched preview image (fit within
// LinkPreviewMaxDim, metadata stripped) and stores it as a link_preview
// file. ownerID is the user whose message triggered the fetch — previews
// are shared by URL, but every file has an owner. Implements chat's
// PreviewImages port.
func (s *Service) StoreLinkPreviewImage(ctx context.Context, ownerID string, data []byte) (id string, width, height int, err error) {
	encoded, w, h, err := processImageFit(data, LinkPreviewMaxDim)
	if err != nil {
		return "", 0, 0, err
	}
	uid, err := uuid.NewV7()
	if err != nil {
		return "", 0, 0, err
	}
	key := storageKey(KindLinkPreview, uid.String())
	if err := s.store.Put(ctx, key, bytes.NewReader(encoded), int64(len(encoded)), "image/png"); err != nil {
		return "", 0, 0, fmt.Errorf("store blob: %w", err)
	}
	sum := sha256.Sum256(encoded)
	if _, err := s.q.CreateFile(ctx, dbgen.CreateFileParams{
		ID: uid.String(), Kind: string(KindLinkPreview), OwnerID: ownerID,
		ContentType: "image/png", Size: int64(len(encoded)), Sha256: sum[:], StorageKey: key, Name: "",
	}); err != nil {
		if derr := s.store.Delete(ctx, key); derr != nil {
			s.log.Warn("orphan blob after failed insert", "key", key, "err", derr)
		}
		return "", 0, 0, fmt.Errorf("record file: %w", err)
	}
	return uid.String(), w, h, nil
}
