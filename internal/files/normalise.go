package files

import (
	"context"
	"errors"
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
// every dispatcher; two 4096×4096 decodes fit the jobs container's
// memory limit.
const NormaliseImageMaxInFlight = 2

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
	return errors.New("normalise_image is not built yet")
}
