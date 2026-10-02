package db

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestHasCode(t *testing.T) {
	unique := &pgconn.PgError{Code: UniqueViolation}
	cases := map[string]struct {
		err   error
		codes []string
		want  bool
	}{
		"matching":       {unique, []string{UniqueViolation}, true},
		"one of several": {unique, []string{ForeignKeyViolation, UniqueViolation}, true},
		"not matching":   {unique, []string{ForeignKeyViolation}, false},
		"wrapped":        {fmt.Errorf("create user: %w", unique), []string{UniqueViolation}, true},
		"plain error":    {errors.New("boom"), []string{UniqueViolation}, false},
		"nil":            {nil, []string{UniqueViolation}, false},
	}
	for name, tc := range cases {
		if got := HasCode(tc.err, tc.codes...); got != tc.want {
			t.Errorf("%s: HasCode = %v, want %v", name, got, tc.want)
		}
	}
}
