package files

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/blob"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Handler serves GET /files/{id}: authenticate, authorise per kind, then
// stream the blob. Content-Type comes from the file row (never sniffed
// again), nothing is rendered inline unless it is a raster image or
// playable media, and because a file's bytes never change under its id
// the response is cacheable forever.
func (s *Service) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		identity, err := s.sessions.VerifyRequest(r.Context(), r.Header)
		if err != nil {
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		if _, err := uuid.Parse(id); err != nil {
			http.NotFound(w, r)
			return
		}
		f, err := s.q.GetFile(r.Context(), id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.NotFound(w, r)
				return
			}
			s.log.Error("look up file", "file_id", id, "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		ok, err := s.mayDownload(r.Context(), identity, f)
		if err != nil {
			s.log.Error("authorise download", "file_id", f.ID, "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		s.serveBlob(w, r, f)
	})
}

// serveBlob writes the file's bytes, or the window a Range header asks
// for. Raster images and playable media are inline; everything else is a
// download (in particular SVG never renders on the app origin). The
// Content-Length and Content-Range come from the row's size — the record
// of truth, and what the range was resolved against.
func (s *Service) serveBlob(w http.ResponseWriter, r *http.Request, f dbgen.File) {
	h := w.Header()
	h.Set("Content-Type", f.ContentType)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	h.Set("Accept-Ranges", "bytes")
	etag := `"` + f.ID + `"`
	h.Set("ETag", etag)
	if isRaster(f.ContentType) || isPlayable(f.ContentType) {
		h.Set("Content-Disposition", "inline")
	} else {
		h.Set("Content-Disposition", `attachment; filename="`+f.ID+`"`)
	}

	offset, length, status := resolveRange(r.Header, etag, f.Size)
	if status == http.StatusRequestedRangeNotSatisfiable {
		h.Set("Content-Range", "bytes */"+strconv.FormatInt(f.Size, 10))
		http.Error(w, "range not satisfiable", status)
		return
	}
	h.Set("Content-Length", strconv.FormatInt(length, 10))
	if status == http.StatusPartialContent {
		h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, offset+length-1, f.Size))
	}
	if r.Method == http.MethodHead {
		w.WriteHeader(status)
		return
	}

	rc, _, err := s.store.OpenRange(r.Context(), f.StorageKey, offset, length)
	if err != nil {
		if errors.Is(err, blob.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		s.log.Error("open blob", "key", f.StorageKey, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rc.Close() //nolint:errcheck // read-only handle
	w.WriteHeader(status)
	_, _ = io.Copy(w, rc)
}

// mayDownload is the per-kind authorisation rule. Avatars are visible to
// every signed-in user (they appear wherever a name does); space icons
// and message attachments to the space's members and instance admins. An
// attachment with no space belongs to a direct message: its uploader and
// the people in the conversation, and nobody else — not even an admin.
func (s *Service) mayDownload(ctx context.Context, id authctx.Identity, f dbgen.File) (bool, error) {
	switch Kind(f.Kind) {
	case KindAvatar, KindLinkPreview:
		return true, nil
	case KindSpaceIcon, KindAttachment:
		if f.SpaceID == nil {
			if Kind(f.Kind) != KindAttachment {
				return false, nil
			}
			if f.OwnerID == id.UserID {
				return true, nil
			}
			return s.spaces.IsAttachmentReadable(ctx, id.UserID, f.ID)
		}
		if id.Role == authctx.RoleAdmin {
			return true, nil
		}
		return s.spaces.IsSpaceMember(ctx, id.UserID, *f.SpaceID)
	default:
		return false, nil
	}
}
