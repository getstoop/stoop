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

// NewInterceptor authenticates every non-public Connect call, runs the
// credential gate from Options.Procedures, and deposits the caller's
// identity into the context for handlers to read via authctx.
func (s *Service) NewInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			rule, known := s.rule(req.Spec().Procedure)
			identity, err := s.VerifyToken(ctx, TokenFromHeader(req.Header()))
			if rule.Public {
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
			if !known {
				return nil, connect.NewError(connect.CodePermissionDenied,
					errors.New("this procedure has no access rule"))
			}
			if !rule.CoveredBy(identity.Credential) {
				return nil, connect.NewError(connect.CodePermissionDenied, authctx.Uncovered(rule.AnyOf[0]))
			}
			return next(authctx.WithIdentity(ctx, identity), req)
		}
	}
}

// rule classifies a procedure. Without Options.Procedures every procedure
// but Register and Login admits any caller.
func (s *Service) rule(procedure string) (authctx.Rule, bool) {
	switch procedure {
	case authv1connect.AuthServiceRegisterProcedure, authv1connect.AuthServiceLoginProcedure:
		return authctx.Rule{Public: true}, true
	}
	if s.opts.Procedures == nil {
		return authctx.Rule{}, true
	}
	r, ok := s.opts.Procedures[procedure]
	return r, ok
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
