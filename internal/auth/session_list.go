package auth

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/pbtime"
)

// Where a person is signed in: listing their sessions and signing out of
// all of them. Each needs account.security, which only a session
// holds, so a token can't see or end them.

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
			LastUsedAt: pbtime.OrNil(r.LastUsedAt), ExpiresAt: pbtime.OrNil(r.ExpiresAt),
		}
	}
	return connect.NewResponse(&authv1.ListSessionsResponse{Sessions: out}), nil
}

func (s *Service) SignOutEverywhere(ctx context.Context, _ *connect.Request[authv1.SignOutEverywhereRequest]) (*connect.Response[authv1.SignOutEverywhereResponse], error) {
	id, err := requireAccountSecurity(ctx)
	if err != nil {
		return nil, err
	}
	// Sessions first, then tokens, in one transaction: a token being made
	// holds its session against deletion (CreatePersonalToken), so it
	// either commits before the sessions go, and the second delete sees it,
	// or finds its session gone and isn't made.
	var sessions []dbgen.DeleteUserSessionsRow
	var tokens []dbgen.DeleteUserPersonalTokensRow
	if err := s.inTx(ctx, func(qtx *dbgen.Queries) error {
		var err error
		if sessions, err = qtx.DeleteUserSessions(ctx, id.UserID); err != nil {
			return fmt.Errorf("sign out sessions: %w", err)
		}
		if tokens, err = qtx.DeleteUserPersonalTokens(ctx, id.UserID); err != nil {
			return fmt.Errorf("revoke personal tokens: %w", err)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for _, r := range sessions {
		s.announceRevoked(r.ID, r.HolderID)
	}
	for _, r := range tokens {
		s.announceRevoked(r.ID, r.HolderID)
	}
	resp := connect.NewResponse(&authv1.SignOutEverywhereResponse{
		Sessions: int32(len(sessions)), Tokens: int32(len(tokens)),
	})
	resp.Header().Add("Set-Cookie", s.sessionCookie(ctx, "", -time.Second).String())
	return resp, nil
}
