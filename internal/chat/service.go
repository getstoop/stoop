// Package chat owns spaces, channels, messages, and invites. It publishes domain
// events to the bus (the realtime gateway delivers them) and resolves user
// info through its UserDirectory port — it never imports other modules.
package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

const defaultChannelName = "general"

// UserRecord is the user info chat needs to render authors.
type UserRecord struct {
	ID          string
	Username    string
	DisplayName string
	// InstanceAdmin marks server operators, who hold admin in every space.
	InstanceAdmin bool
	AvatarFileID  string
}

// UserDirectory is chat's port for looking up users; implemented by the auth
// module and wired in internal/app.
type UserDirectory interface {
	GetUsers(ctx context.Context, ids []string) ([]UserRecord, error)
}

// InstancePolicy is chat's port for instance-wide settings it must honour;
// backed by the instance module, wired in internal/app. A nil port means
// "everyone may create spaces".
type InstancePolicy interface {
	MembersMayCreateSpaces(ctx context.Context) (bool, error)
}

// PresenceLister is chat's port onto the realtime gateway: which of these
// users are connected right now. Used for @here. Nil means nobody.
type PresenceLister interface {
	OnlineUserIDs(ctx context.Context, ids []string) ([]string, error)
}

// FileRecord is what chat needs to know about an uploaded file.
type FileRecord struct {
	ID          string
	Kind        string
	OwnerID     string
	SpaceID     string
	Name        string
	ContentType string
	Size        int64
}

// FileDirectory is chat's port onto the files module: verify attachment
// claims and delete a deleted message's files. Nil means attachments are
// unavailable and SendMessage refuses them.
type FileDirectory interface {
	GetFiles(ctx context.Context, ids []string) ([]FileRecord, error)
	DeleteFiles(ctx context.Context, ids []string) error
}

type Service struct {
	pool     *pgxpool.Pool
	q        *dbgen.Queries
	bus      events.Bus
	users    UserDirectory
	policy   InstancePolicy
	presence PresenceLister
	files    FileDirectory
	rooms    VoiceRooms

	unfurler      Unfurler
	previewImages PreviewImages
	unfurlOpts    UnfurlOptions
	unfurlSem     chan struct{}
}

// UseFiles wires the files port (message attachments).
func (s *Service) UseFiles(f FileDirectory) { s.files = f }

// UseInstancePolicy wires the instance-settings port.
func (s *Service) UseInstancePolicy(p InstancePolicy) { s.policy = p }

// UsePresence wires the presence port (for @here).
func (s *Service) UsePresence(p PresenceLister) { s.presence = p }

func New(pool *pgxpool.Pool, bus events.Bus, users UserDirectory) *Service {
	return &Service{pool: pool, q: dbgen.New(pool), bus: bus, users: users}
}

// ListSpaceIDs reports the spaces a user belongs to. Exposed for the
// realtime gateway's MembershipLister port.
func (s *Service) ListSpaceIDs(ctx context.Context, userID string) ([]string, error) {
	return s.q.ListSpaceIDsByUser(ctx, userID)
}

// IsSpaceMember reports whether a user belongs to the space. Exposed for
// the files module's authorisation port (space icons are members-only).
func (s *Service) IsSpaceMember(ctx context.Context, userID, spaceID string) (bool, error) {
	return s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: spaceID, UserID: userID})
}

// ChannelSpaceForMember resolves a channel to its space ("" for a direct
// message) for a user who may read it. Exposed for the files module's
// upload handler.
func (s *Service) ChannelSpaceForMember(ctx context.Context, userID, channelID string) (string, error) {
	ok, err := s.IsChannelMember(ctx, userID, channelID)
	if err != nil {
		return "", fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return "", connect.NewError(connect.CodePermissionDenied, errors.New("not a member of this channel's space"))
	}
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return "", notFoundOr(err, "channel")
	}
	return spaceOf(channel), nil
}

// IsChannelMember reports whether a user belongs to the channel's space
// or is a participant in the direct message. Exposed for the voice
// module's membership port.
func (s *Service) IsChannelMember(ctx context.Context, userID, channelID string) (bool, error) {
	return s.q.IsChannelMember(ctx, dbgen.IsChannelMemberParams{ID: channelID, UserID: userID})
}

func (s *Service) requireSpaceMember(ctx context.Context, spaceID string) error {
	ok, err := s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{
		SpaceID: spaceID, UserID: authctx.UserID(ctx),
	})
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("not a member of this space"))
	}
	return nil
}

func (s *Service) requireChannelMember(ctx context.Context, channelID string) error {
	ok, err := s.IsChannelMember(ctx, authctx.UserID(ctx), channelID)
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("not a member of this channel's space"))
	}
	return nil
}

func (s *Service) resolveAuthors(ctx context.Context, ids []string) (map[string]*chatv1.MessageAuthor, error) {
	if len(ids) == 0 {
		return map[string]*chatv1.MessageAuthor{}, nil
	}
	records, err := s.users.GetUsers(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("resolve authors: %w", err)
	}
	authors := make(map[string]*chatv1.MessageAuthor, len(records))
	for _, r := range records {
		authors[r.ID] = &chatv1.MessageAuthor{
			Id: r.ID, Username: r.Username, DisplayName: r.DisplayName, AvatarFileId: r.AvatarFileID,
		}
	}
	return authors, nil
}

func newID() string {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.NewString()
	}
	return id.String()
}

func notFoundOr(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("%s not found", what))
	}
	return err
}
