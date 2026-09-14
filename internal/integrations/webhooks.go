package integrations

import (
	"context"
	"errors"
	"fmt"
	"net/url"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	integrationsv1 "github.com/getstoop/stoop/gen/stoop/integrations/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The hook RPCs shared by both kinds.

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
	manages := requireManage(ctx) == nil
	names := map[string]string{}
	nameOf := func(spaceID string) string {
		if n, ok := names[spaceID]; ok {
			return n
		}
		n, _ := s.spaces.SpaceName(ctx, spaceID)
		names[spaceID] = n
		return n
	}
	for _, h := range incoming {
		h.SpaceName = nameOf(h.SpaceId)
	}
	for _, o := range out {
		p := toProtoOutgoing(o)
		p.SpaceName = nameOf(o.SpaceID)
		if !manages {
			p.Url = targetHost(o.Url)
		}
		res.Outgoing = append(res.Outgoing, p)
	}
	return connect.NewResponse(res), nil
}

// targetHost is what a member sees of a URL: a path or query can carry
// the receiver's own secret.
func targetHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Scheme + "://" + u.Host
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
	if err == nil {
		url, err := s.rotateIncoming(ctx, hook)
		if err != nil {
			return nil, err
		}
		return connect.NewResponse(&integrationsv1.RotateSecretResponse{Url: url}), nil
	}
	if connect.CodeOf(err) != connect.CodeNotFound {
		return nil, err
	}
	out, err := s.outgoingHook(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	secret, err := s.rotateOutgoing(ctx, out)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&integrationsv1.RotateSecretResponse{Secret: secret}), nil
}
