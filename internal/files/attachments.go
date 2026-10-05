package files

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

const (
	maxNameRunes = 200
	// Form parsing keeps this much in memory; the rest of a part spools to
	// a temp file, so a 100 MB upload doesn't sit in RAM.
	multipartMemory = 1 << 20
	// Room for the multipart framing and the channel_id field on top of
	// the file itself.
	multipartOverhead = 64 << 10
)

// UploadHandler serves POST /files/upload: a multipart form with a
// channel_id field and one file part. See docs/architecture/files.md →
// Two upload paths, for one reason.
func (s *Service) UploadHandler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			writer.Header().Set("Allow", "POST")
			writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		identity, err := s.sessions.VerifyRequest(request.Context(), request.Header)
		if err != nil && !errors.Is(err, authctx.ErrNoSession) {
			s.log.Error("verify credential for an upload", "err", err)
			writeError(writer, http.StatusServiceUnavailable, unverifiedMessage)
			return
		}
		if err != nil {
			writeError(writer, http.StatusUnauthorized, "authentication required")
			return
		}
		// Taken before the body is read, so refused callers spool nothing.
		if !s.inflight.acquire(identity.UserID) {
			writeError(writer, http.StatusTooManyRequests, tooManyUploadsMessage)
			return
		}
		defer s.inflight.release(identity.UserID)
		ctx := authctx.WithIdentity(request.Context(), identity)
		// The operator's per-file cap
		limit, err := s.maxUploadBytes(ctx)
		if err != nil {
			s.log.Error("read upload limit", "err", err)
			writeError(writer, http.StatusInternalServerError, "internal error")
			return
		}
		control := http.NewResponseController(writer)
		body := request.Body
		if s.uploadIdle > 0 {
			body = idleBody{ReadCloser: request.Body, control: control, idle: s.uploadIdle}
		}
		request.Body = http.MaxBytesReader(writer, body, limit+multipartOverhead)
		if err := request.ParseMultipartForm(multipartMemory); err != nil {
			var tooBig *http.MaxBytesError
			switch {
			case errors.As(err, &tooBig):
				writeError(writer, http.StatusRequestEntityTooLarge, tooLargeMessage(limit))
			case errors.Is(err, os.ErrDeadlineExceeded):
				writeError(writer, http.StatusRequestTimeout, "the upload stopped arriving; try again")
			default:
				writeError(writer, http.StatusBadRequest, "expected a multipart form")
			}
			return
		}
		// The body is in; nothing below waits on the client.
		_ = control.SetReadDeadline(time.Time{})
		defer func() { _ = request.MultipartForm.RemoveAll() }()

		channelID := request.FormValue("channel_id")
		if _, err := uuid.Parse(channelID); err != nil {
			writeError(writer, http.StatusBadRequest, "channel_id is required")
			return
		}
		// Membership, the credential's bounds and an announcement channel
		// are chat's answer; the
		// grant is checked here, since the handler isn't a Connect call.
		spaceID, err := s.spaces.ChannelSpaceToPostIn(ctx, identity.UserID, channelID)
		if err != nil {
			var cerr *connect.Error
			switch {
			case connect.CodeOf(err) == connect.CodeNotFound:
				writeError(writer, http.StatusNotFound, "channel not found")
			case errors.As(err, &cerr) && cerr.Code() == connect.CodePermissionDenied:
				writeError(writer, http.StatusForbidden, cerr.Message())
			default:
				s.log.Error("resolve channel", "channel_id", channelID, "err", err)
				writeError(writer, http.StatusInternalServerError, "internal error")
			}
			return
		}
		action := authctx.MessagesPost
		if spaceID == "" {
			action = authctx.DMsPost
		}
		if !authctx.CoversChannel(ctx, action, spaceID, channelID) {
			writeError(writer, http.StatusForbidden, authctx.Refusal(ctx, action).Error())
			return
		}

		part, header, err := request.FormFile("file")
		if err != nil {
			writeError(writer, http.StatusBadRequest, "expected a file part named \"file\"")
			return
		}
		defer part.Close() //nolint:errcheck // read-only handle
		if header.Size <= 0 {
			writeError(writer, http.StatusBadRequest, "the file is empty")
			return
		}
		if header.Size > limit {
			writeError(writer, http.StatusRequestEntityTooLarge, tooLargeMessage(limit))
			return
		}
		if err := s.checkQuota(ctx, header.Size); err != nil {
			if writeStorageFull(writer, err) {
				return
			}
			s.log.Error("check quota", "err", err)
			writeError(writer, http.StatusInternalServerError, "internal error")
			return
		}

		info, err := s.storeAttachment(request, identity.UserID, spaceID, part, header.Size, header.Filename)
		if err != nil {
			if writeStorageFull(writer, err) {
				return
			}
			s.log.Error("store attachment", "err", err)
			writeError(writer, http.StatusInternalServerError, "could not store the file")
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(uploadResponse{
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

// unverifiedMessage answers a request whose credential could not be
// checked, which is not the same as having none.
const unverifiedMessage = "the server can't check your sign-in right now; try again in a moment"

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// writeStorageFull answers 507 when err is ErrStorageFull and reports
// whether it did.
func writeStorageFull(writer http.ResponseWriter, err error) bool {
	if !errors.Is(err, ErrStorageFull) {
		return false
	}
	writeError(writer, http.StatusInsufficientStorage, "the server's "+err.Error())
	return true
}

// storeAttachment sniffs the first bytes for the content type, then
// streams the whole part into the blob store while hashing it.
func (s *Service) storeAttachment(request *http.Request, ownerID, spaceID string, part io.ReadSeeker, size int64, filename string) (Info, error) {
	ctx := request.Context()
	head := make([]byte, 512)
	headLength, err := io.ReadFull(part, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return Info{}, fmt.Errorf("read head: %w", err)
	}
	contentType := sniffContentType(head[:headLength])
	if _, err := part.Seek(0, io.SeekStart); err != nil {
		return Info{}, fmt.Errorf("rewind: %w", err)
	}

	// A direct message has no space; the file's row says so.
	var space *string
	if spaceID != "" {
		space = &spaceID
	}
	hasher := sha256.New()
	file, err := s.storeFile(ctx, KindAttachment, io.TeeReader(part, hasher), size, contentType, func(id, key string) (dbgen.File, error) {
		return s.recordFile(ctx, dbgen.CreateFileParams{
			ID: id, Kind: string(KindAttachment), OwnerID: ownerID, SpaceID: space,
			ContentType: contentType, Size: size, Sha256: hasher.Sum(nil), StorageKey: key,
			Name: sanitizeFilename(filename),
		})
	})
	if err != nil {
		return Info{}, err
	}
	return toInfo(file), nil
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
