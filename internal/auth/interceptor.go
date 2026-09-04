package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/gen/stoop/auth/v1/authv1connect"
	"github.com/getstoop/stoop/internal/authctx"
)

// NewInterceptor authenticates every non-public Connect call and deposits the
// caller's identity into the context for handlers to read via authctx.
// Register and Login are always public; other modules' public procedures are
// added through Options.PublicProcedures by internal/app.
func (s *Service) NewInterceptor() connect.UnaryInterceptorFunc {
	public := map[string]bool{
		authv1connect.AuthServiceRegisterProcedure: true,
		authv1connect.AuthServiceLoginProcedure:    true,
	}
	for _, p := range s.opts.PublicProcedures {
		public[p] = true
	}
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			identity, err := s.VerifyToken(ctx, TokenFromHeader(req.Header()))
			if public[req.Spec().Procedure] {
				// Public procedures don't require a session, but they may
				// behave differently with one (e.g. an admin creating an
				// account under a closed registration policy).
				if err == nil {
					ctx = authctx.WithIdentity(ctx, identity)
				}
				return next(ctx, req)
			}
			if err != nil {
				return nil, connect.NewError(connect.CodeUnauthenticated,
					errors.New("authentication required"))
			}
			return next(authctx.WithIdentity(ctx, identity), req)
		}
	}
}

// TokenFromHeader extracts a session token from an Authorization: Bearer
// header or the session cookie, in that order.
func TokenFromHeader(h http.Header) string {
	if bearer := h.Get("Authorization"); strings.HasPrefix(bearer, "Bearer ") {
		return strings.TrimPrefix(bearer, "Bearer ")
	}
	// Reuse net/http's cookie parsing.
	req := http.Request{Header: h}
	if c, err := req.Cookie(SessionCookieName); err == nil {
		return c.Value
	}
	return ""
}
