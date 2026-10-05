package voice

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/apierr/apierrtest"
)

func TestJoinVoiceChannel_MintsScopedToken(t *testing.T) {
	service := newTestService(configured)
	resp, err := join(service, as("u1"), "voice")
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
			apierrtest.ExpectCode(t, err, tc.want, "join")
		})
	}
}

func TestMintToken_RequiresCredentials(t *testing.T) {
	if _, err := mintToken(tokenParams{identity: "u", grant: joinGrant("r"), now: time.Now()}); err == nil {
		t.Error("minted a token without credentials")
	}
}
