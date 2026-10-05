package voice

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	voicev1 "github.com/getstoop/stoop/gen/stoop/voice/v1"
	"github.com/getstoop/stoop/internal/authctx"
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
	service := New(
		fakeChannels{
			members: map[string]bool{"u1/voice": true, "u1/text": true},
			voice:   map[string]bool{"voice": true},
		},
		fakeUsers{"u1": "Ada"},
		opts,
		nil,
	)
	service.now = func() time.Time { return time.Unix(1_700_000_000, 0) }
	return service
}

func as(userID string) context.Context {
	return authctx.WithIdentity(context.Background(), authctx.Identity{UserID: userID})
}

func join(service *Service, ctx context.Context, channelID string) (*voicev1.JoinVoiceChannelResponse, error) {
	resp, err := service.JoinVoiceChannel(ctx, connect.NewRequest(&voicev1.JoinVoiceChannelRequest{ChannelId: channelID}))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}
