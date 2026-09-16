package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Where a person is signed in: listing their sessions and signing one or
// all of the others out. Each needs account.security, which only a
// session holds, so a token can't see or end them.

func (s *Service) ListSessions(ctx context.Context, _ *connect.Request[authv1.ListSessionsRequest]) (*connect.Response[authv1.ListSessionsResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListSessions(ctx, id.UserID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	out := make([]*authv1.Session, len(rows))
	for i, r := range rows {
		out[i] = &authv1.Session{
			Id: r.ID, CreatedAt: timestamppb.New(r.CreatedAt),
			UserAgent: r.UserAgent, Current: r.ID == id.SessionID,
		}
		if r.LastUsedAt != nil {
			out[i].LastUsedAt = timestamppb.New(*r.LastUsedAt)
		}
		if r.ExpiresAt != nil {
			out[i].ExpiresAt = timestamppb.New(*r.ExpiresAt)
		}
	}
	return connect.NewResponse(&authv1.ListSessionsResponse{Sessions: out}), nil
}

func (s *Service) RevokeSession(ctx context.Context, req *connect.Request[authv1.RevokeSessionRequest]) (*connect.Response[authv1.RevokeSessionResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	notFound := connect.NewError(connect.CodeNotFound, errors.New("session not found"))
	if _, err := uuid.Parse(req.Msg.SessionId); err != nil {
		return nil, notFound
	}
	rows, err := s.q.DeleteSession(ctx, dbgen.DeleteSessionParams{ID: req.Msg.SessionId, HolderID: id.UserID})
	if err != nil {
		return nil, fmt.Errorf("revoke session: %w", err)
	}
	if len(rows) == 0 {
		return nil, notFound
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	resp := connect.NewResponse(&authv1.RevokeSessionResponse{})
	if req.Msg.SessionId == id.SessionID {
		resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, "", -time.Second).String())
	}
	return resp, nil
}

func (s *Service) RevokeOtherSessions(ctx context.Context, _ *connect.Request[authv1.RevokeOtherSessionsRequest]) (*connect.Response[authv1.RevokeOtherSessionsResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.DeleteOtherSessions(ctx, dbgen.DeleteOtherSessionsParams{HolderID: id.UserID, ID: id.SessionID})
	if err != nil {
		return nil, fmt.Errorf("revoke other sessions: %w", err)
	}
	for _, r := range rows {
		s.announceRevoked(r.ID, r.HolderID)
	}
	return connect.NewResponse(&authv1.RevokeOtherSessionsResponse{Revoked: int32(len(rows))}), nil
}
