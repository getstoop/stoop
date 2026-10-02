package apierr

import (
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
)

// NotFoundOr turns a lookup that found no row into a NotFound error naming
// what was looked for. Any other error, and nil, come back unchanged.
func NotFoundOr(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("%s not found", what))
	}
	return err
}
