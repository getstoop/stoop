package apierr

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/authctx"
)

// RequireAction is both gates for an action on the whole instance: the
// caller's role must hold it and the credential they used must cover it.
func RequireAction(ctx context.Context, action authctx.Action) error {
	if !authctx.Holds(ctx, action) {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("instance admin role required"))
	}
	if !authctx.Covers(ctx, action) {
		return connect.NewError(connect.CodePermissionDenied, authctx.Refusal(ctx, action))
	}
	return nil
}
