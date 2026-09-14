// Package integrations owns what the server talks to: incoming and
// outgoing webhooks, the delivery queue, and the admin surface for bots
// and the credentials that authenticate as them. Design and reasoning:
// docs/proposals/webhooks.md.
package integrations

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
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
}

// MintRequest describes a credential to mint for a bot.
type MintRequest struct {
	HolderID string
	Kind     authctx.CredentialKind
	Name     string
	Grants   []authctx.Action
	// SpaceIDs bounds a bot token; ChannelID bounds a hook.
	SpaceIDs  []string
	ChannelID string
}

// Minted is a freshly minted credential; Secret is shown once.
type Minted struct {
	ID     string
	Secret string
	Hint   string
}

// BotIdentities is integrations' port onto auth, which keeps owning
// users and credentials.
type BotIdentities interface {
	CreateBot(ctx context.Context, username, displayName string) (userID string, err error)
	RenameBot(ctx context.Context, userID string, username, displayName *string) error
	DeactivateBot(ctx context.Context, userID string) error
	MintCredential(ctx context.Context, req MintRequest) (Minted, error)
	RevokeCredential(ctx context.Context, credentialID string) error
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
	pool   *pgxpool.Pool
	q      *dbgen.Queries
	bus    events.Bus
	log    *slog.Logger
	poster Poster
	spaces SpaceAccess
	bots   BotIdentities
	policy Policy
	queue  Queue
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
