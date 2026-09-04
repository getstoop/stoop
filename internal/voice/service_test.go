package voice

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"

	voicev1 "github.com/Jhut89/stoop/gen/stoop/voice/v1"
	"github.com/Jhut89/stoop/internal/authctx"
)

// Fake ports: the module under test only needs their contracts.

type fakeChannels struct {
	members map[string]bool // "user/channel" → member
	voice   map[string]bool // channel → is voice
}

func (f fakeChannels) IsChannelMember(_ context.Context, userID, channelID string) (bool, error) {
	return f.members[userID+"/"+channelID], nil
}

func (f fakeChannels) IsVoiceChannel(_ context.Context, channelID string) (bool, error) {
	return f.voice[channelID], nil
}

type fakeUsers map[string]string

func (f fakeUsers) DisplayName(_ context.Context, userID string) (string, error) {
	name, ok := f[userID]
	if !ok {
		return "", errors.New("no such user")
	}
	return name, nil
}

var configured = Options{LiveKitURL: "http://livekit:7880", LiveKitAPIKey: "key", LiveKitAPISecret: "secret"}

func newTestService(opts Options) *Service {
	s := New(
		fakeChannels{
			members: map[string]bool{"u1/voice": true, "u1/text": true},
			voice:   map[string]bool{"voice": true},
		},
		fakeUsers{"u1": "Ada"},
		opts,
		nil,
	)
	s.now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	return s
}

func as(userID string) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: userID})
}

func join(s *Service, ctx context.Context, channelID string) (*voicev1.JoinVoiceChannelResponse, error) {
	resp, err := s.JoinVoiceChannel(ctx, connect.NewRequest(&voicev1.JoinVoiceChannelRequest{ChannelId: channelID}))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func TestJoinVoiceChannel_MintsScopedToken(t *testing.T) {
	s := newTestService(configured)
	resp, err := join(s, as("u1"), "voice")
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if resp.LivekitUrl != SignalingPath {
		t.Errorf("url = %q, want %q", resp.LivekitUrl, SignalingPath)
	}
	claims, err := parseToken(resp.LivekitToken, "secret")
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if claims.Issuer != "key" || claims.Subject != "u1" || claims.Name != "Ada" {
		t.Errorf("claims = %+v", claims)
	}
	if claims.Video.Room != "voice" || !claims.Video.RoomJoin || !claims.Video.CanPublish || !claims.Video.CanSubscribe {
		t.Errorf("grant = %+v", claims.Video)
	}
	if got := claims.ExpiresAt - claims.NotBefore; got != int64(TokenTTL/time.Second) {
		t.Errorf("ttl = %ds, want %v", got, TokenTTL)
	}
	if _, err := parseToken(resp.LivekitToken, "wrong"); err == nil {
		t.Error("token verified with the wrong secret")
	}
}

func TestJoinVoiceChannel_Errors(t *testing.T) {
	tests := []struct {
		name    string
		opts    Options
		ctx     context.Context
		channel string
		want    connect.Code
	}{
		{"unconfigured", Options{}, as("u1"), "voice", connect.CodeUnavailable},
		{"partially configured", Options{LiveKitAPIKey: "key"}, as("u1"), "voice", connect.CodeUnavailable},
		{"anonymous", configured, context.Background(), "voice", connect.CodeUnauthenticated},
		{"missing channel id", configured, as("u1"), "", connect.CodeInvalidArgument},
		{"non-member", configured, as("u2"), "voice", connect.CodePermissionDenied},
		{"unknown channel looks like non-member", configured, as("u1"), "nope", connect.CodePermissionDenied},
		{"text channel", configured, as("u1"), "text", connect.CodeInvalidArgument},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := join(newTestService(tc.opts), tc.ctx, tc.channel)
			if got := connect.CodeOf(err); got != tc.want {
				t.Errorf("code = %v (%v), want %v", got, err, tc.want)
			}
		})
	}
}

func TestMintToken_RequiresCredentials(t *testing.T) {
	if _, err := mintToken(tokenParams{identity: "u", grant: joinGrant("r"), now: time.Now()}); err == nil {
		t.Error("minted a token without credentials")
	}
}
