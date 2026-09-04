package files

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/Jhut89/stoop/internal/dbgen"
)

const (
	maxNameRunes = 200
	// Form parsing keeps this much in memory; the rest of a part spools to
	// a temp file, so a 100 MB upload doesn't sit in RAM.
	multipartMemory = 1 << 20
	// Slack for the multipart framing and the channel_id field on top of
	// the file itself.
	multipartOverhead = 64 << 10
)

// UploadHandler serves POST /files/upload: a multipart form with a
// channel_id field and one file part. Bytes are stored as sent — no
// re-encoding — so the content type is decided by sniffing (never the
// part's declared type or the filename); anything that isn't a raster
// image or playable media will be served as a download. The row is a pending attachment until a message
// claims it via SendMessage.attachment_ids; unclaimed uploads are left
// for the GC sweep (phase 4).
func (s *Service) UploadHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		identity, err := s.sessions.VerifyRequest(r.Context(), r.Header)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		// The operator's per-file cap
		limit, err := s.maxUploadBytes(r.Context())
		if err != nil {
			s.log.Error("read upload limit", "err", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit+multipartOverhead)
		if err := r.ParseMultipartForm(multipartMemory); err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				writeError(w, http.StatusRequestEntityTooLarge, tooLargeMessage(limit))
				return
			}
			writeError(w, http.StatusBadRequest, "expected a multipart form")
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()

		channelID := r.FormValue("channel_id")
		if _, err := uuid.Parse(channelID); err != nil {
			writeError(w, http.StatusBadRequest, "channel_id is required")
			return
		}
		spaceID, err := s.spaces.ChannelSpaceForMember(r.Context(), identity.UserID, channelID)
		if err != nil {
			switch connect.CodeOf(err) {
			case connect.CodeNotFound:
				writeError(w, http.StatusNotFound, "channel not found")
			case connect.CodePermissionDenied:
				writeError(w, http.StatusForbidden, "not a member of this channel's space")
			default:
				s.log.Error("resolve channel", "channel_id", channelID, "err", err)
				writeError(w, http.StatusInternalServerError, "internal error")
			}
			return
		}

		part, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, http.StatusBadRequest, "expected a file part named \"file\"")
			return
		}
		defer part.Close() //nolint:errcheck // read-only handle
		if header.Size <= 0 {
			writeError(w, http.StatusBadRequest, "the file is empty")
			return
		}
		if header.Size > limit {
			writeError(w, http.StatusRequestEntityTooLarge, tooLargeMessage(limit))
			return
		}
		if err := s.checkQuota(r.Context(), header.Size); err != nil {
			if errors.Is(err, ErrStorageFull) {
				writeError(w, http.StatusInsufficientStorage, "the server's "+err.Error())
				return
			}
			s.log.Error("check quota", "err", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}

		info, err := s.storeAttachment(r, identity.UserID, spaceID, part, header.Size, header.Filename)
		if err != nil {
			s.log.Error("store attachment", "err", err)
			writeError(w, http.StatusInternalServerError, "could not store the file")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(uploadResponse{
			ID: info.ID, Name: info.Name, ContentType: info.ContentType, Size: info.Size,
		})
	})
}

type uploadResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

func tooLargeMessage(limit int64) string {
	return fmt.Sprintf("file must be %d MB or smaller", limit>>20)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// storeAttachment sniffs the first bytes for the content type, then
// streams the whole part into the blob store while hashing it.
func (s *Service) storeAttachment(r *http.Request, ownerID, spaceID string, part io.ReadSeeker, size int64, filename string) (Info, error) {
	ctx := r.Context()
	head := make([]byte, 512)
	n, err := io.ReadFull(part, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return Info{}, fmt.Errorf("read head: %w", err)
	}
	contentType := sniffContentType(head[:n])
	if _, err := part.Seek(0, io.SeekStart); err != nil {
		return Info{}, fmt.Errorf("rewind: %w", err)
	}

	id, err := uuid.NewV7()
	if err != nil {
		return Info{}, err
	}
	key := storageKey(KindAttachment, id.String())
	hasher := sha256.New()
	if err := s.store.Put(ctx, key, io.TeeReader(part, hasher), size, contentType); err != nil {
		return Info{}, fmt.Errorf("store blob: %w", err)
	}
	// A direct message has no space; the file's row says so.
	var space *string
	if spaceID != "" {
		space = &spaceID
	}
	f, err := s.q.CreateFile(ctx, dbgen.CreateFileParams{
		ID: id.String(), Kind: string(KindAttachment), OwnerID: ownerID, SpaceID: space,
		ContentType: contentType, Size: size, Sha256: hasher.Sum(nil), StorageKey: key,
		Name: sanitizeFilename(filename),
	})
	if err != nil {
		if derr := s.store.Delete(ctx, key); derr != nil {
			s.log.Warn("orphan blob after failed insert", "key", key, "err", derr)
		}
		return Info{}, fmt.Errorf("record file: %w", err)
	}
	return toInfo(f), nil
}

// sanitizeFilename keeps a display name that is safe to render and to
// offer as a download: the base name only (either separator), no control
// characters, trimmed, capped, never empty.
func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	name = strings.Map(func(r rune) rune {
		if r == utf8.RuneError || unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "." || name == ".." || name == "/" {
		name = ""
	}
	if utf8.RuneCountInString(name) > maxNameRunes {
		name = string([]rune(name)[:maxNameRunes])
	}
	if name == "" {
		return "file"
	}
	return name
}
