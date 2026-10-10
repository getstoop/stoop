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
// stream the blob. See docs/architecture/files.md → Serving.
func (s *Service) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		identity, err := s.sessions.VerifyRequest(r.Context(), r.Header)
		if err != nil && !errors.Is(err, authctx.ErrNoSession) {
			s.log.Error("verify credential for a download", "err", err)
			http.Error(w, unverifiedMessage, http.StatusServiceUnavailable)
			return
		}
		if err != nil {
			if code := r.URL.Query().Get("invite"); code != "" && s.serveInviteIcon(w, r, code) {
				return
			}
			http.Error(w, "authentication required", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		if _, err := uuid.Parse(id); err != nil {
			http.NotFound(w, r)
			return
		}
		file, err := s.q.GetFile(r.Context(), id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				http.NotFound(w, r)
				return
			}
			s.log.Error("look up file", "file_id", id, "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		// An upload the normalise_image job has not readied is not a file yet.
		if file.Pending {
			http.NotFound(w, r)
			return
		}
		ok, err := s.mayDownload(r.Context(), identity, file)
		if err != nil {
			s.log.Error("authorise download", "file_id", file.ID, "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if file.ExpiredAt != nil {
			http.Error(w, "this attachment has expired", http.StatusGone)
			return
		}

		s.serveBlob(w, r, file)
	})
}

// serveInviteIcon serves a space's icon to someone not signed in who holds
// a usable invite to that space, and reports whether it answered. Every
// other case is left to the caller's 401, so the route says nothing about
// which files or codes exist. See docs/architecture/files.md → Serving.
func (s *Service) serveInviteIcon(w http.ResponseWriter, r *http.Request, code string) bool {
	id := r.PathValue("id")
	if _, err := uuid.Parse(id); err != nil {
		return false
	}
	shown, err := s.spaces.InviteShowsIcon(r.Context(), code, id)
	if err != nil {
		s.log.Error("check an invite for its space icon", "file_id", id, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return true
	}
	if !shown {
		return false
	}
	file, err := s.q.GetFile(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false
		}
		s.log.Error("look up file", "file_id", id, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return true
	}
	if file.Pending || Kind(file.Kind) != KindSpaceIcon {
		return false
	}
	s.serveBlob(w, r, file)
	return true
}

// serveBlob writes the file's bytes, or the window a Range header asks
// for, with the headers files.md → Serving lists. Content-Length and
// Content-Range come from the row's size, which the range was resolved
// against.
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

// mayDownload is the per-kind authorisation rule: the table in
// docs/architecture/files.md → Serving.
func (s *Service) mayDownload(ctx context.Context, id authctx.Identity, f dbgen.File) (bool, error) {
	ctx = authctx.WithIdentity(ctx, id)
	switch Kind(f.Kind) {
	case KindAvatar, KindLinkPreview:
		return true, nil
	case KindSpaceIcon, KindAttachment:
		if f.SpaceID == nil {
			if Kind(f.Kind) != KindAttachment || !authctx.Covers(ctx, authctx.DMsRead) {
				return false, nil
			}
			if f.OwnerID == id.UserID {
				return true, nil
			}
			return s.spaces.IsAttachmentReadable(ctx, id.UserID, f.ID)
		}
		return s.spaces.MayReadSpace(ctx, *f.SpaceID)
	default:
		return false, nil
	}
}
