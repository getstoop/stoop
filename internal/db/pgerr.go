package db

import (
	"errors"
	"slices"

	"github.com/jackc/pgx/v5/pgconn"
)

// Postgres error codes the modules branch on.
const (
	UniqueViolation           = "23505"
	ForeignKeyViolation       = "23503"
	InvalidTextRepresentation = "22P02"
	QueryCanceled             = "57014"
)

// HasCode reports whether err is, or wraps, a Postgres error with one of codes.
func HasCode(err error, codes ...string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && slices.Contains(codes, pgErr.Code)
}
