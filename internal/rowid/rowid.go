// Package rowid makes and checks the ids of rows.
package rowid

import (
	"fmt"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// New returns a new version 7 UUID, which sorts in the order it was made.
// It cannot fail: uuid.NewV7 only errors when crypto/rand does, and since Go
// 1.24 crypto/rand crashes the program instead of returning an error.
func New() string {
	return uuid.Must(uuid.NewV7()).String()
}

// Require answers not found for an id that is not a UUID, which Postgres
// would reject as invalid input. what names the thing in the message.
func Require(id, what string) error {
	if _, err := uuid.Parse(id); err != nil {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("%s not found", what))
	}
	return nil
}
