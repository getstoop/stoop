// Package voice hands out LiveKit access tokens for voice channels. Stoop
// never proxies media: the token is the authorization handoff, and the
// browser talks to LiveKit directly (signaling via the /livekit proxy on
// the app origin, media over WebRTC).
package voice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"connectrpc.com/connect"

	voicev1 "github.com/getstoop/stoop/gen/stoop/voice/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// SignalingPath is where the app serves LiveKit's signaling WebSocket,
// relative to the page origin. Clients resolve it against location.origin.
const SignalingPath = "/livekit"

// TokenTTL bounds how long a minted token can be used to connect. LiveKit
// only checks expiry at connect time, and the client has its microphone
// open before it asks for one, so this covers negotiation and nothing
// human-paced.
const TokenTTL = 90 * time.Second

// ChannelDirectory is voice's port for authorizing room access; implemented
// by the chat module, wired in internal/app.
type ChannelDirectory interface {
	IsChannelMember(ctx context.Context, userID, channelID string) (bool, error)
	IsVoiceChannel(ctx context.Context, channelID string) (bool, error)
}

// UserDirectory is voice's port for the name shown to other participants;
// implemented by the auth module, wired in internal/app.
type UserDirectory interface {
	DisplayName(ctx context.Context, userID string) (string, error)
}

type Options struct {
	// LiveKitURL is the sidecar's internal address (http://livekit:7880);
	// the signaling proxy dials it. Empty disables voice.
	LiveKitURL       string
	LiveKitAPIKey    string
	LiveKitAPISecret string
	// TURN is a static relay to offer browsers; zero value means none.
	TURN StaticTURN
	// Cloudflare enables Cloudflare's TURN service; zero value means off.
	Cloudflare CloudflareTURN
}

// Enabled reports whether every LiveKit setting is present.
func (o Options) Enabled() bool {
	return o.LiveKitURL != "" && o.LiveKitAPIKey != "" && o.LiveKitAPISecret != ""
}

type Service struct {
	channels ChannelDirectory
	users    UserDirectory
	opts     Options
	ice      []iceSource // from Options; used when no RelayProvider is set
	relay    RelayProvider
	cfMu     sync.Mutex
	cf       *cloudflareSource // the provider's Cloudflare source, kept across joins
	rooms    *rooms            // LiveKit room management; nil when voice is off
	log      *slog.Logger
	now      func() time.Time
	// A removal has to happen again once the tokens it could not revoke
	// have expired; these track the waiting repeats. See rooms.go.
	repeatDelay time.Duration
	repeats     sync.WaitGroup
	closed      chan struct{}
	closeOnce   sync.Once
}

func New(channels ChannelDirectory, users UserDirectory, opts Options, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	s := &Service{
		channels: channels, users: users, opts: opts, log: log, now: time.Now,
		repeatDelay: TokenTTL + repeatMargin, closed: make(chan struct{}),
	}
	if opts.Enabled() {
		r, err := newRooms(opts)
		if err != nil {
			log.Warn("livekit url is unusable for room management; kicks won't disconnect voice", "err", err)
		} else {
			s.rooms = r
		}
	}
	if len(opts.TURN.URLs) > 0 || len(opts.TURN.STUNURLs) > 0 {
		s.ice = append(s.ice, opts.TURN)
	}
	if opts.Cloudflare.KeyID != "" {
		s.ice = append(s.ice, newCloudflareSource(opts.Cloudflare))
	}
	return s
}

// Enabled reports whether voice is configured on this instance.
func (s *Service) Enabled() bool { return s.opts.Enabled() }

func (s *Service) JoinVoiceChannel(ctx context.Context, req *connect.Request[voicev1.JoinVoiceChannelRequest]) (*connect.Response[voicev1.JoinVoiceChannelResponse], error) {
	if !s.opts.Enabled() {
		return nil, connect.NewError(connect.CodeUnavailable,
			errors.New("voice is not configured on this server"))
	}
	userID := authctx.UserID(ctx)
	if userID == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("login required"))
	}
	channelID := req.Msg.ChannelId
	if channelID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("channel_id is required"))
	}
	// Membership first so non-members can't probe which channels exist.
	member, err := s.channels.IsChannelMember(ctx, userID, channelID)
	if err != nil {
		return nil, fmt.Errorf("check membership: %w", err)
	}
	if !member {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("not a member of this channel's space"))
	}
	voice, err := s.channels.IsVoiceChannel(ctx, channelID)
	if err != nil {
		return nil, fmt.Errorf("check channel kind: %w", err)
	}
	if !voice {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("not a voice channel"))
	}
	name, err := s.users.DisplayName(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("look up display name: %w", err)
	}
	token, err := mintToken(tokenParams{
		apiKey: s.opts.LiveKitAPIKey, apiSecret: s.opts.LiveKitAPISecret,
		identity: userID, name: name, grant: joinGrant(channelID),
		ttl: TokenTTL, now: s.now(),
	})
	if err != nil {
		return nil, fmt.Errorf("mint token: %w", err)
	}
	return connect.NewResponse(&voicev1.JoinVoiceChannelResponse{
		LivekitUrl:   SignalingPath,
		LivekitToken: token,
		IceServers:   s.iceServers(ctx),
	}), nil
}
