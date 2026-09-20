package diag

import (
	"context"
	"time"

	"connectrpc.com/connect"
)

// Interceptor times every unary call into RPC. Streams pass through
// untouched.
func Interceptor() connect.UnaryInterceptorFunc { return interceptor(RPC) }

func interceptor(s *RPCStats) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			start := time.Now()
			res, err := next(ctx, req)
			s.Observe(req.Spec().Procedure, time.Since(start), err)
			return res, err
		}
	}
}
