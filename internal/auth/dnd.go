package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
)

// Do not disturb: the one presence choice a person makes, kept on their
// account so every device follows it. docs/proposals/presence-and-dnd.md.

// dndState is whether do not disturb is on at now, and when it ends (nil
// for no end). A row past its end reads as off.
func dndState(dnd bool, until *time.Time, now time.Time) (bool, *time.Time) {
	if !dnd || (until != nil && !until.After(now)) {
		return false, nil
	}
	return true, until
}

func (s *Service) SetDoNotDisturb(ctx context.Context, req *connect.Request[authv1.SetDoNotDisturbRequest]) (*connect.Response[authv1.SetDoNotDisturbResponse], error) {
	if err := refuseBotCaller(ctx, "a bot is never on do not disturb"); err != nil {
		return nil, err
	}
	params := dbgen.SetDoNotDisturbParams{ID: authctx.UserID(ctx), Dnd: req.Msg.On}
	if req.Msg.On && req.Msg.Until != nil {
		until := req.Msg.Until.AsTime()
		if !until.After(time.Now()) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("do not disturb can't end in the past"))
		}
		params.DndUntil = &until
	}
	user, err := s.q.SetDoNotDisturb(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("set do not disturb: %w", err)
	}
	s.announceDoNotDisturb(user)
	return connect.NewResponse(&authv1.SetDoNotDisturbResponse{User: toProtoUser(user)}), nil
}

// DoNotDisturb is whether a person is on do not disturb now, and when it
// ends. Exposed for the realtime gateway's port, wired in internal/app.
func (s *Service) DoNotDisturb(ctx context.Context, userID string) (bool, *time.Time, error) {
	row, err := s.q.GetDoNotDisturb(ctx, userID)
	if err != nil {
		return false, nil, fmt.Errorf("look up do not disturb: %w", err)
	}
	on, until := dndState(row.Dnd, row.DndUntil, time.Now())
	return on, until, nil
}

// announceDoNotDisturb tells the person's devices, and the gateway, what
// do not disturb is now.
func (s *Service) announceDoNotDisturb(u dbgen.User) {
	if s.bus == nil {
		return
	}
	on, until := dndState(u.Dnd, u.DndUntil, time.Now())
	s.bus.Publish("user:"+u.ID, events.Stamp(&realtimev1.ServerEvent{
		Payload: &realtimev1.ServerEvent_DoNotDisturbChanged{
			DoNotDisturbChanged: &realtimev1.DoNotDisturbChanged{
				UserId: u.ID, Dnd: on, Until: timestampOrNil(until),
			},
		},
	}))
}

func timestampOrNil(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}
