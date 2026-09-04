package ratelimit

import (
	"context"
	"errors"
	"strconv"

	"connectrpc.com/connect"
)

// Interceptor throttles the named procedures per client IP and lets every
// other call through untouched. It runs before authentication, which is
// the point: the procedures it guards are the ones with no session to
// check. Over the limit, callers get ResourceExhausted with a Retry-After
// header, which connect-web surfaces as a normal error.
func Interceptor(l *Limiter, trusts func(remoteAddr string) bool, procedures ...string) connect.UnaryInterceptorFunc {
	guarded := make(map[string]bool, len(procedures))
	for _, p := range procedures {
		guarded[p] = true
	}
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if !l.Enabled() || !guarded[req.Spec().Procedure] {
				return next(ctx, req)
			}
			if !l.Allow(ClientIP(req.Peer().Addr, req.Header(), trusts)) {
				err := connect.NewError(connect.CodeResourceExhausted,
					errors.New("too many attempts from your address; try again in a minute"))
				err.Meta().Set("Retry-After", strconv.Itoa(int(RetryAfter.Seconds())))
				return nil, err
			}
			return next(ctx, req)
		}
	}
}
