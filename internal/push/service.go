// Package push owns push notifications: the server's signing key, the
// one Web Push subscription each signed-in session may register, and the
// sending of each activity item to its recipient's subscriptions. See
// docs/architecture/modules.md and docs/architecture/push-payload.md.
package push

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/netguard"
	"github.com/getstoop/stoop/internal/webpush"
)

// Accounts is what push asks auth; wired in internal/app.
type Accounts interface {
	// DoNotDisturb is whether the person is on do not disturb now.
	DoNotDisturb(ctx context.Context, userID string) (on bool, until *time.Time, err error)
	// LiveSessions is which of ids are sessions that have not expired.
	LiveSessions(ctx context.Context, ids []string) ([]string, error)
}

// Sockets is what push asks the realtime gateway.
type Sockets interface {
	// SessionConnected is whether a socket opened with this session is
	// open now.
	SessionConnected(sessionID string) bool
}

// Chat is what push asks chat to fill a notification.
type Chat interface {
	// PlaceNames is the channel's name and its space's; both empty for a
	// direct message.
	PlaceNames(ctx context.Context, channelID string) (space, channel string, err error)
	// WaitingTotal is what this server puts on the person's app icon.
	WaitingTotal(ctx context.Context, userID string) (int, error)
	// ActivityPending is whether the item is still the person's, unread,
	// in a channel they can read and not muted for them: false once it
	// was read, refreshed under a newer id, or deleted since.
	ActivityPending(ctx context.Context, userID, itemID, threadRootID string) (bool, error)
}

// Policy is the server-wide switch. Nothing implements it yet: there is
// no setting, and without one push is on.
type Policy interface {
	PushEnabled(ctx context.Context) (bool, error)
}

// Jobs queues the kinds push performs (DeliverPushKind).
type Jobs interface {
	Enqueue(ctx context.Context, kind string, args any) (string, error)
}

type Service struct {
	pool *pgxpool.Pool
	q    *dbgen.Queries
	log  *slog.Logger

	bus      events.Bus
	accounts Accounts
	sockets  Sockets
	chat     Chat
	policy   Policy
	jobs     Jobs

	keyMu     sync.Mutex
	publicKey []byte // the signing key's public point, once loaded

	// client is what deliveries post through: netguard's public-only
	// transport. Tests in this package replace it to reach a local relay.
	client   *http.Client
	senderMu sync.Mutex
	sender   *webpush.Sender

	listener listener
	now      func() time.Time
}

// sendTimeout bounds one post to a push service.
const sendTimeout = 15 * time.Second

func New(pool *pgxpool.Pool) *Service {
	return &Service{
		pool: pool, q: dbgen.New(pool), log: slog.Default(), now: time.Now,
		client: &http.Client{Transport: netguard.Policy{}.Transport(), Timeout: sendTimeout},
	}
}

// UseSending wires what hearing and sending need. Without it the
// listener hears nothing and no delivery is queued.
func (s *Service) UseSending(bus events.Bus, accounts Accounts, chat Chat, jobs Jobs, log *slog.Logger) {
	s.bus, s.accounts, s.chat, s.jobs = bus, accounts, chat, jobs
	if log != nil {
		s.log = log
	}
}

// UseSockets wires the gateway, which only the server has. Without it no
// session reads as connected, so every wanted item is sent.
func (s *Service) UseSockets(sockets Sockets) { s.sockets = sockets }

// UsePolicy wires the server-wide switch. Without it push is on.
func (s *Service) UsePolicy(policy Policy) { s.policy = policy }

// enabled is the server-wide switch.
func (s *Service) enabled(ctx context.Context) (bool, error) {
	if s.policy == nil {
		return true, nil
	}
	return s.policy.PushEnabled(ctx)
}

// requireSession is the caller's identity when it signed in on a device:
// a subscription belongs to a session, so a token has none to manage.
func requireSession(ctx context.Context) (authctx.Identity, error) {
	id, ok := authctx.From(ctx)
	if !ok {
		return authctx.Identity{}, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if id.SessionID == "" {
		return authctx.Identity{}, connect.NewError(connect.CodePermissionDenied,
			errors.New("only a signed-in device can receive notifications"))
	}
	return id, nil
}
