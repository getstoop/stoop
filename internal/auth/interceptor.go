package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/authctx"
)

// NewInterceptor authenticates every non-public Connect call, runs the
// credential gate from Options.Procedures, and deposits the caller's
// identity into the context for handlers to read via authctx.
func (s *Service) NewInterceptor() connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			procedure := req.Spec().Procedure
			rule, known := s.rule(procedure)
			identity, err := s.VerifyToken(ctx, TokenFromHeader(req.Header()))
			if err != nil && !errors.Is(err, authctx.ErrNoSession) {
				// The check failed, so who is calling is unknown: neither
				// signed out nor anonymous. A caller that hung up is not news.
				if ctx.Err() == nil {
					slog.Error("verify credential", "procedure", procedure, "err", err)
				}
				return nil, connect.NewError(connect.CodeUnavailable,
					errors.New("the server can't check your sign-in right now; try again in a moment"))
			}
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

// rule looks a procedure up in Options.Procedures. A procedure missing from
// the table, or no table at all, has no rule and is refused.
func (s *Service) rule(procedure string) (authctx.Rule, bool) {
	rule, ok := s.opts.Procedures[procedure]
	return rule, ok
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
