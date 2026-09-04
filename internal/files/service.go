// Package files owns uploaded files: the files table, the upload RPCs, and
// the GET /files/{id} download handler. Bytes live in a blob.Store — the
// only thing that touches storage — and the modules that display a file
// (auth for avatars, chat for space icons) keep a pointer to the current
// one, set through the ports below. Nothing else knows where bytes live.
package files

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/blob"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

// Kind is a file's purpose; it decides the size cap, the image treatment,
// and who may download it.
type Kind string

const (
	KindAvatar     Kind = "avatar"
	KindSpaceIcon  Kind = "space_icon"
	KindAttachment Kind = "attachment"
	// KindLinkPreview is a page's preview image, fetched and re-encoded by
	// the server for link unfurling. Visible to any signed-in user.
	KindLinkPreview Kind = "link_preview"
)

// MaxAttachmentBytes caps one message attachment. 100 MB is deliberately
// the ceiling: Cloudflare Tunnel on the free plan rejects larger request
// bodies, and going past it means chunked uploads, a separate piece of
// work. See docs/self-hosting.md.
const MaxAttachmentBytes = 100 << 20

// Avatars is files' port onto the auth module: the current avatar pointer.
type Avatars interface {
	// SetAvatar points the user at fileID ("" clears) and returns the id
	// it replaced ("" if none).
	SetAvatar(ctx context.Context, userID, fileID string) (previous string, err error)
	// ReferencedFiles reports which of these ids are someone's current
	// avatar. For the sweep.
	ReferencedFiles(ctx context.Context, ids []string) ([]string, error)
}

// Spaces is files' port onto the chat module: icon pointers and the
// membership facts downloads are authorised against.
type Spaces interface {
	// RequireManageSpace fails (with a Connect error) unless the caller in
	// ctx may change the space's settings.
	RequireManageSpace(ctx context.Context, spaceID string) error
	// SetSpaceIcon points the space at fileID ("" clears), announces the
	// change to members, and returns the id it replaced ("" if none).
	SetSpaceIcon(ctx context.Context, spaceID, fileID string) (previous string, err error)
	IsSpaceMember(ctx context.Context, userID, spaceID string) (bool, error)
	// ListSpaceIDs is used to tell a user's spaces about a new avatar.
	ListSpaceIDs(ctx context.Context, userID string) ([]string, error)
	// ChannelSpaceForMember returns the channel's space id ("" for a
	// direct message) if the user may read it; otherwise a Connect
	// NotFound / PermissionDenied error.
	ChannelSpaceForMember(ctx context.Context, userID, channelID string) (string, error)
	// IsAttachmentReadable reports whether the file is attached to a
	// message the user can read. The download rule for attachments that
	// have no space (direct messages).
	IsAttachmentReadable(ctx context.Context, userID, fileID string) (bool, error)
	// ReferencedFiles reports which of these ids chat still points at (an
	// attachment on a message, a preview image, a space icon). For the
	// sweep.
	ReferencedFiles(ctx context.Context, ids []string) ([]string, error)
}

// Info is what other modules (chat, through its port) learn about a file.
type Info struct {
	ID          string
	Kind        Kind
	OwnerID     string
	SpaceID     string
	Name        string
	ContentType string
	Size        int64
}

// SessionVerifier authenticates the download handler's plain HTTP requests
// (they don't pass through the Connect interceptor). Backed by auth.
type SessionVerifier interface {
	VerifyRequest(ctx context.Context, h http.Header) (authctx.Identity, error)
}

type Service struct {
	q        *dbgen.Queries
	store    blob.Store
	bus      events.Bus
	avatars  Avatars
	spaces   Spaces
	sessions SessionVerifier
	policy   Policy
	grace    time.Duration
	log      *slog.Logger
}

func New(pool *pgxpool.Pool, store blob.Store, bus events.Bus, avatars Avatars, spaces Spaces, sessions SessionVerifier, log *slog.Logger) *Service {
	return &Service{
		q: dbgen.New(pool), store: store, bus: bus,
		avatars: avatars, spaces: spaces, sessions: sessions, log: log,
		grace: DefaultSweepGrace,
	}
}

// storageKey is the blob key for a file: {kind}/{id}, never a client name.
func storageKey(kind Kind, id string) string { return string(kind) + "/" + id }

func toInfo(f dbgen.File) Info {
	info := Info{
		ID: f.ID, Kind: Kind(f.Kind), OwnerID: f.OwnerID, Name: f.Name,
		ContentType: f.ContentType, Size: f.Size,
	}
	if f.SpaceID != nil {
		info.SpaceID = *f.SpaceID
	}
	return info
}

// GetFiles looks up files by id; unknown ids are simply absent. Exposed
// for chat's port, which verifies attachment claims with it.
func (s *Service) GetFiles(ctx context.Context, ids []string) ([]Info, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := s.q.GetFilesByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("get files: %w", err)
	}
	out := make([]Info, len(rows))
	for i, r := range rows {
		out[i] = toInfo(r)
	}
	return out, nil
}

// DeleteFiles removes rows and blobs. Exposed for chat's port (a deleted
// message takes its attachments with it). A blob that can't be removed is
// logged and left for the GC sweep; the rows are gone regardless.
func (s *Service) DeleteFiles(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.q.DeleteFilesByIDs(ctx, ids)
	if err != nil {
		return fmt.Errorf("delete files: %w", err)
	}
	for _, f := range rows {
		if err := s.store.Delete(ctx, f.StorageKey); err != nil {
			s.log.Warn("could not delete blob", "key", f.StorageKey, "err", err)
		}
	}
	return nil
}
