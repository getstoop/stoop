package chat

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	chatv1 "github.com/Jhut89/stoop/gen/stoop/chat/v1"
	realtimev1 "github.com/Jhut89/stoop/gen/stoop/realtime/v1"
	"github.com/Jhut89/stoop/internal/authctx"
	"github.com/Jhut89/stoop/internal/dbgen"
	"github.com/Jhut89/stoop/internal/events"
)

// SetSpaceMuted sets the caller's own mute for a space they belong to,
// which silences every channel in it. A preference, not a moderation
// action: membership is the only gate, and their other devices hear
// about it on the personal topic.
func (s *Service) SetSpaceMuted(ctx context.Context, req *connect.Request[chatv1.SetSpaceMutedRequest]) (*connect.Response[chatv1.SetSpaceMutedResponse], error) {
	if err := s.requireSpaceMember(ctx, req.Msg.SpaceId); err != nil {
		return nil, err
	}
	a, err := s.actorFor(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, err
	}
	space, err := s.q.GetSpace(ctx, req.Msg.SpaceId)
	if err != nil {
		return nil, notFoundOr(err, "space")
	}
	userID := authctx.UserID(ctx)
	params := dbgen.MuteSpaceParams{UserID: userID, SpaceID: space.ID}
	if req.Msg.Muted {
		err = s.q.MuteSpace(ctx, params)
	} else {
		err = s.q.UnmuteSpace(ctx, dbgen.UnmuteSpaceParams(params))
	}
	if err != nil {
		return nil, fmt.Errorf("set space mute: %w", err)
	}
	out := toProtoSpace(space, a.role)
	out.Muted = req.Msg.Muted
	s.bus.Publish("user:"+userID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_SpaceMuted{
			SpaceMuted: &realtimev1.SpaceMuted{SpaceId: space.ID, Muted: req.Msg.Muted},
		},
	}))
	return connect.NewResponse(&chatv1.SetSpaceMutedResponse{Space: out}), nil
}
