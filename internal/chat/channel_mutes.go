package chat

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// SetChannelMuted sets the caller's own mute for a channel they can read
// — a space's or a direct message. Their business alone: it needs access
// and nothing more, and their other devices hear about it on the
// personal topic.
func (s *Service) SetChannelMuted(ctx context.Context, req *connect.Request[chatv1.SetChannelMutedRequest]) (*connect.Response[chatv1.SetChannelMutedResponse], error) {
	channel, err := s.accessChannel(ctx, req.Msg.ChannelId)
	if err != nil {
		return nil, err
	}
	userID := authctx.UserID(ctx)
	params := dbgen.MuteChannelParams{UserID: userID, ChannelID: channel.ID}
	if req.Msg.Muted {
		err = s.q.MuteChannel(ctx, params)
	} else {
		err = s.q.UnmuteChannel(ctx, dbgen.UnmuteChannelParams(params))
	}
	if err != nil {
		return nil, fmt.Errorf("set channel mute: %w", err)
	}
	out := toProtoChannel(channel)
	out.Muted = req.Msg.Muted
	s.bus.Publish("user:"+userID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_ChannelMuted{
			ChannelMuted: &realtimev1.ChannelMuted{
				SpaceId: spaceOf(channel), ChannelId: channel.ID, Muted: req.Msg.Muted,
			},
		},
	}))
	return connect.NewResponse(&chatv1.SetChannelMutedResponse{Channel: out}), nil
}
