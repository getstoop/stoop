// Package integrations owns what the server talks to: incoming and
// outgoing webhooks, the delivery queue, and the admin surface for bots
// and the credentials that authenticate as them. Design and reasoning:
// docs/proposals/webhooks.md.
package integrations

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/ratelimit"
)

// PostRequest is one message an incoming hook posts.
type PostRequest struct {
	ChannelID string
	Content   string
}

// Poster is integrations' port onto chat: post with the identity and
// credential already on ctx, through the same path every client uses.
type Poster interface {
	// Post returns the new message's id.
	Post(ctx context.Context, req PostRequest) (string, error)
}

// SpaceAccess is integrations' port onto chat for the facts a hook needs
// about its space and for placing a bot in it.
type SpaceAccess interface {
	// ChannelSpace returns the channel's space id, or a Connect NotFound.
	ChannelSpace(ctx context.Context, channelID string) (string, error)
	SpaceName(ctx context.Context, spaceID string) (string, error)
	AddBotMember(ctx context.Context, spaceID, userID string) error
	// SetBotAdmin sets or clears the bot's admin role in the space.
	SetBotAdmin(ctx context.Context, spaceID, userID string, admin bool) error
	IsSpaceMember(ctx context.Context, userID, spaceID string) (bool, error)
}

// Bot is a bot account as auth reports it.
type Bot struct {
	ID            string
	Username      string
	DisplayName   string
	AvatarFileID  string
	InstanceAdmin bool
	CreatedAt     time.Time
	DeactivatedAt *time.Time
}

// Credential is a bot token or hook token, never its secret.
type Credential struct {
	ID         string
	HolderID   string
	Kind       authctx.CredentialKind
	Name       string
	Grants     []authctx.Action
	Bounded    bool
	SpaceIDs   []string
	ChannelIDs []string
	Hint       string
	CreatedAt  time.Time
	LastUsedAt *time.Time
}

// MintRequest describes a credential to mint for a bot. A hook is bounded
// to ChannelID; a token to SpaceIDs when Limited.
type MintRequest struct {
	HolderID  string
	Kind      authctx.CredentialKind
	Name      string
	Grants    []authctx.Action
	Limited   bool
	SpaceIDs  []string
	ChannelID string
	CreatedBy string
}

// BotIdentities is integrations' port onto auth, which keeps owning
// users and credentials. Authorisation is integrations' job.
type BotIdentities interface {
	CreateBot(ctx context.Context, username, displayName string) (Bot, error)
	GetBot(ctx context.Context, id string) (Bot, error)
	ListBots(ctx context.Context) ([]Bot, error)
	RenameBot(ctx context.Context, id string, username, displayName *string) (Bot, error)
	// DeactivateBot revokes everything the bot holds.
	DeactivateBot(ctx context.Context, id string) error
	// MintCredential returns the credential and its secret, shown once.
	MintCredential(ctx context.Context, req MintRequest) (Credential, string, error)
	SetCredentialGrants(ctx context.Context, id string, grants []authctx.Action) error
	RevokeCredential(ctx context.Context, id string) error
	// Credentials lists by id, or with no ids every bot credential of the
	// holders (of every bot when both are empty).
	Credentials(ctx context.Context, holderIDs, ids []string) ([]Credential, error)
	CountCredentials(ctx context.Context, holderID string) (int64, error)
	// VerifyHookToken resolves an incoming_hook token to its bot's
	// identity, or fails for any other kind.
	VerifyHookToken(ctx context.Context, token string) (authctx.Identity, error)
}

// Policy is integrations' port onto instance settings.
type Policy interface {
	WebhooksIncoming(ctx context.Context) (bool, error)
	WebhooksOutgoing(ctx context.Context) (bool, error)
	WebhooksAllowPrivateTargets(ctx context.Context) (bool, error)
	PublicURL(ctx context.Context) (string, error)
}

// Service is the integrations module.
type Service struct {
	pool      *pgxpool.Pool
	q         *dbgen.Queries
	bus       events.Bus
	log       *slog.Logger
	poster    Poster
	spaces    SpaceAccess
	bots      BotIdentities
	policy    Policy
	queue     Queue
	hookLimit *ratelimit.Limiter
}

func New(pool *pgxpool.Pool, bus events.Bus, log *slog.Logger) *Service {
	return &Service{pool: pool, q: dbgen.New(pool), bus: bus, log: log}
}

// UsePoster wires chat. Without it incoming hooks refuse every post.
func (s *Service) UsePoster(p Poster) { s.poster = p }

// UseSpaceAccess wires chat. Without it no hook or bot can be created.
func (s *Service) UseSpaceAccess(a SpaceAccess) { s.spaces = a }

// UseBotIdentities wires auth. Without it no bot or credential can be
// created and every hook token is unknown.
func (s *Service) UseBotIdentities(b BotIdentities) { s.bots = b }

// UsePolicy wires instance. Without it both directions are off.
func (s *Service) UsePolicy(p Policy) { s.policy = p }

// UseQueue wires the delivery queue. Without it outgoing hooks deliver
// nothing.
func (s *Service) UseQueue(q Queue) { s.queue = q }

// UseHookThrottle limits posts per hook credential. Nil means no limit.
func (s *Service) UseHookThrottle(l *ratelimit.Limiter) { s.hookLimit = l }

var errNotBuilt = connect.NewError(connect.CodeUnimplemented, errors.New("not available yet"))

// requireManage is the identity gate for configuring integrations.
func requireManage(ctx context.Context) error {
	if !authctx.Holds(ctx, authctx.InstanceIntegrationsManage) {
		return connect.NewError(connect.CodePermissionDenied, errors.New("instance admin role required"))
	}
	if !authctx.Covers(ctx, authctx.InstanceIntegrationsManage) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Refusal(ctx, authctx.InstanceIntegrationsManage))
	}
	return nil
}

func (s *Service) incomingEnabled(ctx context.Context) (bool, error) {
	if s.policy == nil {
		return false, nil
	}
	return s.policy.WebhooksIncoming(ctx)
}

func (s *Service) ready() error {
	if s.bots == nil || s.spaces == nil {
		return connect.NewError(connect.CodeUnavailable, errors.New("integrations are not wired"))
	}
	return nil
}
