package integrations

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The hook RPCs shared by both kinds. Outgoing behaviour lands with
// STOOP-260.

// ListWebhooks lists a space's hooks for its members, or every hook on the
// server for an instance admin.
func (s *Service) ListWebhooks(ctx context.Context, req *connect.Request[integrationsv1.ListWebhooksRequest]) (*connect.Response[integrationsv1.ListWebhooksResponse], error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	var (
		in  []dbgen.IncomingWebhook
		out []dbgen.OutgoingWebhook
		err error
	)
	if req.Msg.SpaceId == "" {
		if err := requireManage(ctx); err != nil {
			return nil, err
		}
		if in, err = s.q.ListIncomingWebhooks(ctx); err != nil {
			return nil, fmt.Errorf("list hooks: %w", err)
		}
		if out, err = s.q.ListOutgoingWebhooks(ctx); err != nil {
			return nil, fmt.Errorf("list hooks: %w", err)
		}
	} else {
		if err := s.requireSpaceRead(ctx, req.Msg.SpaceId); err != nil {
			return nil, err
		}
		if in, err = s.q.ListIncomingWebhooksBySpace(ctx, req.Msg.SpaceId); err != nil {
			return nil, fmt.Errorf("list hooks: %w", err)
		}
		if out, err = s.q.ListOutgoingWebhooksBySpace(ctx, req.Msg.SpaceId); err != nil {
			return nil, fmt.Errorf("list hooks: %w", err)
		}
	}
	incoming, err := s.protoIncomingList(ctx, in)
	if err != nil {
		return nil, err
	}
	res := &integrationsv1.ListWebhooksResponse{Incoming: incoming}
	for _, o := range out {
		res.Outgoing = append(res.Outgoing, toProtoOutgoing(o))
	}
	return connect.NewResponse(res), nil
}

// requireSpaceRead is the members' view: the credential covers space.read
// there and the identity is a member, or an instance admin.
func (s *Service) requireSpaceRead(ctx context.Context, spaceID string) error {
	if !authctx.CoversSpace(ctx, authctx.SpaceRead, spaceID) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Refusal(ctx, authctx.SpaceRead))
	}
	if authctx.IsAdmin(ctx) {
		return nil
	}
	if _, err := s.spaces.SpaceName(ctx, spaceID); err != nil {
		return err
	}
	member, err := s.spaces.IsSpaceMember(ctx, authctx.UserID(ctx), spaceID)
	if err != nil {
		return err
	}
	if !member {
		return connect.NewError(connect.CodePermissionDenied, errors.New("not a member of this space"))
	}
	return nil
}

func (s *Service) DeleteWebhook(ctx context.Context, req *connect.Request[integrationsv1.DeleteWebhookRequest]) (*connect.Response[integrationsv1.DeleteWebhookResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	hook, err := s.incomingHook(ctx, req.Msg.Id)
	if err == nil {
		if err := s.deleteIncoming(ctx, hook); err != nil {
			return nil, err
		}
		return connect.NewResponse(&integrationsv1.DeleteWebhookResponse{}), nil
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		return nil, err
	}
	if _, err := s.q.DeleteOutgoingWebhook(ctx, req.Msg.Id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("webhook not found"))
		}
		return nil, fmt.Errorf("delete hook: %w", err)
	}
	return connect.NewResponse(&integrationsv1.DeleteWebhookResponse{}), nil
}

func (s *Service) RotateSecret(ctx context.Context, req *connect.Request[integrationsv1.RotateSecretRequest]) (*connect.Response[integrationsv1.RotateSecretResponse], error) {
	if err := requireManage(ctx); err != nil {
		return nil, err
	}
	if err := s.ready(); err != nil {
		return nil, err
	}
	hook, err := s.incomingHook(ctx, req.Msg.Id)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeNotFound {
			return nil, errNotBuilt
		}
		return nil, err
	}
	url, err := s.rotateIncoming(ctx, hook)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.RotateSecretResponse{Url: url}), nil
}

func (s *Service) CreateOutgoing(context.Context, *connect.Request[integrationsv1.CreateOutgoingRequest]) (*connect.Response[integrationsv1.CreateOutgoingResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) UpdateOutgoing(context.Context, *connect.Request[integrationsv1.UpdateOutgoingRequest]) (*connect.Response[integrationsv1.UpdateOutgoingResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) TestWebhook(context.Context, *connect.Request[integrationsv1.TestWebhookRequest]) (*connect.Response[integrationsv1.TestWebhookResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) ListDeliveries(context.Context, *connect.Request[integrationsv1.ListDeliveriesRequest]) (*connect.Response[integrationsv1.ListDeliveriesResponse], error) {
	return nil, errNotBuilt
}

func (s *Service) RedeliverDelivery(context.Context, *connect.Request[integrationsv1.RedeliverDeliveryRequest]) (*connect.Response[integrationsv1.RedeliverDeliveryResponse], error) {
	return nil, errNotBuilt
}
