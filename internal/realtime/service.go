package realtime

import (
	"context"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// SessionVerifier authenticates the WebSocket upgrade from the request
// headers (cookie or bearer token): who is calling, with what credential.
// Implemented by the auth module, wired in internal/app.
type SessionVerifier interface {
	VerifyRequest(ctx context.Context, h http.Header) (authctx.Identity, error)
}

// ChannelLookup is the gateway's port onto the chat module's channels,
// wired in internal/app.
type ChannelLookup interface {
	// VoiceChannelSpace resolves a voice channel to its space; "" means
	// unknown or not voice.
	VoiceChannelSpace(ctx context.Context, channelID string) (spaceID string, err error)
	// ChannelPeople says whether a channel has a people list, as a direct
	// message and a private channel do, and who is on it. Typing there is
	// relayed to them; a channel that is not listed is public.
	ChannelPeople(ctx context.Context, channelID string) (people []string, listed bool, err error)
}

// MembershipLister reports which spaces a user belongs to; implemented by
// the chat module, wired in internal/app.
type MembershipLister interface {
	ListSpaceIDs(ctx context.Context, userID string) ([]string, error)
}

// DoNotDisturbLookup reports whether a person is on do not disturb and when
// it ends; implemented by the auth module, wired in internal/app.
type DoNotDisturbLookup interface {
	DoNotDisturb(ctx context.Context, userID string) (on bool, until *time.Time, err error)
}

type Gateway struct {
	bus            events.Bus
	verifier       SessionVerifier
	members        MembershipLister
	channels       ChannelLookup
	dnd            DoNotDisturbLookup
	originPatterns []string
	log            *slog.Logger
	presence       *presence
	voice          *voiceState
	connSeq        atomic.Uint64
	pingInterval   time.Duration
	lookupTimeout  time.Duration
}

func NewGateway(bus events.Bus, verifier SessionVerifier, members MembershipLister, channels ChannelLookup, originPatterns []string, log *slog.Logger) *Gateway {
	return &Gateway{
		bus:            bus,
		verifier:       verifier,
		members:        members,
		channels:       channels,
		originPatterns: originPatterns,
		log:            log,
		presence:       newPresence(),
		voice:          newVoiceState(),
		pingInterval:   pingInterval,
		lookupTimeout:  lookupTimeout,
	}
}
