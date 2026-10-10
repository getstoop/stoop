// Package chat owns spaces, channels, messages, and invites. It publishes domain
// events to the bus (the realtime gateway delivers them) and resolves user
// info through its UserDirectory port — it never imports other modules.
package chat

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
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
	// Kind is person or bot; a bot can't be messaged directly.
	Kind         authctx.IdentityKind
	AvatarFileID string
	// Deleted: the person deleted the account; the username is all that
	// is left, and readers are told so.
	Deleted bool
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
	// MessageRetentionDays is how long messages are kept; 0 is forever.
	MessageRetentionDays(ctx context.Context) (int, error)
	// VoiceAvailable is whether voice channels work on this server.
	VoiceAvailable() bool
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
	// Expired: deleted by attachment retention, with its name.
	Expired bool
}

// label is how a preview names the file.
func (r FileRecord) label() string {
	if r.Expired {
		return "Expired attachment"
	}
	return r.Name
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

	searchThrottle Throttle

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

// inTx runs fn in a transaction with queries bound to it.
func (s *Service) inTx(ctx context.Context, fn func(qtx *dbgen.Queries) error) error {
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error { return fn(s.q.WithTx(tx)) })
}

// ListSpaceIDs reports the spaces a user belongs to. Exposed for the
// realtime gateway's MembershipLister port.
func (s *Service) ListSpaceIDs(ctx context.Context, userID string) ([]string, error) {
	return s.q.ListSpaceIDsByUser(ctx, userID)
}

// IsSpaceMember reports whether a user belongs to the space. It says
// nothing about what they may do there; for that, MayReadSpace.
func (s *Service) IsSpaceMember(ctx context.Context, userID, spaceID string) (bool, error) {
	return s.q.IsSpaceMember(ctx, dbgen.IsSpaceMemberParams{SpaceID: spaceID, UserID: userID})
}

// ChannelSpaceToPostIn resolves a channel to its space ("" for a direct
// message) for a user who may post in it: a member, and an admin or a bot
// in an announcement channel. ctx carries that user's identity. Exposed
// for the files module's upload handler.
func (s *Service) ChannelSpaceToPostIn(ctx context.Context, userID, channelID string) (string, error) {
	ok, err := s.IsChannelMember(ctx, userID, channelID)
	if err != nil {
		return "", fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return "", connect.NewError(connect.CodePermissionDenied, errors.New("not a member of this channel's space"))
	}
	channel, err := s.memberChannel(ctx, channelID)
	if err != nil {
		return "", err
	}
	if err := s.requireInChannel(ctx, userID, channel); err != nil {
		return "", err
	}
	if err := s.requirePostPolicy(ctx, channel); err != nil {
		return "", err
	}
	return spaceOf(channel), nil
}

// IsChannelMember reports whether a user belongs to the channel's space
// or is a participant in the direct message, and — when ctx carries that
// user's bounded credential — whether its bounds reach the channel.
// Exposed for the voice module's membership port.
func (s *Service) IsChannelMember(ctx context.Context, userID, channelID string) (bool, error) {
	ok, err := s.q.IsChannelMember(ctx, dbgen.IsChannelMemberParams{ID: channelID, UserID: userID})
	if err != nil || !ok {
		return ok, err
	}
	id, has := authctx.From(ctx)
	if !has || id.UserID != userID || !id.Credential.Bounded {
		return true, nil
	}
	channel, err := s.q.GetChannel(ctx, channelID)
	if err != nil {
		return false, fmt.Errorf("look up channel: %w", err)
	}
	return id.Credential.Reaches(spaceOf(channel), channel.ID), nil
}

func (s *Service) requireSpaceMember(ctx context.Context, spaceID string) error {
	if id, _ := authctx.From(ctx); !id.Credential.Reaches(spaceID, "") {
		return connect.NewError(connect.CodePermissionDenied, authctx.ErrOutOfBounds)
	}
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
	// Membership first, then the credential's bounds, so each refusal says
	// which it was.
	ok, err := s.q.IsChannelMember(ctx, dbgen.IsChannelMemberParams{ID: channelID, UserID: authctx.UserID(ctx)})
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !ok {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("not a member of this channel's space"))
	}
	if id, _ := authctx.From(ctx); id.Credential.Bounded {
		channel, err := s.q.GetChannel(ctx, channelID)
		if err != nil {
			return apierr.NotFoundOr(err, "channel")
		}
		if !id.Credential.Reaches(spaceOf(channel), channel.ID) {
			return connect.NewError(connect.CodePermissionDenied, authctx.ErrOutOfBounds)
		}
	}
	return nil
}

func (s *Service) resolveAuthors(ctx context.Context, ids []string) (map[string]*chatv1.MessageAuthor, error) {
	if len(ids) == 0 {
		return map[string]*chatv1.MessageAuthor{}, nil
	}
	users, err := s.usersByID(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("resolve authors: %w", err)
	}
	authors := make(map[string]*chatv1.MessageAuthor, len(users))
	for id, user := range users {
		authors[id] = &chatv1.MessageAuthor{
			Id: user.ID, Username: user.Username, DisplayName: user.DisplayName, AvatarFileId: user.AvatarFileID,
			Kind: accesswire.KindToProto(user.Kind), Deleted: user.Deleted,
		}
	}
	return authors, nil
}

// authorOrUnknown is the resolved author, or a placeholder for an id the
// directory did not return.
func authorOrUnknown(authors map[string]*chatv1.MessageAuthor, id string) *chatv1.MessageAuthor {
	if author := authors[id]; author != nil {
		return author
	}
	return unknownAuthor(id)
}

func unknownAuthor(id string) *chatv1.MessageAuthor {
	return &chatv1.MessageAuthor{Id: id, Username: "unknown"}
}

// usersByID looks users up through the directory; an id it does not know
// is absent from the map.
func (s *Service) usersByID(ctx context.Context, ids []string) (map[string]UserRecord, error) {
	records, err := s.users.GetUsers(ctx, ids)
	if err != nil {
		return nil, err
	}
	users := make(map[string]UserRecord, len(records))
	for _, record := range records {
		users[record.ID] = record
	}
	return users, nil
}

// lookupUser is usersByID for one id; found is false when it is unknown.
func (s *Service) lookupUser(ctx context.Context, id string) (user UserRecord, found bool, err error) {
	users, err := s.usersByID(ctx, []string{id})
	if err != nil {
		return UserRecord{}, false, err
	}
	user, found = users[id]
	return user, found, nil
}
